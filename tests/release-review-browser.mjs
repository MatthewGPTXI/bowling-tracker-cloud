// Regression coverage for issues found in the pre-release review. Synthetic local data only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let updateVersion = null;
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (pathname === '/version.js' && updateVersion) { res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(`self.BOWLING_VERSION = '${updateVersion}';`); return; }
  try { res.writeHead(200, {'Content-Type': ({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[path.extname(file)] || 'application/octet-stream'}); res.end(await fs.readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined, args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport:{width:390,height:844}, serviceWorkers:'block'});
  await context.route('https://**', route => route.abort());
  await context.route('**/firebase-config.js', route => route.fulfill({contentType:'text/javascript',body:'window.BOWLING_FIREBASE_CONFIG = {};'}));
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => BowlingApp.ready);
  const id = crypto.randomUUID();
  const game = {id, date:'2026-09-26',bowler:'Matthew',sessionName:'League',score:180,openFrames:3,strikes:4,strikeOpportunities:10,createdAt:1,updatedAt:1};
  await page.evaluate(game => BowlingApp.applyRemoteChanges({upserts:[game,{...game,id:7,date:'2026-09-25'}]}), game);
  const importBackup = async payload => {
    await page.click('#nav-profile'); await page.click('#profileImportExportBtn');
    await page.setInputFiles('#importJsonInput', {name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
    await page.waitForSelector('#importPreviewDialog[open]');
  };
  // UUID conflicts must obey the explicit backup choice, including deletions.
  await importBackup({games:[{...game,score:210}]});
  await page.selectOption('[data-import-id="'+id+'"]', 'backup');
  await page.click('#confirmImportBtn'); await page.waitForSelector('#importPreviewDialog', {state:'hidden'});
  assert.equal(await page.evaluate(id => BowlingApp.getGames().find(g=>g.id===id).score,id),210,'Reviewed UUID backup replacement must apply');
  await page.click('#closeSettingsBtn');
  await importBackup({games:[],tombstones:[{id,updatedAt:2}]});
  await page.selectOption('[data-import-id="'+id+'"]','backup');
  await page.click('#confirmImportBtn'); await page.waitForSelector('#importPreviewDialog', {state:'hidden'});
  assert(!await page.evaluate(id => BowlingApp.getGames().some(g=>g.id===id),id),'Reviewed UUID deletion must apply');
  await page.click('#closeSettingsBtn');
  // Canonical numeric strings cannot bypass repeated-ID validation.
  await page.click('#profileImportExportBtn');
  await page.setInputFiles('#importJsonInput',{name:'duplicate.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({games:[{...game,id:7}],tombstones:[{id:'7',updatedAt:3}]}))});
  await page.waitForFunction(()=>document.getElementById('settingsStatus').textContent.includes('repeats a game ID'));
  await page.click('#closeSettingsBtn');
  // Two legacy sessions still have separate identities after a date edit makes
  // their metadata identical. Continue, rerender and draft recovery keep the ID.
  await page.evaluate(game => BowlingApp.applyRemoteChanges({upserts:[{...game,id:8,date:'2026-09-24'}]}),game);
  const sessionId = '2026-09-24|||league';
  const card = () => page.locator('[data-session-key="'+sessionId+'"]');
  await page.click('#nav-sessions'); await card().locator('.session-header').click();
  await card().locator('.edit-session').click(); await page.fill('#editSessionDate','2026-09-25');
  await page.click('#saveSessionBtn'); await page.waitForSelector('#editSessionDialog',{state:'hidden'});
  await card().locator('.add-to-session').click();
  assert.equal(await page.inputValue('#sessionSelect'),sessionId,'Entry must retain the selected stable session after its date changed');
  await page.evaluate(()=>BowlingApp.renderAll());
  assert.equal(await page.inputValue('#sessionSelect'),sessionId);
  await page.locator('[name=entryTracking][value=score-only]').check(); await page.fill('#scoreInput','199');
  await page.reload(); await page.waitForFunction(()=>BowlingApp.ready); await page.click('#recoverEntry');
  assert.equal(await page.inputValue('#sessionSelect'),sessionId,'Draft recovery retains session identity');
  await page.click('#saveGameBtn'); await page.waitForFunction(()=>BowlingApp.getGames().some(g=>g.score===199));
  assert.equal(await page.evaluate(()=>BowlingApp.getGames().find(g=>g.score===199).sessionId),sessionId);
  await page.click('#openSeriesBtn');
  for (let i=0;i<3;i++) await page.locator('#seriesRows [data-field=score]').nth(i).fill(String(201+i));
  await page.reload(); await page.waitForFunction(()=>BowlingApp.ready); await page.click('#recoverSeries');
  await page.click('#saveSeriesBtn'); await page.waitForSelector('#seriesDialog',{state:'hidden'});
  assert.equal(await page.evaluate(key=>BowlingApp.getGames().filter(g=>g.sessionId===key).length,sessionId),5,'Recovered series belongs to the selected stable session');
  assert.equal(await page.evaluate(()=>BowlingApp.getGames().find(g=>g.id===7).sessionId),'2026-09-25|||league');
  // A pre-migration edit draft must still match its normalized saved baseline.
  await page.evaluate(game => {
    localStorage.setItem('bowling-draft:bowling-tracker-db-guest:entry',JSON.stringify({version:1,base:{...game,id:7,date:'2026-09-25'},values:[7,'2026-09-25','League','League','188','3','4','10','','','standard',[],'','full'],baseline:null}));
    BowlingApp.renderAll();
  },game);
  await page.reload(); await page.waitForFunction(()=>BowlingApp.ready); await page.click('#recoverEntry');
  await page.click('#saveGameBtn');
  await page.waitForFunction(()=>BowlingApp.getGames().find(g=>g.id===7).score===188);
  // Validate actual IndexedDB migrations, canonical key deletion and rollback.
  const storageChecks = await page.evaluate(async game => {
    const storage = await import('./modules/storage.js');
    const database = await storage.openDatabase('review-migration');
    await storage.idbRequestOn(database,'games','readwrite',store=>store.put({...game,id:12,createdAt:0,updatedAt:0,legacyNote:'retain'}));
    await storage.migrateGames(database);
    const [migrated] = await storage.getAllFromDb(database,'games');
    await storage.commitGames(database,[],[{id:'12',updatedAt:0}]);
    const afterDelete = await storage.getAllFromDb(database,'games');
    await storage.commitGames(database,[{...game,id:'12'}]);
    const afterRestore = await storage.getAllFromDb(database,'tombstones');
    let rejected = false;
    try { await storage.commitGames(database,[{...game,id:13},{...game,id:'invalid'}]); } catch (_) { rejected = true; }
    const afterFailure = await storage.getAllFromDb(database,'games');
    database.close();
    let invalidRemoteRejected = false;
    try { await BowlingApp.applyRemoteChanges({upserts:[{...game,id:99},{...game,id:100,score:301}]}); } catch (_) { invalidRemoteRejected = true; }
    return {migrated,afterDelete,afterRestore,rejected,afterFailure,invalidRemoteRejected,invalidSaved:BowlingApp.getGames().some(g=>g.id===99)};
  },game);
  assert.equal(storageChecks.migrated.updatedAt,0); assert.equal(storageChecks.migrated.legacyNote,'retain');
  assert.equal(storageChecks.migrated.schemaVersion,6);
  assert.deepEqual(storageChecks.afterDelete,[]); assert.deepEqual(storageChecks.afterRestore,[]);
  assert(storageChecks.rejected); assert.deepEqual(storageChecks.afterFailure.map(g=>g.id),[12]);
  assert(storageChecks.invalidRemoteRejected); assert(!storageChecks.invalidSaved);
  await page.evaluate(game => BowlingApp.applyRemoteChanges({upserts:[{...game,id:15,createdAt:0,updatedAt:0}]}),game);
  const count = await page.evaluate(()=>BowlingApp.getGames().length);
  await page.evaluate(()=>BowlingApp.activateAccount('review-copy',{importCurrent:true}));
  assert.equal(await page.evaluate(()=>BowlingApp.getGames().length),count,'Account import retains legacy records with zero timestamps');
  await page.evaluate(async () => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {
      const request = open(...args);
      if (!args[0].endsWith('review-a')) return request;
      // Make the earlier account open finish after the later request.
      return new Proxy(request, {
        get(target,key) { const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value; },
        set(target,key,value) { return Reflect.set(target,key,key==='onsuccess' ? event=>setTimeout(()=>value(event),100) : value,target); }
      });
    };
    try { await Promise.all([BowlingApp.activateAccount('review-a'),BowlingApp.activateAccount('review-b')]); }
    finally { indexedDB.open = open; }
  });
  assert.equal(await page.evaluate(()=>BowlingApp.getLocalScopeInfo().uid),'review-b');
  assert.deepEqual(await page.evaluate(()=>BowlingApp.getGames()),[],'Overlapping scope changes cannot expose the previous account');
  assert.deepEqual(errors,[]);
  await context.close();
  // A real service-worker upgrade must defer while a modal/draft is active,
  // then restore the selected view and load the entire module app offline.
  const pwa = await browser.newContext({viewport:{width:390,height:844}});
  await pwa.route('https://**',route=>route.abort());
  const updatePage = await pwa.newPage(); updatePage.setDefaultTimeout(15000);
  const updateErrors=[]; updatePage.on('pageerror',error=>updateErrors.push(error.message));
  await updatePage.goto(`http://127.0.0.1:${server.address().port}`);
  await updatePage.waitForFunction(()=>BowlingApp.ready && navigator.serviceWorker.controller);
  const originalVersion = await updatePage.evaluate(()=>BOWLING_VERSION);
  await updatePage.locator('[name=entryTracking][value=score-only]').check(); await updatePage.fill('#scoreInput','187');
  await updatePage.click('#nav-stats');
  await updatePage.evaluate(()=>BowlingUI.openDialog(document.getElementById('settingsDialog')));
  updateVersion = 'review-upgrade';
  await updatePage.evaluate(async()=>{ await (await navigator.serviceWorker.ready).update(); });
  await updatePage.waitForFunction(()=>new Promise(resolve=>{
    const channel=new MessageChannel(); channel.port1.onmessage=event=>{channel.port1.close();resolve(event.data?.version==='review-upgrade');};
    navigator.serviceWorker.controller.postMessage({type:'BOWLING_VERSION'},[channel.port2]);
  }));
  assert.equal(await updatePage.evaluate(()=>BOWLING_VERSION),originalVersion,'Open modal and draft defer an installed update');
  await updatePage.click('#closeSettingsBtn');
  await updatePage.evaluate(()=>BowlingApp.renderAll());
  // Allow the asynchronous worker handshake to finish; the draft still blocks reload.
  await updatePage.waitForTimeout(2200);
  assert.equal(await updatePage.evaluate(()=>BOWLING_VERSION),originalVersion,'Unsaved draft continues to defer reload after modal closes');
  await updatePage.evaluate(()=>document.getElementById('saveGameBtn').click());
  await updatePage.waitForFunction(()=>BOWLING_VERSION==='review-upgrade' && BowlingApp.ready);
  assert.equal(await updatePage.locator('.app-view:not([hidden])').getAttribute('id'),'view-stats');
  assert.equal(await updatePage.evaluate(()=>BowlingApp.getGames()[0].score),187);
  await pwa.setOffline(true); await updatePage.reload(); await updatePage.waitForFunction(()=>BowlingApp.ready);
  assert.equal(await updatePage.locator('.app-view:not([hidden])').getAttribute('id'),'view-stats');
  assert.equal(await updatePage.evaluate(()=>BowlingApp.getGames()[0].score),187);
  assert.deepEqual(updateErrors,[]); await pwa.close();
  console.log('PASS release review: UUID backup choices, canonical IDs, stable sessions, recovered drafts, IndexedDB migration/atomicity, invalid cloud data and overlapping account switches.');
  console.log('PASS real PWA update: modal/draft reload guards, restored Stats view, saved game and offline ES module startup.');
} finally { await browser?.close(); server.close(); }
