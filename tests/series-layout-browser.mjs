// Android series-layout regression. All entry and recovery checks use local synthetic data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const {chromium, devices} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.env.UX_APP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.UX_TEST_OUTPUT;
if (output) await fs.mkdir(output, {recursive:true});
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, {'Content-Type':({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.json':'application/json'})[path.extname(file)] || 'application/octet-stream'});
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined, args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({...devices['Pixel 7'], viewport:{width:360,height:760}, serviceWorkers:'block'});
  await context.route('https://**', route => route.abort());
  await context.route('**/firebase-config.js', route => route.fulfill({contentType:'text/javascript',body:'window.BOWLING_FIREBASE_CONFIG = {};'}));
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const ready = () => page.waitForFunction(() => window.BowlingApp?.ready);
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await ready();
  await page.evaluate(async () => {
    await BowlingApp.editBallInventory('Layout test ball');
    await BowlingApp.editAlleyInventory('Layout test lanes');
  });
  await page.click('#openSeriesBtn');
  const rows = page.locator('#seriesRows .series-row');
  assert.equal(await rows.count(), 3);
  for (const fontSize of [16,20,24,32]) {
    for (const viewport of [
      {width:360,height:760}, {width:354,height:760}, {width:320,height:568},
      {width:390,height:844}, {width:412,height:839}, {width:640,height:360},
      {width:768,height:900}, {width:1280,height:900}
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(font => { document.documentElement.style.fontSize = font + 'px'; }, fontSize);
      await page.locator('#seriesDialog').evaluate(el => { el.scrollTop = 0; });
      await frames();
      if (output && fontSize === 16 && viewport.width === 360) {
        await page.screenshot({path:path.join(output,'series-android-360.png')});
      }
      for (let i=0; i<await rows.count(); i++) {
        const row = rows.nth(i);
        const score = await row.locator('[data-field=score]').boundingBox();
        const opens = await row.locator('[data-field=openFrames]').boundingBox();
        const strikes = await row.locator('[data-field=strikes]').boundingBox();
        const name = `${viewport.width}px, ${fontSize}px text, game ${i+1}`;
        if (Math.abs(opens.x-strikes.x) < 1) {
          assert(score.y+score.height <= opens.y && opens.y+opens.height <= strikes.y, `${name}: stacked controls never overlap`);
          assert(Math.abs(score.width-opens.width) < 1 && Math.abs(opens.width-strikes.width) < 1, `${name}: stacked controls use equal full widths`);
        } else {
          assert(Math.abs(opens.y-strikes.y) < 1, `${name}: Open frames and Strikes inputs must align (${opens.y} vs ${strikes.y})`);
          if (Math.abs(score.y-opens.y) < 1) {
            assert(Math.abs(score.width-opens.width) < 1, `${name}: controls sharing a row have equal widths`);
          } else {
            assert(score.y+score.height <= opens.y, `${name}: compact layouts put Score above the frame fields`);
            assert(score.width > opens.width * 1.8, `${name}: compact layouts give the score a full row (${score.width} vs ${opens.width})`);
          }
        }
        const brokenWords = await row.locator('.series-metric > span').evaluateAll(labels => labels.flatMap(label => {
          const text = label.firstChild;
          return [...text.textContent.matchAll(/\S+/g)].filter(word => {
            const range = document.createRange();
            range.setStart(text, word.index); range.setEnd(text, word.index+word[0].length);
            const rects = [...range.getClientRects()];
            const bounds = label.getBoundingClientRect();
            return rects.length > 1 || rects.some(rect => rect.left < bounds.left-1 || rect.right > bounds.right+1);
          }).map(word => word[0]);
        }));
        assert.deepEqual(brokenWords, [], `${name}: field labels stay readable without splitting words`);
        for (const box of [score, opens, strikes]) assert(box.height >= 44, `${name}: entry controls retain mobile touch targets`);
        const advanced = await row.locator('[data-ball-advanced] > summary').boundingBox();
        const remove = await row.locator('.remove-series-row').boundingBox();
        assert(advanced.height >= 44 && remove.height >= 44, `${name}: game actions retain mobile touch targets`);
        if (fontSize === 16) assert(Math.abs(advanced.y-remove.y) < 1, `${name}: collapsed game actions share one row`);
        assert(advanced.y+advanced.height <= remove.y || advanced.x+advanced.width <= remove.x, `${name}: larger text wraps actions without overlap`);
      }
      const overflow = await page.locator('#seriesDialog').evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return {overflows:el.scrollWidth > el.clientWidth, elements:[...el.querySelectorAll('*')]
          .filter(child => child.getBoundingClientRect().right > bounds.right)
          .map(child => ({tag:child.tagName, class:child.className, text:child.textContent.slice(0,60)}))};
      });
      if (output && fontSize === 32 && viewport.width === 360) await page.screenshot({path:path.join(output,'series-android-large-text.png')});
      assert(!overflow.overflows, `${viewport.width}px/${fontSize}px: no horizontal dialog overflow ${JSON.stringify(overflow.elements)}`);
      const close = await page.locator('[data-close=seriesDialog]').boundingBox();
      assert(close.x >= 0 && close.x+close.width <= viewport.width && close.y >= 0 && close.y+close.height <= viewport.height, 'Close stays reachable at the start of the dialog');
      await page.locator('#seriesDialog').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const save = await page.locator('#saveSeriesBtn').boundingBox();
      assert(save.y >= 0 && save.y+save.height <= viewport.height, 'Save stays reachable at the end of the dialog');
    }
  }
  await page.setViewportSize({width:360,height:760});
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  for (let i=0; i<3; i++) {
    await rows.nth(i).locator('[data-field=score]').fill(String(180+i*10));
    await rows.nth(i).locator('[data-field=openFrames]').fill('3');
    await rows.nth(i).locator('[data-field=strikes]').fill('4');
  }
  await rows.nth(1).locator('[data-field=entryDetail]').selectOption('score-only');
  for (const field of ['openFrames','strikes','strikeOpp']) {
    assert(!await rows.nth(1).locator(`[data-field=${field}]`).isVisible(), `${field} stays hidden in score-only mode`);
  }
  const scoreOnlyWidth = (await rows.nth(1).locator('[data-field=score]').boundingBox()).width;
  const coreWidth = (await rows.nth(1).locator('.series-core').boundingBox()).width;
  assert(scoreOnlyWidth >= coreWidth-1, 'Score-only entry uses the available row width');
  await rows.nth(0).locator('[data-ball-advanced] > summary').click();
  await rows.nth(0).locator('[data-field=notes]').fill('Series layout draft');
  await rows.nth(0).locator('[data-field=ball]').selectOption('Layout test ball');
  const ball = await rows.nth(0).locator('[data-field=ball]').boundingBox();
  const remove = await rows.nth(0).locator('.remove-series-row').boundingBox();
  assert(remove.y >= ball.y+ball.height, 'Expanded equipment fields do not overlap Remove game');
  await page.locator('#seriesDetails > summary').click();
  await page.fill('#seriesDate','2026-09-29');
  await page.selectOption('#seriesType','Practice');
  await page.locator('#seriesAdvanced > summary').click();
  await page.selectOption('#seriesNoTap','no-tap');
  await page.selectOption('#seriesAlley','Layout test lanes');
  // The markup change must not lose nested notes/equipment or score-only state on reload.
  await page.reload(); await ready();
  await page.click('#recoverSeries');
  assert.equal(await rows.count(), 3);
  assert.equal(await rows.nth(0).locator('[data-field=notes]').inputValue(), 'Series layout draft');
  assert.equal(await rows.nth(0).locator('[data-field=ball]').inputValue(), 'Layout test ball');
  assert.equal(await rows.nth(1).locator('[data-field=entryDetail]').inputValue(), 'score-only');
  assert(!await rows.nth(1).locator('[data-field=openFrames]').isVisible());
  await page.click('#saveSeriesBtn');
  await page.waitForFunction(() => BowlingApp.getGames().length === 3);
  const games = await page.evaluate(() => BowlingApp.getGames());
  assert.deepEqual(games.map(g => g.score).sort((a,b) => a-b), [180,190,200]);
  assert(games.every(g => g.date === '2026-09-29' && g.sessionType === 'Practice' && g.noTap && g.alley === 'Layout test lanes'));
  assert.equal(games.find(g => g.score === 180).notes, 'Series layout draft');
  assert.equal(games.find(g => g.score === 180).ball, 'Layout test ball');
  assert.equal(games.find(g => g.score === 190).strikes, null);
  assert.equal(await page.locator('.app-view:not([hidden])').getAttribute('id'), 'view-home');
  await page.click('#openSeriesBtn');
  await rows.nth(0).locator('.remove-series-row').click();
  assert.equal(await rows.count(), 2);
  await rows.nth(0).locator('.remove-series-row').click();
  assert.equal(await rows.count(), 1);
  assert(await rows.nth(0).locator('.remove-series-row').isDisabled());
  await page.click('[data-close=seriesDialog]');
  await frames();
  assert(!await page.locator('#seriesDialog').isVisible());
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).position), 'static');
  assert.deepEqual(errors, []);
  console.log('PASS Android series layout: aligned controls, compact actions, 320–1280px/100–200% text, touch targets, short viewport access, score-only, advanced equipment, draft recovery, no-tap/session metadata and row removal.');
} finally { await browser?.close(); server.close(); }
