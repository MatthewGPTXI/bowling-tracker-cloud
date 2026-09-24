const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const harness = fs.readFileSync(path.join(__dirname, 'ui-regression.cjs'), 'utf8').split('(async()=>{')[0]
  .replace('api.test={showView,', 'api.test={normalizeGame,validateGameForm,startEdit,saveGameFromForm,persistDrafts,readDraft,recoverDraft,clearDraft,renderComparison,exportCsv,exportBackup,importBackupFile,confirmImport,setDownload(fn){downloadFile=fn;},showView,');
const {c,app,t,$,game,database,storage} = vm.runInNewContext(harness+'\n({c,app,t,$,game,database,storage});',
  {require,console,__dirname,setTimeout,clearTimeout,URL,structuredClone,queueMicrotask,setImmediate,process});
const partial = (id,score) => ({...game(id,'2026-09-01',score),scoreOnly:true,openFrames:null,strikes:null,strikeOpportunities:null});
(async () => {
  const data = [game(1,'2026-09-01',150),partial(2,180),partial(3,210)];
  const db=database(data); t.setState(db,data);t.resetEntryForm();t.wireEvents();app.renderAll();
  const stats=t.calculateStats(data);
  assert.equal(stats.average,180);assert.equal(stats.bestSeries.total,540);assert.equal(stats.frameCount,1);
  assert.equal(stats.strikePct,40);assert.equal(stats.openAvg,3);assert.equal(stats.closedFramePct,70);
  assert.equal(stats.strikesPerGame,4);assert.equal(stats.mostStrikesGame.id,1);
  assert.equal(t.calculateStats([{...data[0],openFrames:0},data[1]]).cleanRate,100);
  assert.equal(t.calculateStats([...data,{...partial(4,300),noTap:true}]).average,180);
  for(const score of [0,180,300]) assert(t.isValidGame(partial(9,score)));
  assert(!t.isValidGame(partial(9,301)));assert(!t.isValidGame({...partial(9,180),strikes:0}));
  assert(!t.isValidGame({...partial(9,180),scoreOnly:false}));
  assert.equal(t.normalizeGame(partial(9,0)).openFrames,null);
  assert.equal(t.normalizeGame(game(9,'2026-09-01',150)).scoreOnly,false);
  const summary=app.getLeaderboardSummary();assert.equal(summary.frameStatsGames,1);assert.equal(summary.scoreOnlyGames,2);
  assert.equal(summary.frameStatsUpdatedAt,summary.updatedAt);
  assert($('sessionsList').innerHTML.includes('Score only'));assert(!$('sessionsList').innerHTML.includes('null strikes'));
  // Empty frame histories are unknown, never 0% or 100% accuracy.
  t.setState(database([partial(2,180)]),[partial(2,180)]);app.renderAll();
  for(const id of ['statStrikePct','statOpenAvg','statClosedFramePct','statCleanGames','moreStrikeAvg']) assert.equal($ (id).textContent,'—',id);
  assert.equal(app.getLeaderboardSummary().strikePct,null);
  // Score-only can be edited, converted to full stats, and converted back.
  t.setState(db,data);t.resetEntryForm();t.startEdit(2);assert.equal($('entryDetailInput').value,'score-only');
  $('scoreInput').value='190';await t.saveGameFromForm();assert.equal(db.stores.games.get(2).strikes,null);
  t.startEdit(2);$('entryDetailInput').value='full';await $('entryDetailInput').fire('change');
  assert(t.validateGameForm().error);$('openFramesInput').value='2';$('strikesInput').value='5';await t.saveGameFromForm();
  assert.equal(db.stores.games.get(2).scoreOnly,false);assert.equal(db.stores.games.get(2).strikes,5);
  t.startEdit(2);$('entryDetailInput').value='score-only';await $('entryDetailInput').fire('change');await t.saveGameFromForm();
  assert.equal(db.stores.games.get(2).strikes,null);
  t.resetEntryForm();$('entryDetailInput').value='score-only';$('scoreInput').value='0';t.persistDrafts();
  $('entryDetailInput').value='full';t.recoverDraft('entry');assert.equal($('entryDetailInput').value,'score-only');assert.equal($('scoreInput').value,'0');
  t.clearDraft('entry');t.resetEntryForm();$('entryDetailInput').value='score-only';t.openSeriesEntry();
  const rows=$('seriesRows').children;rows.forEach((row,i)=>{row.fields.score.value=String(160+i*10);assert.equal(row.fields.openFrames.disabled,true);});
  rows[1].fields.entryDetail.value='full';await rows[1].fields.entryDetail.fire('change');
  rows[1].fields.openFrames.value='3';rows[1].fields.strikes.value='4';
  t.persistDrafts();$('seriesDialog').close();t.recoverDraft('series');
  assert.equal($('seriesRows').children[0].fields.entryDetail.value,'score-only');assert.equal($('seriesRows').children[1].fields.entryDetail.value,'full');
  await t.saveSeries({preventDefault(){}});assert.equal(app.getGames().filter(g=>g.scoreOnly).length,4);
  const downloads=[];t.setDownload((name,contents)=>downloads.push({name,contents}));await t.exportBackup();
  const backup=JSON.parse(downloads.at(-1).contents);assert(backup.games.some(g=>g.scoreOnly&&g.strikes===null));
  t.exportCsv();const csv=downloads.at(-1).contents;assert(csv.includes('Entry Detail'));assert(csv.includes('Score only'));assert(!csv.includes('null'));
  const exported=backup.games.find(g=>g.scoreOnly);await app.applyRemoteChanges({expectedUid:'a',upserts:[{...exported,score:199,updatedAt:Date.now()+10}]});
  assert.equal(app.getGames().find(g=>g.id===exported.id).strikes,null);
  await t.importBackupFile({text:async()=>JSON.stringify({games:[partial(99,250)]})});await t.confirmImport();
  assert.equal(app.getGames().find(g=>g.id===99).score,250);
  // Payloads/conflicts distinguish unknown details from recorded zeroes.
  const source=fs.readFileSync(path.join(__dirname,'../cloud.js'),'utf8');
  const cloud={window:c.window,Date};vm.createContext(cloud);
  vm.runInContext(source.slice(source.indexOf('  function cloudGamePayload'),source.indexOf('  function gameReviewHtml')),cloud);
  const payload=cloud.cloudGamePayload(partial(55,200));assert.equal(payload.strikes,null);assert.equal(payload.strikeOpportunities,null);
  assert.equal(cloud.sameGameContent(payload,partial(55,200)),true);
  assert.equal(cloud.sameGameContent(payload,{...partial(55,200),scoreOnly:false,strikes:0,openFrames:0,strikeOpportunities:10}),false);
  // Friend denominators reflect only games with frame details.
  c.window.BowlingApp.ready=true;vm.runInContext(fs.readFileSync(path.join(__dirname,'../friend-stats.js'),'utf8'),c);
  const friends=c.window.BowlingFriends;
  friends.setMembers([{uid:'b',displayName:'Friend',...summary}],{uid:'a',groupId:'one',revision:1});friends.open('b');
  assert($('friendStatsContent').innerHTML.includes('<dt>Strikes / game</dt><dd>4.00</dd>'));
  t.clearUndo();console.log('PASS: score-only validation, zero/300 scores, measured-only frame stats, mixed series, edits, drafts, JSON/CSV, imports, cloud payloads/conflicts, and friend denominators.');
})().catch(e=>{console.error(e);process.exitCode=1});
