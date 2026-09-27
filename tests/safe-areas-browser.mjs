// Dialog and page geometry with browser-emulated iPhone safe-area insets.
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
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.route('https://**',route=>route.abort());
  await context.route('**/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.BOWLING_FIREBASE_CONFIG = {};'}));
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(page);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>BowlingApp.ready);
  await page.click('#openSeriesBtn');await page.click('[data-close=seriesDialog]');
  const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const cases=[
    {name:'portrait',width:390,height:844,top:62,bottom:34,left:0,right:0},
    {name:'landscape',width:844,height:390,top:0,bottom:21,left:62,right:62},
    {name:'reduced-height',width:390,height:460,top:62,bottom:34,left:0,right:0},
    {name:'small-phone',width:320,height:568,top:20,bottom:0,left:0,right:0},
    {name:'desktop',width:1280,height:900,top:0,bottom:0,left:0,right:0}
  ];
  for(const test of cases) {
    await page.setViewportSize({width:test.width,height:test.height});
    await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:test.top,bottom:test.bottom,left:test.left,right:test.right}});
    const measured=await page.evaluate(()=>{
      const probe=document.createElement('div');probe.style='position:fixed;height:env(safe-area-inset-top);width:env(safe-area-inset-left)';document.body.append(probe);
      const result={top:probe.getBoundingClientRect().height,left:probe.getBoundingClientRect().width};probe.remove();return result;
    });
    assert.equal(measured.top,test.top);assert.equal(measured.left,test.left);
    for(const id of ['seriesDialog','settingsDialog','cloudDialog','editSessionDialog','friendStatsDialog','scoreCardDialog','importPreviewDialog']) {
      await page.evaluate(id=>BowlingUI.openDialog(document.getElementById(id)),id);await frames();
      const bounds=await page.locator('#'+id).boundingBox();
      assert(bounds.y>=test.top+11,`${test.name} ${id}: top ${bounds.y} overlaps status-bar area ${test.top}`);
      assert(bounds.y+bounds.height<=test.height-test.bottom-11,`${test.name} ${id}: bottom overlaps home-indicator area`);
      assert(bounds.x>=test.left+11 && bounds.x+bounds.width<=test.width-test.right-11,`${test.name} ${id}: side overlaps notch area`);
      const header=await page.locator('#'+id+' .dialog-header').boundingBox();
      assert(header.y>=test.top+12 && header.y+header.height<=test.height-test.bottom-12,`${test.name} ${id}: header is not fully visible`);
      assert(await page.locator('#'+id).evaluate(el=>el.scrollWidth<=el.clientWidth),`${test.name} ${id}: horizontal overflow`);
      if(id==='seriesDialog') {
        if(output && ['portrait','landscape'].includes(test.name))await page.screenshot({path:path.join(output,'series-safe-'+test.name+'.png')});
        await page.locator('#seriesDialog').evaluate(el=>el.scrollTop=el.scrollHeight);
        const button=await page.locator('#saveSeriesBtn').boundingBox();
        assert(button.y>=bounds.y && button.y+button.height<=bounds.y+bounds.height,'Save remains reachable inside the safe area');
        await page.locator('#seriesDialog').evaluate(el=>el.scrollTop=0);
      }
      await page.evaluate(id=>document.getElementById(id).close(),id);await frames();
    }
    for(const view of ['home','sessions','stats','friends','profile']) {
      await page.click('#nav-'+view);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await frames();
      const header=await page.locator('.topbar').boundingBox();
      assert(header.y>=test.top && header.x>=test.left && header.x+header.width<=test.width-test.right,`${test.name} ${view}: page header must stay within safe bounds`);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${test.name} ${view}: page overflows`);
    }
  }
  // Rotation while a tall modal is open must recompute its usable space.
  await page.click('#nav-home');await page.click('#openSeriesBtn');
  await page.setViewportSize({width:844,height:390});
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:21,left:62,right:62}});await frames();
  const rotated=await page.locator('#seriesDialog').boundingBox();
  assert(rotated.x>=74 && rotated.y>=12 && rotated.y+rotated.height<=357,'Open Series responds to rotation');
  await page.click('[data-close=seriesDialog]');
  assert.deepEqual(errors,[]);
  console.log('PASS safe areas: all seven dialogs and five pages in portrait, landscape, reduced-height, small-phone and desktop viewports; headings, close controls, save access and rotation.');
} finally {await browser?.close();server.close();}
