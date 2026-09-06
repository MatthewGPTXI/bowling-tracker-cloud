const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const harness = fs.readFileSync(path.join(__dirname, 'ui-regression.cjs'), 'utf8').split('(async()=>{')[0]
  .replace('api.test={showView,', 'api.test={applyStatsPreset,setGameActions,moveGame,renderComparison,showView,');
const { c, app, t, $, game, database, element } = vm.runInNewContext(harness + '\n({c,app,t,$,game,database,element});',
  { require, console, __dirname, setTimeout, clearTimeout, URL, structuredClone, queueMicrotask, setImmediate, process });
const root = path.resolve(__dirname, '..');

(async () => {
  c.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-03-01T12:00:00Z'])); }
    getTimezoneOffset() { return 0; }
  };
  const data = [
    game(1, '2025-12-01', 100),
    { ...game(2, '2025-12-02', 180), sessionType: 'Practice', ball: 'Ball A' },
    { ...game(3, '2026-03-01', 220), sessionType: 'Practice', ball: 'Ball A' },
    { ...game(4, '2026-03-01', 150), ball: 'Ball B' }
  ];
  t.setState(database(data), data); t.resetEntryForm(); t.wireEvents(); app.renderAll();
  $('statsType').value = 'Practice'; $('statsBall').value = 'ball:ball a';
  t.applyStatsPreset('90');
  assert.equal($('statsFrom').value, '2025-12-02');
  assert.equal($('statsTo').value, '2026-03-01');
  assert.equal($('statAverage').textContent, '200.0', 'Inclusive 90-day range must retain type and ball filters');
  assert.equal($('statsType').value, 'Practice'); assert.equal($('statsBall').value, 'ball:ball a');
  assert.equal($('statsPeriodPanel').hidden, false);
  t.applyStatsPreset('month'); assert.equal($('statsFrom').value, '2026-03-01'); assert.equal($('statAverage').textContent, '220.0');
  t.applyStatsPreset('year'); assert.equal($('statsFrom').value, '2026-01-01');
  await $('clearStatsFilters').fire('click');
  assert.equal($('statsFrom').value, ''); assert.equal($('statsBall').value, ''); assert.equal($('statAverage').textContent, '162.5');
  assert.equal($('statsPeriodPanel').hidden, true);
  $('statsFrom').value = '2026-03-02'; $('statsTo').value = '2026-03-01';
  await $('statsFrom').fire('change');
  assert($('statsRangeStatus').textContent.includes('Start date must')); assert($('statsPeriodPanel').hidden);
  c.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2024-03-01T12:00:00Z'])); }
    getTimezoneOffset() { return 0; }
  };
  t.applyStatsPreset('90'); assert.equal($('statsFrom').value, '2023-12-03', 'Date shortcuts must include leap day');
  await $('clearStatsFilters').fire('click');

  const history = [game(1, '2026-03-01', 150), game(2, '2026-03-01', 180), game(3, '2026-03-01', 210)];
  history[0].ball = '<img src=x onerror=alert(1)>';
  history[0].notes = '<script>alert(1)</script>';
  const db = database(history); t.setState(db, history); t.renderHistory();
  assert(!$('sessionsList').innerHTML.includes('<script>'));
  assert($('sessionsList').innerHTML.includes('&lt;img'));
  assert($('sessionsList').innerHTML.includes('class="game-detail-panel" hidden'));
  assert($('sessionsList').innerHTML.includes('&lt;script&gt;'), 'Notes remain readable and escaped');
  const toggles = [1, 2, 3].map(id => {
    const button = $('gameActionsToggle-' + id); button.dataset.id = String(id);
    $('gameActions-' + id).hidden = true; return button;
  });
  $('sessionsList').querySelectorAll = selector => selector === '.game-actions-toggle' ? toggles : [];
  t.renderHistory();
  await toggles[1].fire('click');
  assert.equal(toggles[1].attributes['aria-expanded'], 'true'); assert(!$('gameActions-2').hidden);
  await toggles[2].fire('click');
  assert($('gameActions-2').hidden); assert(!$('gameActions-3').hidden);
  await $('sessionsList').fire('keydown', { key: 'Escape', target: { closest: () => ({ querySelector: () => toggles[2] }) } });
  assert($('gameActions-3').hidden); assert(toggles[2].focused);
  await t.moveGame(2, -1);
  assert.equal(app.getGames().find(g => g.id === 2).gameOrder, 1);
  assert($('historyActionStatus').textContent.includes('position 1')); assert(toggles[1].focused);
  const before = JSON.stringify(app.getGames()); db.fail = true; await t.moveGame(3, -1); db.fail = false;
  assert.equal(JSON.stringify(app.getGames()), before); assert($('historyActionStatus').textContent.includes('Could not change'));

  // Overall group summaries never inherit personal filters or include raw history.
  $('statsFrom').value = '2030-01-01'; $('statsBall').value = 'ball:missing';
  const own = app.getLeaderboardSummary();
  assert.equal(own.games, 3); assert.equal(own.average, 180); assert.equal(own.highSeries, 540);
  assert.equal(own.details.sessions, 1); assert.equal(own.details.openAvg, 3);
  assert.equal(own.details.last10, 180); assert.equal(own.details.updatedAt, own.updatedAt);
  assert(!JSON.stringify(own).includes('onerror')); assert(!JSON.stringify(own).includes('notes'));
  assert(!('email' in own)); assert(!('ball' in own));

  const listeners = new Map();
  c.window.addEventListener = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
  const dispatch = type => (listeners.get(type) || []).forEach(fn => fn());
  app.ready = true;
  vm.runInContext(fs.readFileSync(path.join(root, 'friend-stats.js'), 'utf8'), c);
  const friends = c.window.BowlingFriends;
  const context = { uid: 'a', groupId: 'group-one', revision: 1 };
  const friend = { uid: 'b', displayName: '<img src=x onerror=alert(1)>', games: 20, average: 200,
    highGame: 280, highSeries: 710, strikePct: 50, cleanGames: 4, totalStrikes: 96, bestSessionAvg: 240,
    updatedAt: 1000, details: { updatedAt: 1000, sessions: 7, hasSeries: true, openAvg: 2,
      last5: 220, last10: 210, last30: 200, games200: 10, games250: 3, games300: 0, mostStrikes: 10,
      bestStrikePct: 90, recent200: 230 } };
  const me = { uid: 'a', displayName: 'Matthew', ...own };
  const row = label => $('friendStatsContent').innerHTML.split('<th scope="row">' + label + '</th>')[1]?.split('</tr>')[0] || '';
  friends.setMembers([me, friend], context);
  const button = element(); button.dataset.memberUid = 'b';
  await $('leaderboardBody').fire('click', { target: { closest: () => button } });
  assert($('friendStatsDialog').open);
  assert.equal($('friendStatsName').textContent, friend.displayName);
  assert($('friendStatsContent').innerHTML.includes('200.0'));
  await $('friendStatsCompare').fire('click');
  assert.equal($('friendStatsCompare').attributes['aria-pressed'], 'true');
  assert(row('Average').includes('180.0')); assert(row('Average').includes('-20.0')); assert(row('Average').includes('200.0'));
  assert(row('Open frames / game').includes('+1.00')); assert(!row('Open frames / game').includes('favorable'));
  assert(!$('friendStatsContent').innerHTML.includes('<img'), 'Names must be escaped in comparison headings');
  assert($('friendStatsContent').innerHTML.includes('&lt;img'));

  // An older client can leave stale extra fields behind when merging its update.
  friends.setMembers([me, { ...friend, updatedAt: 2000 }], context);
  assert(row('Open frames / game').includes('<td>—</td>'));
  assert(row('Clean-game rate').includes('20.0%'), 'Safe derived stats remain available from the basic summary');
  assert($('friendStatsNote').textContent.includes('opens the updated app'));
  friends.setMembers([me, { ...friend, details: undefined }], context);
  assert(row('Sessions').includes('<td>—</td>'), 'Missing old fields must not look like zero');
  c.navigator.onLine = false; dispatch('offline');
  assert($('friendStatsStatus').textContent.includes('Offline'));
  c.navigator.onLine = true;
  friends.open('a');
  assert($('friendStatsCompare').hidden); assert($('friendStatsName').textContent.includes('You'));
  friends.open('b');
  friends.setMembers([me], context); assert(!$('friendStatsDialog').open);
  friends.open('b'); assert(!$('friendStatsDialog').open, 'Removed members cannot be reopened');
  friends.setMembers([me, friend], context); friends.open('b');
  friends.setMembers([me], { ...context, groupId: 'group-two' });
  assert(!$('friendStatsDialog').open); assert.equal($('friendStatsContent').innerHTML, '');
  friends.setMembers([me, friend], context); friends.open('b');
  app.getLocalScopeInfo = () => ({ kind: 'user', uid: 'another-account' });
  dispatch('bowling:rendered');
  assert(!$('friendStatsDialog').open); assert.equal($('friendStatsContent').innerHTML, '');
  friends.open('b'); assert(!$('friendStatsDialog').open);
  app.getLocalScopeInfo = () => ({ kind: 'user', uid: 'a' });

  const empty = { ...friend, games: 0, average: 0, highGame: 0, highSeries: 0, cleanGames: 0, totalStrikes: 0,
    details: { ...friend.details, sessions: 0, hasSeries: false } };
  friends.setMembers([me, empty], context); friends.open('b'); await $('friendStatsCompare').fire('click');
  assert(row('Average').includes('<td>—</td>')); assert(!row('Average').includes('comparison-gap'));
  friends.setMembers([me, { ...empty, games: 3, details: { ...empty.details, hasSeries: true } }], context);
  assert(row('High 3-game series').includes('<td>0</td>'), 'A recorded zero series is distinct from no series');
  friends.clear();

  // Publishing must preserve the summary timestamp and the active account.
  const source = fs.readFileSync(path.join(root, 'cloud.js'), 'utf8');
  const publishing = source.slice(source.indexOf('  async function memberPayload()'), source.indexOf('  async function publishAllSummaries()'));
  const writes = [];
  const pub = { currentUser: { uid: 'a', displayName: 'Matthew' }, authRevision: 1, profile: { displayName: 'Matthew' },
    waitForBowlingApp: async () => app, firestore: {}, modules: { doc: (_, ...parts) => parts.join('/'), setDoc: async (ref, body) => writes.push({ ref, body }) } };
  vm.createContext(pub); vm.runInContext(publishing, pub);
  await pub.publishSummaryToGroup('group-one');
  assert.equal(writes[0].ref, 'groups/group-one/members/a');
  assert.equal(writes[0].body.details.updatedAt, writes[0].body.updatedAt);
  let resolveReady;
  pub.waitForBowlingApp = () => new Promise(resolve => { resolveReady = resolve; });
  const pending = pub.publishSummaryToGroup('group-one');
  pub.currentUser = { uid: 'other' }; pub.authRevision++;
  resolveReady(app); await assert.rejects(pending, /Account changed/);
  assert.equal(writes.length, 1, 'Account changes cannot publish one user’s summary as another user');

  console.log('PASS: date shortcuts and leap years, combined filters, accessible history actions, failed reorder recovery, all-time summaries, friend click/compare, legacy and stale summaries, missing and zero stats, offline display, escaping, membership/group/account isolation, and guarded summary publication.');
})().catch(error => { console.error(error); process.exitCode = 1; });
