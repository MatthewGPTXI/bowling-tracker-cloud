const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const harness = fs.readFileSync(path.join(__dirname, 'ui-regression.cjs'), 'utf8').split('(async()=>{')[0]
  .replace('api.test={showView,', 'api.test={validateGameForm,persistDrafts,readDraft,clearDraft,draftKey,showDraftNotice,buildSessions,filteredGames,renderProgress,chartScale,showView,');
const { c, app, t, $, game, database, storage } = vm.runInNewContext(harness + '\n({c,app,t,$,game,database,storage});',
  { require, console, __dirname, setTimeout, clearTimeout, URL, structuredClone, queueMicrotask, setImmediate, process });
const root = path.resolve(__dirname, '..');

(async () => {
  t.setState(database(), []); t.resetEntryForm(); t.wireEvents();
  t.openSeriesEntry();
  assert.equal(t.readDraft('series'), null, 'Opening a blank series must not create a draft');
  assert($('draftNotice').hidden);
  $('seriesDialog').close();
  storage.set(t.draftKey('series'), JSON.stringify({version:1, rows:[{score:'',openFrames:'',strikes:'',strikeOpp:'10',notes:'',balls:[{name:'',frames:''}]}]}));
  t.showDraftNotice(); assert.equal(t.readDraft('series'), null); assert($('draftNotice').hidden);
  t.openSeriesEntry();
  const row = $('seriesRows').children[0];
  row.fields.score.value = '0'; t.persistDrafts();
  assert.equal(t.readDraft('series').rows[0].score, '0', 'A zero score is meaningful input');
  row.fields.score.value = ''; row.fields.notes.value = 'Lane 12'; t.persistDrafts();
  assert.equal(t.readDraft('series').rows[0].notes, 'Lane 12');
  row.fields.notes.value = ''; t.persistDrafts(); assert.equal(t.readDraft('series'), null, 'Cleared fields must remove the empty draft');
  $('seriesDialog').close();

  const sessions = [
    {...game(1,'2026-09-10',170), notes:'Backline Lanes', balls:[{name:'Spare Ball'},{name:'Storm Concept',frames:6}]},
    {...game(2,'2026-09-11',180,'Practice'), notes:'Different center', ball:'Hustle'},
    {...game(3,'2026-09-12',300,'Tournament'), notes:'Backline Lanes', noTap:true, ball:'Storm Concept'}
  ];
  t.setState(database(sessions), sessions);
  const find = query => { $('sessionSearch').value=query; return t.matchingSessions(t.buildSessions(t.filteredGames())); };
  assert.equal(find('CONCEPT').length, 2, 'Search includes every ball, not only the first');
  assert.equal(find('backline lanes').length, 2);
  assert.equal(find('2026-09-11').length, 1);
  assert.equal(find('practice').length, 1);
  $('historyScoring').value='standard'; assert.equal(find('concept').length,1);
  $('historyScoring').value=''; assert.equal(find('no-tap concept').length,1);
  $('sessionFrom').value='2026-09-11'; assert.equal(find('backline').length,1);
  $('sessionSearch').value=''; $('sessionFrom').value='';

  t.resetEntryForm();
  const validate = (score,open,strikes,opp=10) => {
    $('scoreInput').value=String(score); $('openFramesInput').value=String(open);
    $('strikesInput').value=String(strikes); $('strikeOppInput').value=String(opp);
    return t.validateGameForm();
  };
  for (const values of [[300,1,12,12],[290,0,12,12],[90,0,0],[150,10,1],[5,9,1],[180,6,7]]) assert(validate(...values).error, values.join(','));
  for (const values of [[300,0,12,12],[0,10,0],[100,0,0],[180,3,4],[270,1,11,12],[299,0,11,12]]) assert(validate(...values).value, values.join(','));

  const trend = Array.from({length:11}, (_,i) => game(i+10, `2026-09-${String(i+1).padStart(2,'0')}`, i===0?100:200));
  trend.push({...game(99,'2026-09-12',300),noTap:true});
  assert.equal(t.progressStats(trend,'recent').points.at(-1).average,200);
  assert.equal(t.progressStats(trend,'recent').points.at(-1).count,10);
  assert.equal(t.progressStats(trend).points.at(-1).average,2100/11);
  for (const averages of [[0],[300],[175],[0,300],[160,180]]) {
    const scale=t.chartScale(averages.map(average=>({average})));
    assert(scale.low>=0 && scale.high<=300 && scale.high-scale.low>=40);
    assert(averages.every(value=>value>=scale.low && value<=scale.high));
  }
  t.setState(database(trend),trend); $('chartMode').value='recent'; t.renderProgress();
  assert($('averageChart').innerHTML.includes('Last 10 games average'));
  assert($('averageChart').innerHTML.includes('Games in average'));
  assert($('chartScaleNote').textContent.includes('Score scale:'));
  assert(!$('averageChart').innerHTML.includes('NaN'));
  t.setState(database(),[]);t.renderProgress();assert.equal($('chartScaleNote').textContent,'');

  const versionSource=fs.readFileSync(path.join(root,'version.js'),'utf8');
  const label={}; let onReady;
  const page={self:{},document:{addEventListener:(name,fn)=>{assert.equal(name,'DOMContentLoaded');onReady=fn},getElementById:()=>label}};
  vm.runInNewContext(versionSource,page);onReady();assert.equal(label.textContent,`Bowling Tracker · v${page.self.BOWLING_VERSION}`);
  const worker={self:{registration:{scope:'https://example.com/bowling/'},addEventListener(){},skipWaiting(){}},URL};
  worker.importScripts=()=>vm.runInNewContext(versionSource,worker);
  vm.runInNewContext(fs.readFileSync(path.join(root,'service-worker.js'),'utf8')+'\nself.cacheName=CACHE_NAME;self.assets=APP_ASSETS;',worker);
  assert(worker.self.cacheName.endsWith('v'+page.self.BOWLING_VERSION));
  assert(worker.self.assets.includes('./version.js'));
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.equal((html.match(/id="statClosedFramePct"/g)||[]).length,1);
  assert(html.split('aria-label="At a glance"')[1].split('</section>')[0].includes('id="statClosedFramePct"'));
  console.log('PASS: empty/legacy series drafts, zero/notes draft retention, all-ball and notes/date search with scoring filters, contradictory input checks, legal tenth-frame cases, rolling/filtered trends, bounded chart scales, shared release version, and closed-frame placement.');
})().catch(error=>{console.error(error);process.exitCode=1});
