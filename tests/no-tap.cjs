const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const harness = fs.readFileSync(path.join(__dirname, 'ui-regression.cjs'), 'utf8').split('(async()=>{')[0]
  .replace('api.test={showView,', 'api.test={isNoTap,normalizeGame,statsGames,periodComparison,buildSessions,filteredGames,historySummary,moveGame,startEdit,saveGameFromForm,changeSessionMode,selectEntrySession,persistDrafts,readDraft,recoverDraft,clearDraft,buildImportPlan,importBackupFile,confirmImport,exportBackup,exportCsv,setDownload(fn){downloadFile=fn;},showView,');
const { c, app, t, $, game, database, element, storage } = vm.runInNewContext(harness + '\n({c,app,t,$,game,database,element,storage});',
  { require, console, __dirname, setTimeout, clearTimeout, URL, structuredClone, queueMicrotask, setImmediate, process });
const root = path.resolve(__dirname, '..');
const submit = { preventDefault() {} };
const clearFilters = () => ['statsFrom', 'statsTo', 'statsType', 'statsBall', 'historyScoring', 'sessionSearch', 'sessionFrom', 'sessionTo'].forEach(id => { $(id).value = ''; });
const setScores = () => {
  for (const row of $('seriesRows').children) {
    row.fields.score.value = '190'; row.fields.openFrames.value = '3'; row.fields.strikes.value = '4';
  }
};

