// Optional real-browser checks. Set PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE
// when Playwright/Chromium are supplied outside this dependency-free app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.CARD_TEST_OUTPUT;
if (output) await fs.mkdir(output, {recursive:true});
const server = http.createServer(async (req,res) => {
  const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const mime = {'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.json':'application/json'}[path.extname(filename)] || 'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime});res.end(await fs.readFile(filename));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'});
  // No user accounts or real cloud data are involved in this test.
  await context.route('https://**',route=>route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(()=>window.BowlingApp?.ready);
  const seed = async (scores) => {
    await page.evaluate(async scores=>{
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open(window.BowlingApp.getLocalScopeInfo().dbName);
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{
          const db=request.result, tx=db.transaction('games','readwrite');
          const store=tx.objectStore('games');store.clear();
          scores.forEach((score,i)=>store.put({id:i+1,date:'2026-09-24',sessionName:'League',sessionType:'League',bowler:'Matthew',gameOrder:i+1,score,strikes:5,strikeOpportunities:10,openFrames:2,notes:'Private note',createdAt:i+1,updatedAt:i+1}));
          tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
        };
      });
    },scores);
    await page.reload();await page.waitForFunction(()=>window.BowlingApp?.ready);
    await page.evaluate(()=>window.BowlingApp.setProfileName('Matthew'));
  };
  await seed([182,213,195]);
  await page.click('#nav-sessions');await page.click('.share-session');
  await page.waitForSelector('#saveScoreCard:visible');
  assert.match(await page.locator('#scoreCardImage').getAttribute('alt'),/Series total: 590/);
  assert(!await page.locator('#scoreCardImage').getAttribute('alt').then(value=>value.includes('Private note')));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),'No mobile overflow');
  assert.equal(await page.evaluate(()=>window.BowlingApp.canApplyUpdate()),false,'An open card prevents an automatic reload');
  if (output) await page.screenshot({path:path.join(output,'mobile-card.png')});
  const downloadPromise=page.waitForEvent('download');await page.click('#saveScoreCard');
  const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'bowling-tracker-session-2026-09-24.png');
  const image=await fs.readFile(await download.path());
  assert.equal(image.subarray(1,4).toString(),'PNG');
  if(output)await fs.writeFile(path.join(output,'session-browser.png'),image);
  await page.click('#copyScoreCard');
  await page.waitForFunction(()=>document.getElementById('scoreCardStatus').textContent.includes('Image copied'));
  const types=await page.evaluate(async()=>Array.from((await navigator.clipboard.read())[0].types));
  assert(types.includes('image/png'),'Clipboard contains the actual image');
  await page.evaluate(()=>{navigator.clipboard.write=async()=>{throw new DOMException('Blocked','NotAllowedError')};});
  await page.click('#copyScoreCard');
  await page.waitForFunction(()=>document.getElementById('scoreCardStatus').textContent.includes('Copy was blocked'));
  assert(await page.locator('#saveScoreCard').isVisible());
  await page.click('#closeScoreCard');
  assert.equal(await page.locator('#scoreCardImage').getAttribute('src'),null);

  // Native share is platform-specific; verify capability gating, gesture timing,
  // image-file payload and cancellation with a browser-level stub.
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>files?.[0]?.type==='image/png'});
    Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{
      window.shared={name:files[0].name,type:files[0].type,size:files[0].size,active:navigator.userActivation.isActive};
      throw new DOMException('Cancelled','AbortError');
    }});
  });
  await page.click('#nav-stats');await page.click('#shareOverallStats');await page.waitForSelector('#shareScoreCard:visible');
  await page.click('#shareScoreCard');await page.waitForFunction(()=>window.shared);
  assert.equal(await page.evaluate(()=>window.shared.active),true);
  assert.equal(await page.evaluate(()=>window.shared.type),'image/png');
  assert((await page.evaluate(()=>window.shared.size))>1000);
  assert.equal(await page.locator('#scoreCardStatus').textContent(),'');
  if(output) {
    const data=await page.evaluate(async()=>Array.from(new Uint8Array(await (await fetch(document.getElementById('scoreCardImage').src)).arrayBuffer())));
    await fs.writeFile(path.join(output,'overall-browser.png'),Buffer.from(data));
  }
  await page.click('#closeScoreCard');

  // Exercise the existing friend dialog and sharing controls with synthetic
  // summaries only. No Firebase connection or production account is used.
  await page.evaluate(()=>window.BowlingApp.activateAccount('comparison-test'));
  await seed([180,210,240,300]);
  await page.evaluate(async()=>{
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open(window.BowlingApp.getLocalScopeInfo().dbName);
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction('games','readwrite'),store=tx.objectStore('games');
        const second=store.get(2);second.onsuccess=()=>store.put({...second.result,scoreOnly:true,strikes:null,openFrames:null,strikeOpportunities:null});
        const fourth=store.get(4);fourth.onsuccess=()=>store.put({...fourth.result,noTap:true});
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
      };request.onerror=()=>reject(request.error);
    });
  });
  await page.reload();await page.waitForFunction(()=>window.BowlingApp?.ready);
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>files?.[0]?.type==='image/png'});
    Object.defineProperty(navigator,'share',{configurable:true,value:async({files,title})=>{
      window.sharedComparison={name:files[0].name,type:files[0].type,title,active:navigator.userActivation.isActive};
    }});
  });
  const loadFriends=async(name='Alex')=>page.evaluate(name=>{
    const uid=window.BowlingApp.getLocalScopeInfo().uid;
    const friend={uid:'synthetic-friend',displayName:name,games:20,average:195.8,highGame:268,highSeries:656,
      strikePct:42.5,cleanGames:2,totalStrikes:68,frameStatsGames:15,scoreOnlyGames:5,
      updatedAt:Date.parse('2026-09-24T12:00:00Z'),frameStatsUpdatedAt:Date.parse('2026-09-24T12:00:00Z'),
      details:{updatedAt:Date.parse('2026-09-24T12:00:00Z'),openAvg:2.2,hasSeries:true}};
    window.BowlingFriends.setMembers([friend],{uid,groupId:'synthetic-group',revision:1});
    window.BowlingFriends.open(friend.uid);
  },name);
  await loadFriends();
  assert(!await page.locator('#shareFriendComparison').isVisible());
  await page.click('#friendStatsCompare');await page.click('#shareFriendComparison');
  await page.waitForSelector('#saveScoreCard:visible');
  assert.equal(await page.locator('#scoreCardHeading').textContent(),'Friend comparison card');
  const comparisonAlt=await page.locator('#scoreCardImage').getAttribute('alt');
  assert.match(comparisonAlt,/Matthew\. Average: 210.0\. Games: 3/);
  assert.match(comparisonAlt,/High 3-game series: 630/);
  assert.match(comparisonAlt,/Alex\. Average: 195.8/);
  assert.match(comparisonAlt,/Closed frame %: 78.0%/);
  assert.match(comparisonAlt,/Frame details: 2 of 3 games/);
  assert.match(comparisonAlt,/Frame details: 15 of 20 games/);
  assert(!await page.locator('#scoreCardPages').isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.evaluate(()=>window.BowlingApp.canApplyUpdate()),false);
  if(output)await page.screenshot({path:path.join(output,'comparison-mobile.png')});
  const comparisonDownload=page.waitForEvent('download');await page.click('#saveScoreCard');
  const comparisonFile=await comparisonDownload;
  assert.match(comparisonFile.suggestedFilename(),/^bowling-tracker-comparison-\d{4}-\d{2}-\d{2}\.png$/);
  const comparisonPng=await fs.readFile(await comparisonFile.path());
  assert.equal(comparisonPng.subarray(1,4).toString(),'PNG');
  if(output)await fs.writeFile(path.join(output,'comparison-browser.png'),comparisonPng);
  await page.click('#copyScoreCard');
  await page.waitForFunction(()=>/Image copied|Copy was blocked/.test(document.getElementById('scoreCardStatus').textContent));
  assert.match(await page.locator('#scoreCardStatus').textContent(),/Image copied/);
  assert((await page.evaluate(async()=>(await navigator.clipboard.read())[0].types)).includes('image/png'));
  await page.click('#shareScoreCard');await page.waitForFunction(()=>window.sharedComparison);
  assert.equal(await page.evaluate(()=>window.sharedComparison.title),'Bowling comparison');
  assert.equal(await page.evaluate(()=>window.sharedComparison.active),true);
  assert.match(await page.evaluate(()=>window.sharedComparison.name),/^bowling-tracker-comparison-/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#friendStatsDialog').evaluate(el=>el.open),true,'Closing card returns to comparison');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'shareFriendComparison');
  await page.click('#shareFriendComparison');await page.waitForSelector('#saveScoreCard:visible');
  await page.evaluate(()=>window.BowlingFriends.clear());
  assert.equal(await page.locator('#scoreCardDialog').evaluate(el=>el.open),false,'Group reset clears comparison image');
  assert.equal(await page.locator('#scoreCardImage').getAttribute('src'),null);
  await loadFriends('An extraordinarily long bowler name 🎳 '.repeat(5));
  await page.click('#friendStatsCompare');await page.click('#shareFriendComparison');
  await page.waitForSelector('#saveScoreCard:visible');
  if(output){
    const data=await page.evaluate(async()=>Array.from(new Uint8Array(await (await fetch(document.getElementById('scoreCardImage').src)).arrayBuffer())));
    await fs.writeFile(path.join(output,'comparison-long-name.png'),Buffer.from(data));
  }
  await page.evaluate(()=>window.BowlingApp.activateAccount('score-card-test-only'));
  assert.equal(await page.locator('#scoreCardDialog').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#scoreCardImage').getAttribute('src'),null);
  assert.equal(await page.locator('#friendStatsDialog').evaluate(el=>el.open),false);
  console.log('PASS browser: friend comparison PNG, real clipboard/download, score-only/no-tap data, long names, mobile layout, nested dialog focus and group/account isolation.');

  await seed(Array.from({length:61},(_,i)=>100+i));
  await page.click('#nav-sessions');await page.click('.share-session');await page.waitForSelector('#saveScoreCard:visible');
  assert.equal(await page.locator('#scoreCardPageLabel').textContent(),'Card 1 of 3');
  await page.click('#scoreCardNext');await page.waitForFunction(()=>!document.getElementById('copyScoreCard').disabled);
  assert.match(await page.locator('#scoreCardImage').getAttribute('alt'),/Game 25:/);
  await page.click('#scoreCardNext');await page.waitForFunction(()=>!document.getElementById('copyScoreCard').disabled);
  assert.match(await page.locator('#scoreCardImage').getAttribute('alt'),/Game 61: 160/);
  assert(await page.locator('#scoreCardNext').isDisabled());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#scoreCardDialog').evaluate(el=>el.open),false);

  // A late PNG encode must not restore a closed card or its image URL.
  await page.evaluate(()=>{window.originalToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback){window.finishCard=()=>window.originalToBlob.call(this,callback,'image/png');};});
  await page.click('.share-session');await page.click('#closeScoreCard');
  await page.evaluate(()=>window.finishCard());await page.waitForTimeout(100);
  assert.equal(await page.locator('#scoreCardImage').getAttribute('src'),null);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS browser: mobile dialog, real PNG download and clipboard, blocked-copy fallback, native-share payload/cancel, account isolation, pagination, Escape, update guard and late-encode cleanup.');
  await context.close();

  // Install the complete offline app, then build a card without network access.
  const offline=await browser.newContext({viewport:{width:390,height:844}});
  const offlinePage=await offline.newPage();
  await offlinePage.goto(url);await offlinePage.waitForFunction(()=>window.BowlingApp?.ready);
  await offlinePage.waitForFunction(()=>navigator.serviceWorker.controller);
  await offlinePage.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready;
    const names=await caches.keys();const cache=await caches.open(names.find(name=>name.includes('bowling-tracker:')));
    if(!await cache.match('./score-cards.js'))throw new Error('Score cards missing from offline cache');
  });
  // Add a real entry through the ordinary entry UI.
  await offlinePage.fill('#scoreInput','180');await offlinePage.fill('#strikesInput','4');await offlinePage.fill('#openFramesInput','3');
  await offlinePage.click('#saveGameBtn');await offlinePage.waitForFunction(()=>window.BowlingApp.getGames().length===1);
  await offline.setOffline(true);await offlinePage.reload();await offlinePage.waitForFunction(()=>window.BowlingApp?.ready);
  await offlinePage.click('#nav-sessions');await offlinePage.click('.share-session');await offlinePage.waitForSelector('#saveScoreCard:visible');
  assert.match(await offlinePage.locator('#scoreCardImage').getAttribute('alt'),/Series total: 180/);
  console.log('PASS browser: offline cached app reloads and generates a complete score card.');
  await offline.close();
} finally {
  await browser?.close();server.close();
}
