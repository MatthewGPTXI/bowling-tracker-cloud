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
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined, args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport:{width:390,height:844}, serviceWorkers:'block'});
  await context.route('https://**',route => route.abort());
  await context.route('**/firebase-config.js',route => route.fulfill({contentType:'text/javascript',body:'window.BOWLING_FIREBASE_CONFIG = {};'}));
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors=[]; page.on('pageerror',error => errors.push(error.message));
  page.on('dialog',dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.BowlingApp?.ready);
  const appGames = () => page.evaluate(() => BowlingApp.getGames());
  const disclose = async (selector,open=true) => { if (await page.locator(selector).evaluate(el=>el.open) !== open) await page.locator(selector+'>summary').click(); };
  const fullGame = async(score,opens=3,strikes=4) => {
    await page.locator('[name=entryTracking][value=full]').check();
    await page.fill('#scoreInput',String(score));await page.fill('#openFramesInput',String(opens));await page.fill('#strikesInput',String(strikes));
  };
  const save = async(count) => {await page.click('#saveGameBtn');await page.waitForFunction(count => BowlingApp.getGames().length === count,count);};
  const screenshot = async(name) => {if(output)await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});};
  assert.equal(await page.locator('.app-nav button').count(),4);
  assert(!await page.locator('#sessionMode').isVisible());
  assert(!await page.locator('#dateInput').isVisible());
  assert(await page.locator('#strikeOppInput').isVisible());
  await page.evaluate(async()=>{await BowlingApp.setProfileName('Matthew');await BowlingApp.editBallInventory('Phaze II');await BowlingApp.editAlleyInventory('Bowlero Pasadena');});
  await disclose('#gameAdvanced');
  await page.selectOption('#sessionTypeInput','Practice');await page.selectOption('#alleyInput','Bowlero Pasadena');await page.selectOption('#ballInput','Phaze II');await page.fill('#notesInput','Keep this note');
  await fullGame(178);await save(1);
  const first=(await appGames())[0];
  assert.equal(first.alley,'Bowlero Pasadena');assert.equal(first.ball,'Phaze II');assert.equal(first.notes,'Keep this note');
  assert.equal(await page.inputValue('#scoreInput'),'');assert.equal(await page.inputValue('#sessionNameInput'),first.sessionName);
  assert.equal(await page.inputValue('#alleyInput'),'Bowlero Pasadena');assert.equal(await page.inputValue('#sessionTypeInput'),'Practice');
  assert.equal(await page.inputValue('#ballInput'),'Phaze II');assert(!await page.locator('#gameAdvanced').evaluate(el=>el.open));
  assert.match(await page.locator('#entrySessionSummary').textContent(),/1 game.*178.0 avg/);
  assert.match(await page.locator('#entryStatus').textContent(),/Game saved/);
  await fullGame(80,0,2);await page.click('#saveGameBtn');assert.equal((await appGames()).length,1);assert.match(await page.locator('#entryStatus').textContent(),/clean game/i);
  await page.locator('[name=entryTracking][value=score-only]').check();
  assert(!await page.locator('#strikesInput').isVisible());assert(!await page.locator('#strikeOppInput').isVisible());
  await page.fill('#scoreInput','191');await save(2);
  const second=(await appGames()).find(g=>g.score===191);assert.equal(second.scoreOnly,true);assert.equal(second.strikes,null);assert.equal(second.sessionName,first.sessionName);
  await disclose('#gameAdvanced');await page.selectOption('#noTapInput','no-tap');await page.fill('#scoreInput','250');await save(3);
  await page.click('#nav-stats');assert.equal(await page.locator('#statAverage').textContent(),'184.5');assert.equal(await page.locator('#statStrikePct').textContent(),'40.0%');
  assert(!await page.locator('#statsType').isVisible());
  await disclose('#statsFilters');await page.selectOption('#statsType','Practice');await page.selectOption('#statsAlley','alley:bowlero pasadena');await disclose('#statsFilters',false);
  assert.equal(await page.locator('#statsFiltersLabel').textContent(),'Filters · 2');assert.match(await page.locator('#statsRangeStatus').textContent(),/Practice.*Bowlero Pasadena/);
  await disclose('#statsFilters');await page.click('#clearStatsFilters');await disclose('#statsFilters',false);
  assert.equal(await page.locator('#statsFiltersLabel').textContent(),'Filters');
  assert(!await page.locator('#statAverageSeries').isVisible());await page.locator('summary').filter({hasText:'More bowling stats'}).first().click();assert(await page.locator('#statAverageSeries').isVisible());
  await page.click('#nav-home');await disclose('#sessionContext');await page.selectOption('#sessionMode','new');await disclose('#sessionContext',false);
  await fullGame(204,2,6);await save(4);assert.notEqual((await appGames()).find(g=>g.score===204).sessionName,first.sessionName);
  // Unsaved inputs survive tab changes and actual browser reloads.
  await fullGame(160,4,3);await page.click('#nav-sessions');await page.click('#nav-home');assert.equal(await page.inputValue('#scoreInput'),'160');
  await page.reload();await page.waitForFunction(()=>BowlingApp.ready);await page.click('#recoverEntry');assert.equal(await page.inputValue('#scoreInput'),'160');await save(5);
  // A photo remains a reference; toggling it never replaces the numeric entry.
  await page.click('#photoTab');assert(await page.locator('#photoArea').isVisible());
  await page.setInputFiles('#scoreboardPhoto',{name:'board.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});
  assert(await page.locator('#photoPreview').isVisible());await page.click('#clearPhotoBtn');await page.click('#photoTab');assert(!await page.locator('#photoArea').isVisible());
  // Series save continues the selected session and preserves optional notes.
  await page.click('#openSeriesBtn');assert(await page.locator('#seriesDialog').isVisible());assert(!await page.locator('#seriesDate').isVisible());
  const rows=page.locator('#seriesRows .series-row');
  for(let i=0;i<3;i++){await rows.nth(i).locator('[data-field=score]').fill(String(170+i*10));await rows.nth(i).locator('[data-field=openFrames]').fill('3');await rows.nth(i).locator('[data-field=strikes]').fill('4');}
  await rows.nth(0).locator('[data-ball-advanced]>summary').click();await rows.nth(0).locator('[data-field=notes]').fill('Series note');
  assert.match(await page.locator('#seriesPreview').textContent(),/Total 540.*180.0/);await screenshot('series-mobile');
  await page.click('#saveSeriesBtn');await page.waitForFunction(()=>BowlingApp.getGames().length===8);assert(!await page.locator('#seriesDialog').isVisible());
  assert((await appGames()).some(g=>g.notes==='Series note'));
  // Summary-first sessions, filter clearing, game edit/delete/Undo and sharing.
  await page.click('#nav-sessions');assert.equal(await page.locator('.session-card[open]').count(),0);
  await disclose('#sessionFilters');await page.selectOption('#sortFilter','oldest');await page.selectOption('#historyScoring','no-tap');await disclose('#sessionFilters',false);
  assert.equal(await page.locator('#sessionFiltersLabel').textContent(),'Filters · 2');assert.equal(await page.locator('.session-card').count(),1);
  await disclose('#sessionFilters');await page.click('#clearSessionFilters');await disclose('#sessionFilters',false);assert.equal(await page.inputValue('#sortFilter'),'newest');
  await page.locator('.session-header').first().click();await page.locator('.game-actions-toggle').first().click();await page.locator('.edit-game').first().click();
  assert(await page.locator('#cancelEditBtn').isVisible());await page.fill('#scoreInput','179');await page.click('#saveGameBtn');await page.waitForFunction(()=>BowlingApp.getGames().some(g=>g.score===179));
  await page.click('#nav-sessions');await page.locator('.game-actions-toggle').first().click();await page.locator('.delete-game').first().click();await page.waitForFunction(()=>BowlingApp.getGames().length===7);await page.click('#undoDeleteBtn');await page.waitForFunction(()=>BowlingApp.getGames().length===8);
  await page.locator('.session-share-button').first().click();await page.waitForSelector('#saveScoreCard:visible');await page.click('#closeScoreCard');
  // Profile routes reuse the existing inventory, local edit, backup and cloud tools.
  await page.click('#nav-profile');assert(await page.locator('#view-profile').isVisible());assert.equal(await page.locator('.app-nav button').count(),4);
  await page.click('#editProfileBtn');assert(await page.locator('#settingsDialog').isVisible());await page.fill('#defaultBowlerInput','Matt');await page.click('#saveDefaultBowlerBtn');await page.click('#closeSettingsBtn');assert.equal(await page.locator('#headerProfileName').textContent(),'Matt');
  await page.locator('.profile-row>summary').filter({hasText:'Ball inventory'}).click();await page.fill('#inventoryBallName','Spare ball');await page.click('#saveInventoryBall');await page.waitForFunction(()=>BowlingApp.getBallInventory().some(b=>b.name==='Spare ball'));
  await page.locator('.profile-row>summary').filter({hasText:'Ball inventory'}).click();
  await page.locator('.profile-row>summary').filter({hasText:'Settings'}).click();await page.fill('#goalAverageInput','175');await page.click('#saveGoalAverageBtn');assert.equal(await page.locator('#profileGoalSummary').textContent(),'175.0');await page.locator('.profile-row>summary').filter({hasText:'Settings'}).click();
  await page.click('#profileImportExportBtn');assert(await page.locator('#exportJsonBtn').isVisible());const downloadPromise=page.waitForEvent('download');await page.click('#exportJsonBtn');const backup=await downloadPromise;const payload=JSON.parse(await fs.readFile(await backup.path(),'utf8'));assert.equal(payload.games.length,8);assert(payload.games.some(g=>g.noTap));await page.click('#closeSettingsBtn');
  await page.click('#openCloudBtn');assert(await page.locator('#cloudDialog').isVisible());await page.click('#closeCloudBtn');
  await page.locator('.profile-row>summary').filter({hasText:'About / Version'}).click();assert(await page.locator('#appVersion').isVisible());await page.locator('.profile-row>summary').filter({hasText:'About / Version'}).click();
  // No horizontal overflow, no duplicate IDs, and a visible bottom bar at mobile widths.
  for(const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:844});
    for(const view of ['home','sessions','stats','friends','profile']) {
      await page.click('#nav-'+view);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${view} overflows at ${width}`);
      const nav=await page.locator('.app-nav').boundingBox();if(width<=700)assert(nav.y+nav.height<=845 && nav.y>700, 'Mobile tabs stay at the bottom');
      if(width===390 || width===1280)await screenshot(`${view}-${width}`);
    }
  }
  const duplicates=await page.evaluate(()=>[...document.querySelectorAll('[id]')].map(el=>el.id).filter((id,i,ids)=>ids.indexOf(id)!==i));assert.deepEqual(duplicates,[]);
  await page.evaluate(()=>BowlingApp.activateAccount('ux-test-only'));assert.equal((await appGames()).length,0);assert.equal(await page.locator('#profileGoalSummary').textContent(),'Not set');
  await page.evaluate(()=>BowlingApp.setSyncStatus('Saved on this device · needs sync','error'));
  assert.match(await page.locator('#globalSyncStatus').textContent(),/Sync needs attention/);assert(await page.locator('#headerSyncNotice').isVisible());
  await page.evaluate(()=>BowlingApp.setSyncStatus('Synced just now','on'));assert.equal(await page.locator('#globalSyncStatus').textContent(),'✓ Synced');assert(!await page.locator('#headerSyncNotice').isVisible());
  assert.equal(await page.locator('#profileScopeSummary').textContent(),'Saved account profile', 'An account switch cannot reuse the previous account email');
  assert.deepEqual(errors,[]);
  console.log('PASS UX browser: full/score-only/no-tap entries, continuation and new sessions, metadata, validation, drafts/reload, photos, series, filters, edit/delete/Undo, sharing, Profile/inventory/goal/backup routes, account isolation, 320–1280px layouts, four bottom tabs and unique IDs.');
} finally {await browser?.close();server.close();}