(async () => {
  const standard = [game(1, '2026-09-01', 150), game(2, '2026-09-01', 180), game(3, '2026-09-01', 210)];
  const noTap = { ...game(4, '2026-09-01', 300), noTap: true, strikes: 12, strikeOpportunities: 12, openFrames: 0, ball: 'No-tap ball' };
  let data = [...standard, noTap];
  let db = database(data); t.setState(db, data); t.resetEntryForm(); t.wireEvents(); app.renderAll();

  // Every normal statistic, including derived/shared values, ignores tagged games.
  assert.equal(t.isNoTap(standard[0]), false); assert.equal(t.normalizeGame(standard[0]).noTap, false);
  assert.equal(t.normalizeGame(noTap).noTap, true);
  for (const invalid of ['true', 'false', 1, null, {}]) assert(!t.isValidGame({ ...standard[0], noTap: invalid }));
  assert.deepEqual(JSON.parse(JSON.stringify(t.calculateStats(data))), JSON.parse(JSON.stringify(t.calculateStats(standard))));
  assert.equal(t.calculateStats(data).bestSeries.total, 540);
  assert.equal(t.progressStats(data).last10.average, 180); assert.equal(t.progressStats(data).last30.count, 3);
  assert.equal(t.progressStats(data).points.at(-1).count, 3);
  assert.equal($('statAverage').textContent, '180.0'); assert.equal($('statHighGame').textContent, 210);
  assert.equal($('more300').textContent, 0); assert.equal($('recordMostStrikes').textContent, 4);
  assert($('homeRecap').innerHTML.includes('<strong>3</strong><span>Standard games'));
  assert($('averageChart').innerHTML.includes('Latest average 180.0 across 3 games'));
  const own = app.getLeaderboardSummary();
  assert.equal(own.games, 3); assert.equal(own.noTapGames, 1); assert.equal(own.average, 180);
  assert.equal(own.highSeries, 540); assert.equal(own.details.games300, 0);
  assert.equal(own.standardStatsUpdatedAt, own.updatedAt); assert.equal(own.details.last10, 180);
  assert(!JSON.stringify(own).includes('No-tap ball'), 'Private game metadata stays out of group summaries');
  $('statsBall').value = 'ball:no-tap ball'; assert.equal(t.statsGames().length, 0); clearFilters();

  const comparisonData = [
    { ...game(11, '2026-08-31', 120), sessionType: 'Practice', ball: 'A' },
    { ...game(12, '2026-09-01', 160), sessionType: 'Practice', ball: 'A' },
    { ...noTap, id: 13, date: '2026-08-31', sessionType: 'Practice', ball: 'A' },
    { ...noTap, id: 14, sessionType: 'Practice', ball: 'A' }
  ];
  t.setState(database(comparisonData), comparisonData);
  $('statsFrom').value = $('statsTo').value = '2026-09-01'; $('statsType').value = 'Practice'; $('statsBall').value = 'ball:a';
  const comparison = t.periodComparison();
  assert.equal(comparison.current.average, 160); assert.equal(comparison.previous.average, 120);
  assert.equal(comparison.current.count, 1); assert.equal(comparison.previous.count, 1); clearFilters();
  const interrupted = [standard[0], { ...noTap, id: 2 }, { ...standard[1], id: 3 }, { ...standard[2], id: 4 }]
    .map((g, index) => ({ ...g, gameOrder: index + 1 }));
  t.setState(database(interrupted), interrupted);
  assert.equal(t.calculateStats(interrupted).bestSeries, null, 'A no-tap game cannot be skipped to construct a consecutive standard series');

  // Search/filter no-tap independently; full-session numbering/order is preserved.
  db = database(data); t.setState(db, data); app.renderAll();
  assert($('sessionsList').innerHTML.includes('Standard Avg 180.0'));
  assert($('sessionsList').innerHTML.includes('Standard Total 540'));
  $('historyScoring').value = 'no-tap'; await $('historyScoring').fire('change');
  assert.equal(t.filteredGames().length, 1); assert($('sessionsList').innerHTML.includes('No-tap Avg 300.0'));
  assert($('sessionsList').innerHTML.includes('Game 4')); assert(!$('sessionsList').innerHTML.includes('Game 1'));
  assert($('sessionsList').innerHTML.includes('type="button" disabled aria-label="Move game 4 later"'));
  await t.moveGame(4, -1);
  assert.equal(app.getGames().find(g => g.id === 4).gameOrder, 3);
  assert.equal(app.getGames().find(g => g.id === 4).noTap, true);
  assert($('sessionsList').innerHTML.includes('Game 3'));
  assert(!$('sessionsList').innerHTML.includes('disabled aria-label="Move game 3 later"'));
  $('historyScoring').value = 'standard'; await $('historyScoring').fire('change');
  assert.equal(t.filteredGames().length, 3); assert(!$('sessionsList').innerHTML.includes('No-tap</span>'));
  assert($('sessionsList').innerHTML.includes('Game 4'));
  for (const query of ['no tap', 'NO-TAP', 'notap', 'League no-tap']) {
    $('historyScoring').value = ''; $('sessionSearch').value = query; await $('sessionSearch').fire('input');
    assert.equal(t.filteredGames().length, 1); assert($('sessionsList').innerHTML.includes('No-tap</span>'));
  }
  $('sessionFrom').value = '2026-09-02'; await $('sessionFrom').fire('input');
  assert.equal($('sessionsList').innerHTML, '');
  await $('clearSessionFilters').fire('click'); assert.equal($('historyScoring').value, ''); assert.equal(t.filteredGames().length, 4);
  assert.equal(t.calculateStats(app.getGames()).count, 3, 'History filters must not change normal stats');

  // Existing games can be tagged/untagged individually, preserving type, ball and IDs.
  db = database(data); t.setState(db, data); t.resetEntryForm();
  t.startEdit(1); assert.equal($('noTapInput').value, 'standard');
  $('noTapInput').value = 'no-tap'; await $('noTapInput').fire('change');
  assert($('entrySessionSummary').textContent.includes('No-tap')); await t.saveGameFromForm();
  assert.equal(db.stores.games.get(1).noTap, true); assert.equal(db.stores.games.get(1).createdAt, 1);
  assert.equal(t.isNoTap(db.stores.games.get(2)), false); assert.equal(db.stores.games.get(4).noTap, true);
  assert.equal(app.getLeaderboardSummary().games, 2);
  t.startEdit(1); assert($('gameAdvanced').open); $('noTapInput').value = 'standard'; await t.saveGameFromForm();
  assert.equal(db.stores.games.get(1).noTap, false); assert.equal(app.getLeaderboardSummary().games, 3);
  t.startEdit(4); $('sessionTypeInput').value = 'Tournament'; await t.saveGameFromForm();
  assert.equal(db.stores.games.get(4).noTap, true); assert.equal(db.stores.games.get(4).ball, 'No-tap ball');
  assert.equal(db.stores.games.get(1).noTap, false, 'Updating a session type never copies scoring tags to other games');
  t.addToSession('2026-09-01|||league'); assert.equal($('noTapInput').value, 'no-tap');
  $('sessionMode').value = 'new'; t.changeSessionMode(); assert.equal($('noTapInput').value, 'standard');
  $('sessionSelect').value = '2026-09-01|||league'; t.selectEntrySession(); assert.equal($('noTapInput').value, 'no-tap');
  $('scoreInput').value = '190'; $('openFramesInput').value = '3'; $('strikesInput').value = '4';
  await t.saveGameFromForm(); assert.equal(app.getGames().filter(t.isNoTap).length, 2);
  assert.equal($('noTapInput').value, 'no-tap', 'Keep scoring mode for repeated entry into this session');

  // New/old drafts and series scoring survive recovery without bulk-retagging history.
  t.resetEntryForm(); $('scoreInput').value = '175'; $('noTapInput').value = 'no-tap'; t.persistDrafts();
  const entryKey = [...storage.keys()].find(key => key.endsWith(':entry'));
  const entryDraft = JSON.parse(storage.get(entryKey));
  $('noTapInput').value = 'standard'; t.recoverDraft('entry'); assert.equal($('noTapInput').value, 'no-tap'); assert($('gameAdvanced').open);
  entryDraft.values = entryDraft.values.slice(0, 10); entryDraft.baseline = JSON.stringify(JSON.parse(entryDraft.baseline).slice(0, 10));
  storage.set(entryKey, JSON.stringify(entryDraft)); t.recoverDraft('entry');
  assert.equal($('noTapInput').value, 'standard'); assert.equal($('scoreInput').value, '175'); assert(t.hasEntryDraft());
  t.clearDraft('entry'); t.resetEntryForm(); t.openSeriesEntry();
  $('seriesNoTap').value = 'no-tap'; await $('seriesNoTap').fire('change');
  assert($('seriesPreview').textContent.includes('No-tap series'));
  c.window.confirm = () => false; assert.equal(t.closeEntryDialog('seriesDialog'), false); c.window.confirm = () => true;
  setScores(); t.persistDrafts(); $('seriesDialog').close(); $('seriesNoTap').value = 'standard';
  t.recoverDraft('series'); assert.equal($('seriesNoTap').value, 'no-tap'); assert($('seriesAdvanced').open);
  const beforeCount = app.getGames().length, beforeStandardCount = app.getLeaderboardSummary().games;
  await t.saveSeries(submit);
  assert.equal(app.getGames().length, beforeCount + 3); assert.equal(app.getLeaderboardSummary().games, beforeStandardCount);
  assert.equal(app.getGames().filter(t.isNoTap).length, 5); assert.equal($('noTapInput').value, 'no-tap');
  t.resetEntryForm(); t.openSeriesEntry(); setScores(); t.persistDrafts();
  const seriesKey = [...storage.keys()].find(key => key.endsWith(':series'));
  const oldSeries = JSON.parse(storage.get(seriesKey)); delete oldSeries.noTap; storage.set(seriesKey, JSON.stringify(oldSeries));
  $('seriesDialog').close(); $('seriesNoTap').value = 'no-tap'; t.recoverDraft('series');
  assert.equal($('seriesNoTap').value, 'standard'); t.clearDraft('series'); $('seriesDialog').close();

  // JSON, CSV and import review retain the tag and recognize tag-only conflicts.
  const downloads = []; t.setDownload((name, contents, mime) => downloads.push({ name, contents, mime }));
  data = [standard[0], noTap]; db = database(data); t.setState(db, data);
  await t.exportBackup(); const backup = JSON.parse(downloads.at(-1).contents);
  assert.equal(backup.games.length, 2); assert.equal(backup.games[1].noTap, true);
  t.exportCsv(); const csv = downloads.at(-1).contents.split('\n');
  assert(csv[0].endsWith(',Scoring')); assert(csv[1].endsWith(',Standard')); assert(csv[2].endsWith(',No-tap')); assert.equal(csv.length, 3);
  assert.equal(t.buildImportPlan([{ ...standard[0], noTap: false }], [], data, [])[0].kind, 'duplicate');
  assert.equal(t.buildImportPlan([{ ...standard[0], noTap: true }], [], data, [])[0].kind, 'conflict');
  await t.importBackupFile({ text: async () => JSON.stringify({ games: [{ ...standard[0], noTap: true }] }) });
  assert($('importPreviewRows').innerHTML.includes('150 points · No-tap'));
  assert($('importPreviewRows').innerHTML.includes('Current: 150 points · Standard'));
  assert.equal(t.isNoTap(db.stores.games.get(1)), false);
  const choice = element(); choice.dataset.importId = '1'; choice.value = 'backup';
  $('importPreviewRows').querySelectorAll = () => [choice]; await t.confirmImport();
  assert.equal(db.stores.games.get(1).noTap, true); $('importPreviewRows').querySelectorAll = () => [];
  db = database(); t.setState(db, []); await t.importBackupFile({ text: async () => JSON.stringify(backup) }); await t.confirmImport();
  assert.equal(db.stores.games.size, 2); assert.equal(db.stores.games.get(4).noTap, true); assert.equal(db.stores.games.get(1).noTap, false);
  await app.applyRemoteChanges({ upserts: [{ ...noTap, id: 91 }], deletes: [] });
  assert.equal(db.stores.games.get(91).noTap, true, 'Cloud downloads retain the scoring tag');

  // No-tap-only accounts remain usable, but have no ranked normal results.
  t.setState(database([noTap]), [noTap]); clearFilters(); app.renderAll();
  assert.equal($('statAverage').textContent, '—'); assert.equal($('statHighSeries').textContent, '—');
  assert.equal(app.getLeaderboardSummary().games, 0); assert.equal(t.progressStats([noTap]).points.length, 0);
  assert($('sessionsList').innerHTML.includes('No-tap Total 300')); assert.equal(t.filteredGames().length, 1);

  t.setState(database(standard), standard); app.ready = true;
  vm.runInContext(fs.readFileSync(path.join(root, 'friend-stats.js'), 'utf8'), c);
  const friends = c.window.BowlingFriends, context = { uid: 'a', groupId: 'group', revision: 1 };
  const friend = { uid: 'b', displayName: 'Friend', ...own };
  friends.setMembers([friend], context); friends.open('b'); await $('friendStatsCompare').fire('click');
  const row = label => $('friendStatsContent').innerHTML.split('<th scope="row">' + label + '</th>')[1]?.split('</tr>')[0] || '';
  assert.equal((row('Average').match(/180.0/g) || []).length, 2);
  assert($('friendStatsStatus').textContent.includes('1 no-tap games excluded'));
  const stale = { ...friend, games: 4, average: 210, updatedAt: friend.updatedAt + 1000 };
  friends.setMembers([stale], context);
  assert(row('Average').includes('<td>—</td>')); assert(!row('Average').includes('comparison-gap'));
  assert($('friendStatsStatus').textContent.includes('open the updated app and sync'));
  const legacy = { ...friend }; delete legacy.noTapGames; delete legacy.standardStatsUpdatedAt;
  friends.setMembers([legacy], context); assert.equal((row('Average').match(/180.0/g) || []).length, 2);

  const cloud = fs.readFileSync(path.join(root, 'cloud.js'), 'utf8');
  const renderer = cloud.slice(cloud.indexOf('  function renderLeaderboardRows('), cloud.indexOf('  async function saveProfile('));
  const pub = { window: {}, currentUser: { uid: 'a' }, selectedGroupId: 'group', authRevision: 1,
    dom: { metricSelect: { value: 'average' }, leaderboardMetricHeading: {}, leaderboardBody: {} },
    metricInfo: { average: { label: 'Average', format: v => Number(v).toFixed(1), provisional: true } },
    escapeHtml: value => String(value) };
  vm.createContext(pub); vm.runInContext(renderer, pub);
  pub.renderLeaderboardRows([stale, { ...friend, uid: 'c', displayName: 'No-tap only', games: 0 }, legacy]);
  const board = pub.dom.leaderboardBody.innerHTML;
  assert.equal((board.match(/rank-badge">1</g) || []).length, 1);
  assert.equal((board.match(/rank-badge">—</g) || []).length, 2);
  assert(!board.includes('210.0')); assert(board.includes('No standard games')); assert(board.includes('Sync the updated app'));
  t.clearUndo();
  console.log('PASS: no-tap tagging/untagging, standard-only stats/records/trends/periods, consecutive series, independent history search/filter and ordering, legacy/new drafts, series saves, JSON/CSV/import conflicts, remote downloads, empty standard histories, friend comparisons and stale/unranked summaries.');
})().catch(error => { console.error(error); t.clearUndo(); process.exitCode = 1; });
