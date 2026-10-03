// Actual UI and IndexedDB regressions for offline edits and competing tabs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const record = (id=1,score=150) => ({id,date:'2026-10-01',bowler:'Review bowler',sessionName:'League',sessionId:'session-review',
  schemaVersion:6,score,openFrames:3,strikes:4,strikeOpportunities:10,createdAt:1,updatedAt:1,gameOrder:1});
const server = http.createServer(async(req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  const file = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if (!file.startsWith(root+path.sep)) return res.writeHead(403).end();
  if (pathname==='/firebase-config.js') return res.writeHead(200,{'Content-Type':'text/javascript'}).end('window.BOWLING_FIREBASE_CONFIG={};');
  try {
    res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)] || 'application/octet-stream'});
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const contexts=[], errors=[];
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const url=`http://127.0.0.1:${server.address().port}`;
  async function newPage(context,offlineCache=false) {
    if (!context) {
      context=await browser.newContext({serviceWorkers:offlineCache?'allow':'block'}); contexts.push(context);
      await context.route('https://**',route=>route.abort());
    }
    const page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('dialog',dialog=>dialog.accept()); page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.waitForFunction(()=>BowlingApp.ready);return {page,context};
  }
  async function edit(page,score) {
    await page.click('#nav-sessions');await page.locator('.session-header').first().click();
    await page.locator('.game-actions-toggle').first().click();await page.locator('.edit-game').first().click();
    await page.fill('#scoreInput',String(score));
  }
  {
    const {page}=await newPage();
    const rows=[];
    for(let s=0;s<2;s++)for(let n=1;n<=6;n++) rows.push({...record(s*6+n,100+s*100),sessionId:'session-'+s,gameOrder:n,createdAt:1000+s*100+n});
    rows.push({...record(13,250),sessionId:'session-latest',createdAt:2000});
    await page.evaluate(rows=>BowlingApp.applyRemoteChanges({upserts:rows}),rows);
    const result=await page.evaluate(()=>({lastGame:document.querySelector('#homeRecap div:last-child strong').textContent,
      last10:document.querySelector('#homeRecap div:nth-child(2) strong').textContent,details:BowlingApp.getLeaderboardSummary().details}));
    assert.equal(result.lastGame,'250');assert.equal(result.last10,'175.0');assert.equal(result.details.last5,210);assert.equal(result.details.last10,175);
  }
  {
    const {page}=await newPage();
    await page.fill('#scoreInput','190');await page.fill('#scoreInput','');
    await page.reload();await page.waitForFunction(()=>BowlingApp.ready);
    assert(await page.locator('#recoverEntry').isHidden(),'Erasing a new entry must erase its recovery draft');
    await page.evaluate(game=>BowlingApp.applyRemoteChanges({upserts:[game]}),record());
    await edit(page,190);await page.fill('#scoreInput','150');
    await page.reload();await page.waitForFunction(()=>BowlingApp.ready);
    assert(await page.locator('#recoverEntry').isHidden(),'Reverting an edit to its baseline must erase its draft');
    await page.fill('#scoreInput','199');await page.reload();await page.waitForFunction(()=>BowlingApp.ready);
    await page.click('#openSeriesBtn');await page.locator('#seriesRows [data-field=score]').first().fill('180');
    assert(!await page.locator('#recoverEntry').isHidden(),'Writing a series must preserve an unrecovered entry draft');
    await page.evaluate(game=>{
      localStorage.setItem('bowling-draft:bowling-tracker-db-guest:entry',JSON.stringify({version:1,base:game,baseline:null,
        values:[1,game.date,'League','League','188','3','4','10','','','standard',[],'','full',game.sessionId]}));
    },record());
    await page.reload();await page.waitForFunction(()=>BowlingApp.ready);await page.click('#recoverEntry');
    await page.fill('#scoreInput','189');await page.reload();await page.waitForFunction(()=>BowlingApp.ready);
    await page.click('#recoverEntry');assert.equal(await page.inputValue('#scoreInput'),'189','A recovered legacy draft without a baseline remains recoverable after editing');
  }
  {
    const {page:a,context}=await newPage();await a.evaluate(game=>BowlingApp.applyRemoteChanges({upserts:[game]}),record());
    const {page:b}=await newPage(context);await edit(a,210);await edit(b,180);
    await a.click('#saveGameBtn');await a.waitForFunction(()=>BowlingApp.getGames()[0].score===210);
    await b.click('#saveGameBtn');await b.waitForFunction(()=>/changed|draft/i.test(document.getElementById('entryStatus').textContent));
    assert.equal(await b.inputValue('#scoreInput'),'180','A rejected stale save retains the edit');
    await b.reload();await b.waitForFunction(()=>BowlingApp.ready);
    assert.equal(await b.evaluate(()=>BowlingApp.getGames()[0].score),210,'A stale tab must never overwrite the first save');
    await b.click('#recoverEntry');assert.equal(await b.inputValue('#scoreInput'),'180','Rejected edits remain recoverable after reload');
    const {page:c}=await newPage(context);await c.click('#nav-sessions');await c.locator('.session-header').first().click();
    await c.locator('.edit-session').first().click();await c.fill('#editSessionDate','2026-10-02');
    await a.evaluate(async()=>{
      const game=BowlingApp.getGames()[0];await BowlingApp.applyRemoteChanges({upserts:[{...game,date:'2026-10-03',updatedAt:game.updatedAt+1}]});
    });
    await c.waitForFunction(()=>BowlingApp.getGames()[0].date==='2026-10-03');
    await c.click('#saveSessionBtn');await c.waitForFunction(()=>document.getElementById('sessionEditStatus').textContent.includes('changed'));
    assert.equal(await c.inputValue('#editSessionDate'),'2026-10-02','A stale session dialog retains its changes');
    assert.equal(await c.evaluate(()=>BowlingApp.getGames()[0].date),'2026-10-03','Session metadata also requires the original edit baseline');
  }
  {
    const {page,context}=await newPage(undefined,true);
    await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
    await page.evaluate(async game=>{await BowlingApp.activateAccount('offline-review');await BowlingApp.applyRemoteChanges({upserts:[game]});},record());
    await context.setOffline(true);await page.reload();await page.waitForFunction(()=>BowlingApp.ready);
    await edit(page,210);await page.click('#saveGameBtn');await page.waitForFunction(()=>BowlingApp.getGames()[0].score===210);
    const saved=await page.evaluate(async()=>({scope:BowlingApp.getLocalScopeInfo(),signedIn:BowlingCloud.isSignedIn(),
      snapshot:await BowlingApp.getSyncState('offline-review'),online:navigator.onLine}));
    assert.equal(saved.scope.uid,'offline-review');assert.equal(saved.signedIn,false);assert.equal(saved.online,false);
    assert.equal(saved.snapshot.outbox[1].data.score,210);assert.equal(saved.snapshot.outbox[1].base.score,150);
    await page.reload();await page.waitForFunction(()=>BowlingApp.ready);
    const checks=await page.evaluate(async()=>{
      const {planSync}=await import('./modules/reconciliation.js'),snap=await BowlingApp.getSyncState('offline-review');
      const remote={...snap.games[0],score:180,updatedAt:snap.games[0].updatedAt+1};
      const plan=planSync({localGameMap:new Map([[1,snap.games[0]]]),tombstoneMap:new Map(),remoteMap:new Map([[1,remote]]),syncOutbox:snap.outbox});
      return {issues:plan.unresolved.length,overwrite:plan.localUpserts.length};
    });
    assert.deepEqual(checks,{issues:1,overwrite:0},'A competing cloud edit must be reviewed after an offline restart');
    await context.setOffline(false);
    const old=await page.evaluate(()=>BowlingApp.getHistoryRevision('offline-review'));
    await edit(page,220);await page.click('#saveGameBtn');await page.waitForFunction(()=>BowlingApp.getGames()[0].score===220);
    const rejected=await page.evaluate(async({old,game})=>{
      try {await BowlingApp.applyRemoteChanges({upserts:[{...game,score:170}],expectedUid:'offline-review',expectedRevision:old});return false;}
      catch(error){return error.code==='bowling/local-conflict';}
    },{old,game:record()});
    assert(rejected,'A delayed cloud download cannot replace an edit made since its snapshot');
    assert.equal(await page.evaluate(()=>BowlingApp.getGames()[0].score),220);
    await page.evaluate(()=>BowlingApp.activateAccount('other-review'));
    assert.deepEqual(await page.evaluate(()=>BowlingApp.getSyncOutbox('offline-review')),{},'Another account cannot read the previous account queue');
    await page.evaluate(()=>BowlingApp.activateAccount('offline-review'));
    assert.equal(await page.evaluate(async()=>(await BowlingApp.getSyncOutbox('offline-review'))[1].data.score),220);
  }
  {
    const {page}=await newPage();
    await page.evaluate(async game=>{
      await BowlingApp.activateAccount('switch-b');await BowlingApp.applyRemoteChanges({upserts:[{...game,id:2,score:170}]});
      await BowlingApp.activateAccount('switch-a');await BowlingApp.applyRemoteChanges({upserts:[game]});
    },record());
    await edit(page,215);
    await page.evaluate(()=>{
      const original=IDBDatabase.prototype.transaction,complete=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
      let captured=false;
      IDBDatabase.prototype.transaction=function(stores,mode,...rest){
        const tx=original.call(this,stores,mode,...rest);
        if(!captured && this.name.endsWith('switch-a') && stores==='games' && mode==='readonly'){
          captured=true;
          Object.defineProperty(tx,'oncomplete',{set(fn){complete.set.call(tx,event=>{
            window.releaseSavedRead=()=>fn.call(tx,event);window.savedReadDelayed=true;
          });}});
        }
        return tx;
      };
      window.restoreTransaction=()=>{IDBDatabase.prototype.transaction=original;};
    });
    await page.click('#saveGameBtn');await page.waitForFunction(()=>window.savedReadDelayed);
    await page.evaluate(()=>BowlingApp.activateAccount('switch-b'));
    await page.evaluate(()=>{window.restoreTransaction();window.releaseSavedRead();});
    await page.waitForFunction(()=>!document.getElementById('saveGameBtn').disabled);
    assert.deepEqual(await page.evaluate(()=>BowlingApp.getGames().map(g=>[g.id,g.score])),[[2,170]],'A late saved-history response cannot replace the next account snapshot');
    await page.evaluate(()=>BowlingApp.activateAccount('switch-a'));
    assert.equal(await page.evaluate(()=>BowlingApp.getGames()[0].score),215,'The original account save remains durable');
  }
  {
    const {page}=await newPage();
    const checks=await page.evaluate(async game=>{
      const S=await import('./modules/storage.js'),R=await import('./modules/reconciliation.js');
      const db=await S.openDatabase('transaction-review'),other=await S.openDatabase('transaction-review');
      await S.commitGames(db,[game,{...game,id:3}]);
      const baseline=await S.getHistorySnapshot(db);
      const race=await Promise.allSettled([S.commitGames(db,[{...game,score:180,updatedAt:2}],[],{queue:true,expectedRevision:baseline.revision}),
        S.commitGames(other,[{...game,score:200,updatedAt:3}],[],{queue:true,expectedRevision:baseline.revision})]);
      const first=await S.getHistorySnapshot(db),ack=structuredClone(first.outbox);
      await S.commitGames(db,[{...first.games.find(g=>g.id===1),score:210,updatedAt:4}],[],{queue:true});
      const retry=await S.getHistorySnapshot(db);
      await S.acknowledgeOutbox(other,ack);const lateAck=await S.getHistorySnapshot(db);
      const plan=R.planSync({localGameMap:new Map(lateAck.games.map(g=>[g.id,g])),tombstoneMap:new Map(),
        remoteMap:new Map([[1,ack[1].data]]),syncOutbox:lateAck.outbox});
      const beforeFailure=JSON.stringify(lateAck),put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(value,...rest){if(this.name==='settings' && value.key==='syncOutbox')throw new DOMException('Simulated full storage','QuotaExceededError');return put.call(this,value,...rest);};
      let quotaRejected=false;
      try {await S.commitGames(db,[{...game,score:250,updatedAt:5},{...game,id:2}], [{id:3,updatedAt:5}],{queue:true});}
      catch(error){quotaRejected=error.name==='QuotaExceededError';}finally{IDBObjectStore.prototype.put=put;}
      const atomic=beforeFailure===JSON.stringify(await S.getHistorySnapshot(db));
      await S.commitGames(db,[],[{id:3,updatedAt:10}],{queue:true});
      const deletion=await S.getHistorySnapshot(db);
      await S.commitGames(other,[],[{id:3,updatedAt:11}],{queue:true});
      let undoRejected=false;
      try {await S.commitGames(db,[{...game,id:3,updatedAt:12}],[],{queue:true,expectedVersions:[{id:3,version:{...deletion.tombstones[0],deleted:true}}]});}
      catch(error){undoRejected=error.code==='bowling/local-conflict';}
      const legacyDb=await S.openDatabase('legacy-retry-review');await S.commitGames(legacyDb,[game]);
      localStorage.setItem('bowling-sync-outbox:legacy-review',JSON.stringify({1:{data:R.cloudGamePayload(game),base:null},99:{data:R.cloudGamePayload({...game,id:99}),base:null}}));
      await S.migrateLegacyOutbox(legacyDb,'legacy-review',localStorage);
      const migrated=await S.getHistorySnapshot(legacyDb);
      db.close();other.close();legacyDb.close();
      return {race:race.map(r=>r.status),staleCode:race[1].reason?.code,firstScore:first.games.find(g=>g.id===1).score,
        earliestBase:retry.outbox[1].base.score,latestScore:retry.outbox[1].data.score,lateAckBase:lateAck.outbox[1].base.score,
        lateAckScore:lateAck.outbox[1].data.score,falseConflicts:plan.unresolved.length,quotaRejected,atomic,undoRejected,
        migratedIds:Object.keys(migrated.outbox),legacyRemoved:localStorage.getItem('bowling-sync-outbox:legacy-review')===null};
    },record());
    assert.deepEqual(checks,{race:['fulfilled','rejected'],staleCode:'bowling/local-conflict',firstScore:180,
      earliestBase:150,latestScore:210,lateAckBase:180,lateAckScore:210,falseConflicts:0,quotaRejected:true,atomic:true,undoRejected:true,migratedIds:['1'],legacyRemoved:true});
  }
  assert.deepEqual(errors,[],'No uncaught browser errors');
  console.log('PASS reliability: same-date chronology, reverted/unrecovered drafts, competing tabs and recoverable rejected edits, real offline restart, durable conflict bases, account isolation, stale cloud downloads, atomic save/outbox rollback, serialized competing transactions, late acknowledgements, deletion/undo races and legacy queue migration.');
} finally {
  await Promise.all(contexts.map(context=>context.close()));await browser?.close();await new Promise(resolve=>server.close(resolve));
}
