import {fixture} from './performance.mjs';
// Browser regression for the approved UX redesign. Uses only synthetic, local data.
// Supply PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE when installed outside the app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const results=[];
  for (const count of [1000,5000]) {
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    await context.route('https://**',route=>route.abort());
    await context.route('**/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.BOWLING_FIREBASE_CONFIG = {};'}));
    const page=await context.newPage();page.setDefaultTimeout(20000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>BowlingApp.ready);
    const records=fixture(count);
    const operations=await page.evaluate(async records=>{
      const app=BowlingApp;
      const start=performance.now();await app.applyRemoteChanges({upserts:records});const writeAndRenderMs=performance.now()-start;
      const render=performance.now();app.renderAll();const renderMs=performance.now()-render;
      return{writeAndRenderMs,renderMs,count:app.getGames().length};
    },records);
    assert.equal(operations.count,count);
    await page.click('#nav-sessions');
    const filter=performance.now();await page.fill('#sessionSearch','Alley 1');
    assert(await page.locator('.session-card').count()>0);const filterMs=performance.now()-filter;
    const reload=performance.now();await page.reload();await page.waitForFunction(()=>BowlingApp.ready);const startupMs=performance.now()-reload;
    assert.equal(await page.evaluate(()=>BowlingApp.getGames().length),count);
    assert.equal(await page.locator('.app-view:not([hidden])').getAttribute('id'),'view-sessions');
    // Unchanged history rows retain their DOM identity; delegated actions are
    // still attached after a second render and after filtering.
    await page.locator('.session-card').first().evaluate(el=>{el.dataset.testIdentity='retained';});
    await page.evaluate(()=>BowlingApp.renderAll());
    assert.equal(await page.locator('.session-card').first().getAttribute('data-test-identity'),'retained');
    await page.locator('.session-header').first().click();await page.locator('.game-actions-toggle').first().click();
    assert.equal(await page.locator('.game-actions-toggle').first().getAttribute('aria-expanded'),'true');
    assert.deepEqual(errors,[]);
    results.push({games:count,...operations,filterMs,startupMs});await context.close();
  }
  console.log('PASS large-history browser: real IndexedDB, startup, rendering, filtering, reload route and retained DOM at 1,000/5,000 games.');
  console.log(JSON.stringify(results.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Math.round(value*100)/100])))));

} finally {await browser?.close();server.close();}
