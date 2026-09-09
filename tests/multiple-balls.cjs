const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const Balls = require('../balls.js');
const harness = fs.readFileSync(path.join(__dirname, 'ui-regression.cjs'), 'utf8').split('(async()=>{')[0]
  .replace('api.test={showView,', 'api.test={normalizeGame,statsGames,applySeriesBall,startEdit,saveGameFromForm,persistDrafts,recoverDraft,readDraft,clearDraft,buildImportPlan,importBackupFile,confirmImport,exportBackup,exportCsv,setDownload(fn){downloadFile=fn;},showView,');
const {c, app, t, $, game, database, element, storage} = vm.runInNewContext(harness + '\n({c,app,t,$,game,database,element,storage});',
  {require, console, __dirname, setTimeout, clearTimeout, URL, structuredClone, queueMicrotask, setImmediate, process});
const plain = value => JSON.parse(JSON.stringify(value));
const breakdown = [{name: 'Venom', frames: 4}, {name: 'Mercy', frames: 6}];

(async () => {
  const original = {...game(1, '2026-09-01', 180), ball: 'Venom'};
  const db = database([original]); t.setState(db, [original]); t.resetEntryForm(); t.wireEvents();
  assert.deepEqual(Balls.list(original), [{name: 'Venom', frames: null}]);
  assert.equal(Balls.error(breakdown), '');
  assert.equal(Balls.error([{name: 'Spare ball'}]), '');
  for (const rows of [null, [null], [{name: '', frames: 2}], [{name: 'A', frames: 0}], [{name: 'A', frames: 1.5}],
    [{name: 'A', frames: '4'}], [{name: 'A', frames: NaN}], [{name: 'A', frames: 11}],
    [{name: 'A', frames: 5}, {name: 'B', frames: 6}], [{name: 'A'}, {name: ' a '}], [{name: 'x'.repeat(101)}]]) {
    assert(Balls.error(rows)); assert(!t.isValidGame({...original, balls: rows}));
  }
  assert.equal(Balls.error([{name: 'A', frames: 4}, {name: 'B'}]), '', 'Partial counts are allowed without guessing the rest');
  assert.deepEqual(plain(t.normalizeGame(original).balls), [{name: 'Venom', frames: null}]);

  // Exercise the real editor handlers with simulated elements, not just its data helpers.
  t.startEdit(1);
  const firstFrameLabel = $('gameBallFirst').children[0], firstFrame = firstFrameLabel.children[0];
  const add = $('gameBallEditor').children.find(node => node.className === 'text-btn ball-add');
  const extras = $('gameBallEditor').children.find(node => node.className === 'ball-extra-rows');
  assert(firstFrameLabel.hidden); assert.equal(extras.children.length, 0);
  await add.fire('click'); assert(!firstFrameLabel.hidden); assert.equal(extras.children.length, 0);
  firstFrame.value = '5'; await firstFrame.fire('input');
  await add.fire('click'); const extra = extras.children[0];
  extra.children[0].children[0].value = 'Mercy'; extra.children[1].children[0].value = '6';
  await extra.children[1].children[0].fire('input');
  await t.saveGameFromForm(); assert($('entryStatus').textContent.includes('more than 10')); assert.equal(db.stores.games.get(1).balls, undefined);
  firstFrame.value = '4'; await firstFrame.fire('input'); await t.saveGameFromForm();
  assert.deepEqual(plain(db.stores.games.get(1).balls), breakdown); assert.equal(db.stores.games.get(1).ball, 'Venom');
  app.renderAll(); assert($('sessionsList').innerHTML.includes('Venom · 4 frames / Mercy · 6 frames'));
  assert($('ballOptions').innerHTML.includes('Mercy'));
  $('statsBall').value = 'ball:mercy'; await $('statsBall').fire('change');
  assert.equal($('statAverage').textContent, '180.0'); assert.equal($('statClosedFramePct').textContent, '70.0%'); assert(!$('statsBallNote').hidden);
  $('statsBall').value = 'none'; await $('statsBall').fire('change'); assert.equal(t.statsGames().length, 0);
  $('statsBall').value = ''; await $('statsBall').fire('change');

  t.startEdit(1); Balls.set($('ballInput'), [{name: 'Venom', frames: 4}, {name: 'Mercy', frames: 5}]);
  t.persistDrafts(); Balls.set($('ballInput'), []); t.recoverDraft('entry');
  assert.deepEqual(Balls.fromDraft(Balls.draft($('ballInput'))), [{name: 'Venom', frames: 4}, {name: 'Mercy', frames: 5}]);
  assert(t.hasEntryDraft(), 'Recovered frame-only edits are still unsaved changes');
  Balls.set($('ballInput'), breakdown); await t.saveGameFromForm();

  const downloads = []; t.setDownload((name, contents) => downloads.push({name, contents}));
  await t.exportBackup(); assert.deepEqual(JSON.parse(downloads.at(-1).contents).games[0].balls, breakdown);
  t.exportCsv(); assert(downloads.at(-1).contents.includes('Ball Usage')); assert(downloads.at(-1).contents.includes('""frames"":4')); assert(downloads.at(-1).contents.includes('Mercy'));
  const saved = db.stores.games.get(1), modified = {...saved, balls: [{name: 'Venom', frames: 5}, {name: 'Mercy', frames: 5}]};
  assert.equal(t.buildImportPlan([modified], [], [saved], [])[0].kind, 'conflict');
  assert.equal(t.buildImportPlan([t.normalizeGame(original)], [], [original], [])[0].kind, 'duplicate');
  await t.importBackupFile({text: async () => JSON.stringify({games: [modified]})});
  assert($('importPreviewRows').innerHTML.includes('Venom · 5 frames')); assert($('importPreviewRows').innerHTML.includes('Venom · 4 frames'));
  const choice = element(); choice.dataset.importId = '1'; choice.value = 'backup';
  $('importPreviewRows').querySelectorAll = () => [choice]; await t.confirmImport();
  assert.deepEqual(plain(db.stores.games.get(1).balls), modified.balls);
  await app.applyRemoteChanges({upserts: [{...saved, id: 99}], deletes: []});
  assert.deepEqual(plain(db.stores.games.get(99).balls), breakdown);
  await t.importBackupFile({text: async () => JSON.stringify({games: [{...saved, id: 100, balls: [{name: 'A', frames: 11}]}]})});
  assert(!db.stores.games.has(100)); assert($('settingsStatus').textContent.includes('Import failed'));

  // Moving an entry into series entry preserves its game-specific breakdown only on game 1.
  t.resetEntryForm(); $('scoreInput').value = '180'; $('openFramesInput').value = '3'; $('strikesInput').value = '4'; Balls.set($('ballInput'), breakdown);
  t.openSeriesEntry(); let rows = [...$('seriesRows').children];
  assert.deepEqual(Balls.fromDraft(Balls.draft(rows[0].fields.ball)), breakdown);
  assert.deepEqual(Balls.fromDraft(Balls.draft(rows[1].fields.ball)), [{name: 'Venom', frames: null}]);
  $('seriesBall').value = 'Venom'; c.window.confirm = () => false; t.applySeriesBall();
  assert.deepEqual(Balls.fromDraft(Balls.draft(rows[0].fields.ball)), breakdown, 'Bulk apply never silently clears allocations');
  c.window.confirm = () => true;
  t.persistDrafts(); $('seriesDialog').close(); t.recoverDraft('series'); rows = [...$('seriesRows').children];
  assert.deepEqual(Balls.fromDraft(Balls.draft(rows[0].fields.ball)), breakdown);
  for (const row of rows) {row.fields.score.value = '190'; row.fields.openFrames.value = '3'; row.fields.strikes.value = '4';}
  await t.saveSeries({preventDefault(){}});
  assert.equal(app.getGames().filter(g => g.score === 190 && g.balls.length === 2).length, 1);

  // Removing the primary ball promotes the next one and its count; frame counters remain optional.
  t.startEdit(99); await $('gameBallFirst').children[1].fire('click');
  assert.deepEqual(Balls.fromDraft(Balls.draft($('ballInput'))), [{name: 'Mercy', frames: 6}]);
  await t.saveGameFromForm(); assert.equal(db.stores.games.get(99).ball, 'Mercy');
  t.startEdit(99); Balls.set($('ballInput'), []); await t.saveGameFromForm(); assert.deepEqual(plain(db.stores.games.get(99).balls), []);
  const tagged = {...saved, noTap: true}; t.setState(database([tagged]), [tagged]); app.renderAll();
  assert.equal($('statAverage').textContent, '—'); assert.equal($('statClosedFramePct').textContent, '—');
  t.clearUndo(); console.log('PASS: compact editor interactions, 4/6 frame counts, validation, editing/removal, all-ball filtering, whole-game statistics, drafts, series, JSON/CSV, import review, remote downloads, legacy data and no-tap exclusions.');
})().catch(error => {console.error(error); t.clearUndo(); process.exitCode = 1;});
