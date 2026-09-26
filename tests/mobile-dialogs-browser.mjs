// Browser regression for the approved UX redesign. Uses only synthetic, local data.
// Supply PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE when installed outside the app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.env.UX_APP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.UX_TEST_OUTPUT;
if (output) await fs.mkdir(output, {recursive:true});
const server = http.createServer(async (req,res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, {'Content-Type':({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.json':'application/json'})[path.extname(file)] || 'application/octet-stream'}); res.end(await fs.readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined, args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true, serviceWorkers:'block'});
  await context.route('https://**',route=>route.abort());
  await context.route('**/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.BOWLING_FIREBASE_CONFIG = {};'}));
  const page = await context.newPage();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let discard=true;page.on('dialog',dialog=>discard?dialog.accept():dialog.dismiss());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>BowlingApp.ready);
  const activeView=()=>page.evaluate(()=>document.querySelector('.app-view:not([hidden])').id);
  const backgroundTop=()=>page.locator('#mainContent').evaluate(el=>el.getBoundingClientRect().top);
  const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const samePosition=(a,b,message)=>assert(Math.abs(a-b)<2,`${message}: ${a} vs ${b}`);
  // A reload (including an automatic app update) must retain the current section.
  for(const view of ['stats','friends','profile','sessions']) {
    await page.click('#nav-'+view);await page.reload();await page.waitForFunction(()=>BowlingApp.ready);
    await frames();assert.equal(await activeView(),'view-'+view,'Reload must preserve '+view);
  }
  await page.click('#nav-home');await page.evaluate(()=>scrollTo({top:100,behavior:'instant'}));
  const initialTop=await backgroundTop(), initialY=await page.evaluate(()=>scrollY);
  await page.locator('#openSeriesBtn').tap();
  assert.equal(await page.locator('#seriesDialog').evaluate(el=>el.scrollTop),0,'Series starts at its heading');
  samePosition(await backgroundTop(),initialTop,'Opening Series must not shift the background');
  await page.mouse.move(2,400);await page.mouse.wheel(0,600);await frames();
  samePosition(await backgroundTop(),initialTop,'Backdrop scroll must not move the page');
  const touch=await context.newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:650}]});
  for(let y=610;y>=290;y-=40){await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:190,y}]});await frames();}
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert(await page.locator('#seriesDialog').evaluate(el=>el.scrollTop)>100,'Series content scrolls immediately on touch');
  samePosition(await backgroundTop(),initialTop,'A swipe must move only the dialog');
  await page.locator('[data-close=seriesDialog]').tap();await frames();
  assert.equal(await activeView(),'view-home');samePosition(await page.evaluate(()=>scrollY),initialY,'Closing restores the page position');
  // A declined discard keeps the modal locked; Escape with confirmation releases it.
  await page.locator('#openSeriesBtn').tap();await page.locator('#seriesRows [data-field=score]').first().fill('180');
  discard=false;await page.locator('[data-close=seriesDialog]').tap();assert(await page.locator('#seriesDialog').isVisible());
  const changedTop=await backgroundTop();await page.mouse.move(2,400);await page.mouse.wheel(0,600);await frames();samePosition(await backgroundTop(),changedTop,'Declining discard retains the lock');
  discard=true;await page.keyboard.press('Escape');await frames();assert(!await page.locator('#seriesDialog').isVisible());
  // Seed local scores through the actual save controls.
  await page.locator('[name=entryTracking][value=score-only]').check();
  for(const [index,score] of [180,190,200].entries()) {await page.fill('#scoreInput',String(score));await page.click('#saveGameBtn');await page.waitForFunction(n=>BowlingApp.getGames().length===n,index+1);}
  await page.click('#nav-sessions');await page.locator('.session-header').first().click();
  await page.locator('.game-actions-toggle').first().click();await page.locator('.edit-game').first().click();
  await page.click('#cancelEditBtn');assert.equal(await activeView(),'view-sessions','Cancel edit returns to Sessions');
  await page.locator('.edit-game').first().click();await page.fill('#scoreInput','181');await page.click('#saveGameBtn');
  await page.waitForFunction(()=>BowlingApp.getGames().some(g=>g.score===181));assert.equal(await activeView(),'view-sessions','Save edit returns to Sessions');
  await page.locator('.edit-session').first().click();await page.locator('[data-close=editSessionDialog]').click();assert.equal(await activeView(),'view-sessions');
  await page.click('#nav-profile');
  for(const [open,close] of [['#openSettingsBtn','#closeSettingsBtn'],['#openCloudBtn','#closeCloudBtn'],['#profileImportExportBtn','#closeSettingsBtn'],['#profileGroupsBtn','#closeCloudBtn']]) {
    await page.locator(open).tap();await page.locator(close).tap();await frames();assert.equal(await activeView(),'view-profile',open+' returns to Profile');
  }
  // The score card is legitimately stacked on top of a friend comparison.
  await page.click('#nav-friends');
  await page.evaluate(()=>{
    BowlingUI.openDialog(document.getElementById('friendStatsDialog'));
    BowlingUI.openDialog(document.getElementById('scoreCardDialog'));
  });
  await page.click('#closeScoreCard');await frames();assert(await page.locator('#friendStatsDialog').isVisible());
  const nestedTop=await backgroundTop();await page.mouse.move(2,400);await page.mouse.wheel(0,600);await frames();samePosition(await backgroundTop(),nestedTop,'Parent modal still locks background');
  await page.click('#closeFriendStats');await frames();assert.equal(await activeView(),'view-friends');
  // Programmatic/account-change close and immediate reopen cannot leave a stuck lock.
  await page.evaluate(()=>{const d=document.getElementById('cloudDialog');BowlingUI.openDialog(d);d.close();BowlingUI.openDialog(d);});
  await frames();await page.click('#closeCloudBtn');await frames();
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).position),'static','Final close releases the body');
  await page.evaluate(()=>{try {BowlingUI.openDialog(document.createElement('dialog'));} catch (_) {}});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).position),'static','Failed opening must release the lock');
  await page.click('#nav-home');assert.equal(await page.locator('#homeGreeting').textContent(),'Your game');
  assert.deepEqual(errors,[]);
  console.log('PASS mobile dialogs: reload/navigation retention; immediate touch scrolling; no background scroll; scroll restoration; discard/Escape; edit return; Profile routes; stacked and rapidly reopened dialogs.');
} finally {await browser?.close();server.close();}
