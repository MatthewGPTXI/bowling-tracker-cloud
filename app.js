import * as History from './modules/history-renderer.js';
import * as Inventory from './modules/inventory.js';
import * as Navigation from './modules/navigation.js';
import * as Balls from './balls.js';
import * as UI from './ui.js';
let runtime = {};
export function configureApp(services) { runtime = services; }
import * as Sessions from './modules/sessions.js';
import * as Stats from './modules/statistics.js';
import * as Game from './modules/games.js';
import * as Backup from './modules/backup.js';
import * as Storage from './modules/storage.js';
import * as Drafts from './modules/drafts.js';
import * as IDs from './modules/ids.js';
export const app = (() => {
  'use strict';
  const {openDialog, closeDialog} = UI;

  const LEGACY_DB_NAME = 'bowling-tracker-db';
  const GUEST_DB_NAME = 'bowling-tracker-db-guest';
  const USER_DB_PREFIX = 'bowling-tracker-db-user-';
  const LAST_ACCOUNT_STORAGE_KEY = 'bowling-tracker-last-account-uid';
  const LEGACY_CLAIM_KEY = 'accountIsolationClaimedBy';
  const DB_VERSION = 2;
  const GAME_STORE = 'games';
  const SETTINGS_STORE = 'settings';
  const TOMBSTONE_STORE = 'tombstones';
  const BACKUP_SCHEMA_VERSION = Game.BACKUP_SCHEMA_VERSION;

  const SESSION_TYPES = ['League', 'Practice', 'Tournament'];
  let restoringDraft = false;
  let entryBaseGame = null;
  let entrySessionId = null;
  let seriesSessionId = null;
  let pendingImport = null;

  let statsPreset = 'all';
  let historyLimit = 10;
  const expandedSessions = new Map();
  let entryBaseline = null;
  const dialogBaselines = new Map();
  let undoDeletion = null;
  let undoTimer;
  let editSessionKey = null;
  let mutationBusy = false;
  let dialogScope = null;

  let db;
  let scopeQueue = Promise.resolve();
  let activeLocalScope = { kind: 'guest', uid: '', dbName: GUEST_DB_NAME };
  let games = [];
  let editingGameId = null;
  let editReturn = null;
  let deferredInstallPrompt = null;
  let offlineCacheReady = false;
  let selectedPhotoUrl = null;
  let activeProfileName = 'Bowler';

  const elements = new Map();
  const $ = id => {
    if (id.startsWith('gameActions')) return document.getElementById(id);
    const element = elements.get(id) || document.getElementById(id);
    if (element) elements.set(id, element);
    return element;
  };

  const dom = {
    average: $('statAverage'),
    averageDetail: $('statAverageDetail'),
    highGame: $('statHighGame'),
    highGameDetail: $('statHighGameDetail'),
    highSeries: $('statHighSeries'),
    highSeriesDetail: $('statHighSeriesDetail'),
    strikePct: $('statStrikePct'),
    strikePctDetail: $('statStrikePctDetail'),
    openAvg: $('statOpenAvg'),
    openRateDetail: $('statOpenRateDetail'),
    closedFramePct: $('statClosedFramePct'),
    closedFrameDetail: $('statClosedFrameDetail'),
    cleanGames: $('statCleanGames'),
    cleanGamesDetail: $('statCleanGamesDetail'),
    sessions: $('statSessions'),
    gamesAndMilestones: $('statGamesAndMilestones'),
    more200: $('more200'),
    more250: $('more250'),
    more300: $('more300'),
    moreStrikeAvg: $('moreStrikeAvg'),
    moreLast5: $('moreLast5'),
    recordBestSession: $('recordBestSession'),
    recordBestSessionDetail: $('recordBestSessionDetail'),
    recordMostStrikes: $('recordMostStrikes'),
    recordMostStrikesDetail: $('recordMostStrikesDetail'),
    recordBestStrikePct: $('recordBestStrikePct'),
    recordBestStrikePctDetail: $('recordBestStrikePctDetail'),
    recordRecent200: $('recordRecent200'),
    recordRecent200Detail: $('recordRecent200Detail'),
    currentProfileName: $('currentProfileName'),
    globalSyncStatus: $('globalSyncStatus'),
    globalSyncDot: $('globalSyncDot'),
    editProfileBtn: $('editProfileBtn'),
    date: $('dateInput'),
    sessionName: $('sessionNameInput'),
    sessionType: $('sessionTypeInput'),
    ball: $('ballInput'),
    alley: $('alleyInput'),
    noTap: $('noTapInput'),
    sessionSelect: $('sessionSelect'),
    score: $('scoreInput'),
    openFrames: $('openFramesInput'),
    strikes: $('strikesInput'),
    strikeOpp: $('strikeOppInput'),
    entryDetail: $('entryDetailInput'),
    notes: $('notesInput'),
    entryStatus: $('entryStatus'),
    saveGameBtn: $('saveGameBtn'),
    cancelEditBtn: $('cancelEditBtn'),
    entryHeading: $('entryHeading'),
    entrySubheading: $('entrySubheading'),
    manualTab: $('manualTab'),
    photoTab: $('photoTab'),
    photoArea: $('photoArea'),
    scoreboardPhoto: $('scoreboardPhoto'),
    photoPreview: $('photoPreview'),
    photoPreviewWrap: $('photoPreviewWrap'),
    clearPhotoBtn: $('clearPhotoBtn'),
    emptyHistory: $('emptyHistory'),
    sessionsList: $('sessionsList'),
    sortFilter: $('sortFilter'),
    settingsDialog: $('settingsDialog'),
    openSettingsBtn: $('openSettingsBtn'),
    closeSettingsBtn: $('closeSettingsBtn'),
    defaultBowlerInput: $('defaultBowlerInput'),
    saveDefaultBowlerBtn: $('saveDefaultBowlerBtn'),
    exportJsonBtn: $('exportJsonBtn'),
    exportCsvBtn: $('exportCsvBtn'),
    importJsonBtn: $('importJsonBtn'),
    importJsonInput: $('importJsonInput'),
    clearAllBtn: $('clearAllBtn'),
    settingsStatus: $('settingsStatus'),
    installBtn: $('installBtn'),
    offlineStatus: $('offlineStatus')
  };

  function todayLocal() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function setStatus(element, message, type = '') {
    if (!element) return;
    element.textContent = message;
    element.classList.remove('success', 'error');
    if (type) element.classList.add(type);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function fmtDate(dateString) {
    const d = new Date(`${dateString}T12:00:00`);
    return Number.isNaN(d.getTime()) ? dateString : d.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  function avg(...args) { return Stats.avg(...args); }

  function sessionLabel(...args) { return Sessions.sessionLabel(...args); }

  function sessionKey(...args) { return Sessions.sessionKey(...args); }

  function sessionType(...args) { return Sessions.sessionType(...args); }
  function hasFrameStats(...args) { return Sessions.hasFrameStats(...args); }
  function setEntryDetail(fields = dom) {
    const scoreOnly = fields.entryDetail?.value === 'score-only';
    if (fields === dom) document.querySelectorAll('[name="entryTracking"]').forEach(input => { input.checked = input.value === (scoreOnly ? 'score-only' : 'full'); });
    for (const key of ['openFrames', 'strikes', 'strikeOpp']) {
      const input = fields[key];
      input.disabled = scoreOnly;
      input.required = !scoreOnly;
      const label = input.closest('label');
      if (label) label.hidden = scoreOnly;
    }
  }
  function seriesFields(row) {
    return Object.fromEntries(['score','openFrames','strikes','strikeOpp','notes','ball','entryDetail'].map(key => [key, row.querySelector(`[data-field="${key}"]`)]));
  }
  function isNoTap(...args) { return Sessions.isNoTap(...args); }
  function standardGames(source = games) { return source.filter(game => !isNoTap(game)); }
  function scoringLabel(...args) { return Sessions.scoringLabel(...args); }
  function cleanBall(value) { return Inventory.clean(value); }
  function ballKey(value) { return Inventory.key(value); }
  function ballNames() {
    const names = new Map();
    games.forEach(g => Balls.list(g).forEach(({name}) => { if (name && !names.has(ballKey(name))) names.set(ballKey(name), name); }));
    return [...names.values()].sort((a,b) => a.localeCompare(b));
  }
  function canonicalBall(value) { return ballNames().find(name => ballKey(name) === ballKey(value)) || cleanBall(value); }
  function matchesBall(game) {
    const selected = $('statsBall').value;
    const balls = Balls.list(game);
    return !selected || (selected === 'none' ? balls.length === 0 : balls.some(row => 'ball:' + ballKey(row.name) === selected));
  }
  function renderBallOptions() {
    const names = ballNames(), selected = $('statsBall').value;
    document.querySelectorAll('[data-ball-select]').forEach(input => Balls.fillSelect(input));
    $('statsBall').innerHTML = '<option value="">All balls</option><option value="none">No ball recorded</option>' + names.map(name => `<option value="ball:${escapeHtml(ballKey(name))}">${escapeHtml(name)}</option>`).join('');
    $('statsBall').value = selected === 'none' || names.some(name => 'ball:'+ballKey(name) === selected) ? selected : '';
  }

  function getBallInventory(...args) { return ballService.get(...args); }

  function loadBallInventory(...args) { return ballService.load(...args); }

  function mergeBallInventory(...args) { return ballService.merge(...args); }

  function editBallInventory(...args) { return ballService.edit(...args); }
  function alleyNames() {
    const names = new Map();
    games.forEach(game => { const name = cleanBall(game.alley); if (name && !names.has(ballKey(name))) names.set(ballKey(name), name); });
    return [...names.values()].sort((a,b) => a.localeCompare(b));
  }
  const cleanAlley = cleanBall, alleyKey = ballKey;
  function fillAlleySelect(input, selected = input.value) {
    Balls.fillSelect(input, selected, getAlleyInventory().filter(row => !row.removed).map(row => row.name), 'No alley selected');
  }
  function matchesAlley(game) {
    const selected = $('statsAlley').value;
    return !selected || (selected === 'none' ? !cleanAlley(game.alley) : 'alley:' + alleyKey(game.alley) === selected);
  }
  function renderAlleyOptions() {
    document.querySelectorAll('[data-alley-select]').forEach(input => fillAlleySelect(input));
    const names = alleyNames(), selected = $('statsAlley').value;
    $('statsAlley').innerHTML = '<option value="">All alleys</option><option value="none">No alley recorded</option>' + names.map(name => `<option value="alley:${escapeHtml(alleyKey(name))}">${escapeHtml(name)}</option>`).join('');
    $('statsAlley').value = selected === 'none' || names.some(name => 'alley:' + alleyKey(name) === selected) ? selected : '';
  }

  function getAlleyInventory(...args) { return alleyService.get(...args); }

  function loadAlleyInventory(...args) { return alleyService.load(...args); }

  function mergeAlleyInventory(...args) { return alleyService.merge(...args); }

  function editAlleyInventory(...args) { return alleyService.edit(...args); }
  function applySeriesBall() {
    const value = cleanBall($('seriesBall').value);
    const inputs = [...$('seriesRows').children].map(row => row.querySelector('[data-field="ball"]'));
    if (inputs.some(input => {
      const rows = Balls.fromDraft(Balls.draft(input));
      return rows.length > 1 || rows.some(row => row.frames !== null || ballKey(row.name) !== ballKey(value));
    }) && !window.confirm('Replace all ball selections and frame counts for every game in this series?')) return;
    inputs.forEach(input => Balls.set(input, value ? [{name: value}] : [])); persistDrafts();
  }

  function newSessionId() { return IDs.newSessionId(); }
  function gameOrder(...args) { return Sessions.gameOrder(...args); }
  function latestSessionOrder(...args) { return Sessions.latestSessionOrder(...args); }
  function nextGameOrder(id) { return games.filter(g => sessionKey(g) === id).reduce((n, g) => Math.max(n, IDs.orderValue(g)), 0) + 1; }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function emitDataChanged(detail = { type: 'bulk' }) {
    setSyncStatus('Saved on this device' + (runtime.cloud?.isSignedIn?.() ? ' · awaiting sync' : ' · local only'), 'working');
    window.dispatchEvent(new CustomEvent('bowling:data-changed', { detail: { ...detail, scope: activeLocalScope.uid } }));
  }

  function userDbName(uid) {
    return `${USER_DB_PREFIX}${String(uid || '').replace(/[^A-Za-z0-9_-]/g, '_')}`;
  }

  function safeLocalStorageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeLocalStorageSet(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (_) {}
  }

  function openDatabase(name) { return Storage.openDatabase(name, indexedDB); }

  function idbRequestOn(...args) { return Storage.idbRequestOn(...args); }

  function idbRequest(storeName, mode, action) {
    return idbRequestOn(db, storeName, mode, action);
  }

  async function getAllGames() {
    const targetDb = db;
    await Storage.migrateGames(targetDb);
    return Storage.getAllFromDb(targetDb, GAME_STORE);
  }

  async function getAllTombstones() {
    return idbRequest(TOMBSTONE_STORE, 'readonly', (store) => store.getAll());
  }

  async function getTombstone(id) {
    return idbRequest(TOMBSTONE_STORE, 'readonly', (store) => store.get(id));
  }

  async function getSetting(key) {
    const result = await idbRequest(SETTINGS_STORE, 'readonly', (store) => store.get(key));
    return result ? result.value : null;
  }

  async function setSetting(key, value) {
    return idbRequest(SETTINGS_STORE, 'readwrite', (store) => store.put({ key, value }));
  }

  function getAllFromDb(...args) { return Storage.getAllFromDb(...args); }

  function getSettingFromDb(...args) { return Storage.getSettingFromDb(...args); }

  function setSettingOnDb(...args) { return Storage.setSettingOnDb(...args); }

  async function copyDatabaseContents(sourceDb, targetDb) {
    if (!sourceDb || !targetDb || sourceDb === targetDb) return;
    const [sourceGames, sourceTombstones, defaultBowler, profileName] = await Promise.all([
      getAllFromDb(sourceDb, GAME_STORE),
      getAllFromDb(sourceDb, TOMBSTONE_STORE),
      getSettingFromDb(sourceDb, 'defaultBowler'),
      getSettingFromDb(sourceDb, 'profileName')
    ]);

    for (const sourceGame of sourceGames) {
      const existingGame = await idbRequestOn(targetDb, GAME_STORE, 'readonly', (store) => store.get(sourceGame.id));
      const existingTombstone = await idbRequestOn(targetDb, TOMBSTONE_STORE, 'readonly', (store) => store.get(sourceGame.id));
      const gameAt = Number(sourceGame.updatedAt || sourceGame.createdAt || 0);
      const existingGameAt = Number(existingGame?.updatedAt || existingGame?.createdAt || 0);
      const deleteAt = Number(existingTombstone?.updatedAt || 0);
      if (gameAt >= existingGameAt && (!existingTombstone || gameAt > deleteAt)) {
        await idbRequestOn(targetDb, GAME_STORE, 'readwrite', (store) => store.put(normalizeGame(sourceGame)));
        if (existingTombstone) await idbRequestOn(targetDb, TOMBSTONE_STORE, 'readwrite', (store) => store.delete(sourceGame.id));
      }
    }

    for (const tombstone of sourceTombstones) {
      const existingGame = await idbRequestOn(targetDb, GAME_STORE, 'readonly', (store) => store.get(tombstone.id));
      const existingTombstone = await idbRequestOn(targetDb, TOMBSTONE_STORE, 'readonly', (store) => store.get(tombstone.id));
      const deleteAt = Number(tombstone.updatedAt || 0);
      const existingGameAt = Number(existingGame?.updatedAt || existingGame?.createdAt || 0);
      const existingDeleteAt = Number(existingTombstone?.updatedAt || 0);
      if (deleteAt >= existingGameAt && deleteAt >= existingDeleteAt) {
        await idbRequestOn(targetDb, TOMBSTONE_STORE, 'readwrite', (store) => store.put(tombstone));
        if (existingGame) await idbRequestOn(targetDb, GAME_STORE, 'readwrite', (store) => store.delete(tombstone.id));
      }
    }

    if (defaultBowler && !await getSettingFromDb(targetDb, 'defaultBowler')) {
      await setSettingOnDb(targetDb, 'defaultBowler', defaultBowler);
    }
    const sourceProfileName = profileName || defaultBowler;
    if (sourceProfileName && !await getSettingFromDb(targetDb, 'profileName')) {
      await setSettingOnDb(targetDb, 'profileName', sourceProfileName);
    }
    const inventory = Balls.mergeInventory(await getSettingFromDb(sourceDb, 'ballInventory'), await getSettingFromDb(targetDb, 'ballInventory'));
    await setSettingOnDb(targetDb, 'ballInventory', inventory);
    const alleys = Balls.mergeInventory(await getSettingFromDb(sourceDb, 'alleyInventory'), await getSettingFromDb(targetDb, 'alleyInventory'));
    await setSettingOnDb(targetDb, 'alleyInventory', alleys);
  }

  async function refreshFromActiveDatabase() {
    clearUndo();
    expandedSessions.clear();
    historyLimit = 10;
    for (const id of ['sessionSearch', 'sessionFrom', 'sessionTo']) $(id).value = '';
    $('historyScoring').value = '';
    closeDialog($('seriesDialog'));
    closeDialog($('editSessionDialog'));
    games = await getAllGames();
    editingGameId = null;
    await loadBallInventory();
    await loadAlleyInventory();
    $('seriesRows').innerHTML = '';
    Balls.fillSelect($('seriesBall'), '');
    fillAlleySelect($('seriesAlley'), '');
    await loadProfileName(true);
    restoringDraft = true;
    resetEntryForm({ preserveDate: false, preserveSession: false });
    restoringDraft = false;
    pendingImport = null; closeDialog($('importPreviewDialog'));
    for (const id of ['statsFrom','statsTo','statsType','statsBall','statsAlley']) $(id).value = '';
    statsPreset = 'all';
    $('statsCustomDates').open = false;
    $('statsPeriodPanel').open = false;
    showDraftNotice();
    renderAll();
    window.dispatchEvent(new CustomEvent('bowling:profile-options-changed'));
    window.dispatchEvent(new CustomEvent('bowling:local-account-changed', { detail: getLocalScopeInfo() }));
  }

  function getLocalScopeInfo() {
    return {
      kind: activeLocalScope.kind,
      uid: activeLocalScope.uid || '',
      dbName: activeLocalScope.dbName,
      gameCount: games.length
    };
  }

  // Database opening and migration can finish out of order. Finish each scope
  // transition before starting the next, so the latest requested account wins.
  function changeLocalScope(action) {
    const task = scopeQueue.then(action);
    scopeQueue = task.catch(() => {});
    return task;
  }

  async function getAccountLocalGameCount(uid) {
    const dbName = userDbName(uid);
    if (activeLocalScope.dbName === dbName) return games.length;
    const targetDb = await openDatabase(dbName);
    try {
      return (await getAllFromDb(targetDb, GAME_STORE)).length;
    } finally {
      targetDb.close();
    }
  }

  async function activateAccount(uid, { importCurrent = false } = {}) {
    if (!uid) throw new Error('A Firebase user ID is required for account-local storage.');
    const dbName = userDbName(uid);
    if (activeLocalScope.dbName === dbName) {
      safeLocalStorageSet(LAST_ACCOUNT_STORAGE_KEY, uid);
      return getLocalScopeInfo();
    }

    persistDrafts();
    const previousDb = db;
    const previousScope = { ...activeLocalScope };
    const targetDb = await openDatabase(dbName);

    try {
      if (previousScope.kind === 'legacy') {
        const claimedBy = await getSettingFromDb(previousDb, LEGACY_CLAIM_KEY);
        if (!claimedBy || claimedBy === uid) {
          await copyDatabaseContents(previousDb, targetDb);
          await setSettingOnDb(previousDb, LEGACY_CLAIM_KEY, uid);
        }
      } else if (previousScope.kind === 'guest' && importCurrent) {
        await copyDatabaseContents(previousDb, targetDb);
      }
    } catch (error) {
      targetDb.close();
      throw error;
    }

    if (previousDb) previousDb.close();
    db = targetDb;
    activeLocalScope = { kind: 'user', uid, dbName };
    safeLocalStorageSet(LAST_ACCOUNT_STORAGE_KEY, uid);
    await refreshFromActiveDatabase();
    return getLocalScopeInfo();
  }

  async function activateGuest() {
    if (activeLocalScope.kind === 'guest' && activeLocalScope.dbName === GUEST_DB_NAME) {
      safeLocalStorageSet(LAST_ACCOUNT_STORAGE_KEY, '');
      return getLocalScopeInfo();
    }
    persistDrafts();
    const targetDb = await openDatabase(GUEST_DB_NAME);
    if (db) db.close();
    db = targetDb;
    activeLocalScope = { kind: 'guest', uid: '', dbName: GUEST_DB_NAME };
    safeLocalStorageSet(LAST_ACCOUNT_STORAGE_KEY, '');
    await refreshFromActiveDatabase();
    return getLocalScopeInfo();
  }

  async function copyAccountDataToGuest(uid) {
    if (!uid) return;
    const sourceName = userDbName(uid);
    let sourceDb = null;
    let closeSource = false;
    if (activeLocalScope.dbName === sourceName) {
      sourceDb = db;
    } else {
      sourceDb = await openDatabase(sourceName);
      closeSource = true;
    }
    const guestDb = activeLocalScope.dbName === GUEST_DB_NAME ? db : await openDatabase(GUEST_DB_NAME);
    const closeGuest = guestDb !== db;
    try {
      await copyDatabaseContents(sourceDb, guestDb);
    } finally {
      if (closeSource) sourceDb.close();
      if (closeGuest) guestDb.close();
    }
  }

  async function openInitialDatabase() {
    const lastUid = safeLocalStorageGet(LAST_ACCOUNT_STORAGE_KEY);
    if (lastUid) {
      const dbName = userDbName(lastUid);
      activeLocalScope = { kind: 'user', uid: lastUid, dbName };
      return openDatabase(dbName);
    }

    const legacyDb = await openDatabase(LEGACY_DB_NAME);
    const [legacyGames, legacyTombstones, legacyDefault, legacyProfileName, claimedBy] = await Promise.all([
      getAllFromDb(legacyDb, GAME_STORE),
      getAllFromDb(legacyDb, TOMBSTONE_STORE),
      getSettingFromDb(legacyDb, 'defaultBowler'),
      getSettingFromDb(legacyDb, 'profileName'),
      getSettingFromDb(legacyDb, LEGACY_CLAIM_KEY)
    ]);
    if (!claimedBy && (legacyGames.length || legacyTombstones.length || legacyDefault || legacyProfileName)) {
      activeLocalScope = { kind: 'legacy', uid: '', dbName: LEGACY_DB_NAME };
      return legacyDb;
    }
    legacyDb.close();
    activeLocalScope = { kind: 'guest', uid: '', dbName: GUEST_DB_NAME };
    return openDatabase(GUEST_DB_NAME);
  }

  function buildSessions(...args) { return Sessions.buildSessions(...args); }

  function bestThreeGameSeries(...args) { return Stats.bestThreeGameSeries(...args, games); }

  function completedSeriesTotals(...args) { return Stats.completedSeriesTotals(...args, games); }

  function filteredGames() {
    const scoring = $('historyScoring').value;
    const noTapQuery = /\bno[\s-]?tap\b/i.test($('sessionSearch').value);
    return games.filter(game => (!scoring || isNoTap(game) === (scoring === 'no-tap'))
      && (!noTapQuery || isNoTap(game)));
  }

  function historySummary(session) {
    const standard = standardGames(session.games), noTapCount = session.games.length - standard.length;
    const source = standard.length ? standard : session.games;
    const prefix = noTapCount ? (standard.length ? 'Standard ' : 'No-tap ') : '';
    return { average: avg(source.map(game => game.score)), total: source.reduce((sum, game) => sum + game.score, 0), prefix, noTapCount };
  }

  function statsGames() {
    const from = $('statsFrom').value, through = $('statsTo').value, type = $('statsType').value;
    return standardGames().filter(g => (!from || g.date >= from) && (!through || g.date <= through) && (!type || sessionType(g) === type) && matchesBall(g) && matchesAlley(g));
  }
  function applyStatsPreset(preset) {
    if (!['all', 'month', '90', 'year'].includes(preset)) return;
    const today = todayLocal();
    let from = '';
    if (preset === 'month') from = today.slice(0, 7) + '-01';
    if (preset === 'year') from = today.slice(0, 4) + '-01-01';
    if (preset === '90') {
      const start = new Date(today + 'T00:00:00Z');
      start.setUTCDate(start.getUTCDate() - 89);
      from = start.toISOString().slice(0, 10);
    }
    statsPreset = preset;
    $('statsFrom').value = from;
    $('statsTo').value = preset === 'all' ? '' : today;
    $('statsCustomDates').open = false;
    refreshStatsView();
  }

  function refreshStatsView() {
    renderStats();
    renderProgress();
    renderComparison();
  }
  function periodComparison() {
    const from = $('statsFrom').value, through = $('statsTo').value;
    if (!isValidDate(from) || !isValidDate(through) || from > through) return null;
    const day = 86400000, start = Date.parse(from+'T00:00:00Z'), end = Date.parse(through+'T00:00:00Z');
    const date = n => new Date(n).toISOString().slice(0,10);
    const previousFrom = date(start-(end-start+day)), previousTo = date(start-day);
    const type = $('statsType').value;
    return {previousFrom,previousTo,current:calculateStats(statsGames()),previous:calculateStats(games.filter(g => g.date >= previousFrom && g.date <= previousTo && (!type || sessionType(g) === type) && matchesBall(g) && matchesAlley(g)))};
  }
  function renderComparison() {
    const comparison = periodComparison();
    const from = $('statsFrom').value, through = $('statsTo').value;
    const range = from || through ? `${from ? fmtDate(from) : 'First game'} – ${through ? fmtDate(through) : 'Latest game'}` : 'All time';
    const selectedBall = $('statsBall').value;
    $('statsBallNote').hidden = !selectedBall.startsWith('ball:');
    const ball = selectedBall === 'none' ? 'No ball recorded' : ballNames().find(name => 'ball:' + ballKey(name) === selectedBall) || 'All balls';
    const selectedAlley = $('statsAlley').value;
    const alley = selectedAlley === 'none' ? 'No alley recorded' : alleyNames().find(name => 'alley:' + alleyKey(name) === selectedAlley) || 'All alleys';
    const activeFilters = [$('statsType').value, selectedBall ? ball : '', selectedAlley ? alley : ''].filter(Boolean);
    const filterCount = activeFilters.length + Number(statsPreset === 'custom' && !!(from || through));
    if ($('statsFiltersLabel')) $('statsFiltersLabel').textContent = filterCount ? `Filters · ${filterCount}` : 'Filters';
    $('statsRangeStatus').textContent = from && through && from > through ? 'Start date must be on or before end date.' : [`${statsGames().length} games`, range, ...activeFilters].join(' · ');
    document.querySelectorAll('[data-stats-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.statsPreset === statsPreset)));
    $('statsPeriodPanel').hidden = !comparison;
    if (!comparison) { $('periodComparison').textContent = ''; return; }
    const {current,previous,previousFrom,previousTo} = comparison;
    const value = (s,key) => s.count && s[key] !== null ? s[key].toFixed(1) : '—';
    $('periodComparison').innerHTML = `<p>Previous period: ${escapeHtml(fmtDate(previousFrom))} – ${escapeHtml(fmtDate(previousTo))}</p><div class="trend-table-wrap"><table class="trend-table"><thead><tr><th>Metric</th><th>Selected</th><th>Previous</th><th>Change</th></tr></thead><tbody>${[['Average','average'],['Strike %','strikePct'],['Open frames / game','openAvg']].map(([label,key]) => `<tr><th>${label}</th><td>${value(current,key)}</td><td>${value(previous,key)}</td><td>${current.count && previous.count && current[key] !== null && previous[key] !== null ? (current[key]-previous[key] >= 0 ? '+' : '')+(current[key]-previous[key]).toFixed(1) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function updateSessionSuggestions() {
    const sessions = buildSessions(games).sort(latestSessionOrder);
    dom.sessionSelect.innerHTML = '<option value="">Choose an existing session…</option>' + sessions.map((session, i) =>
      `<option value="${escapeHtml(session.key)}">${escapeHtml(fmtDate(session.date))} · ${escapeHtml(session.name)} · Session ${sessions.length-i} · ${session.games.length} games</option>`
    ).join('');
    const key = entrySessionId;
    const current = sessions.find(s => s.key === key);
    dom.sessionSelect.value = current ? key : '';
    $('sessionMode').value = current ? 'existing' : 'new';
    $('existingSessionField').hidden = !current;
    updateEntryContext();
  }

  function selectEntrySession() {
    const session = buildSessions(games).find(s => s.key === dom.sessionSelect.value);
    if (session) {
      entrySessionId = session.key;
      dom.date.value = session.date;
      dom.sessionName.value = session.games[0].sessionName || '';
      dom.sessionType.value = sessionType(session.games[0]);
      fillAlleySelect(dom.alley, session.games.at(-1)?.alley || '');
      dom.noTap.value = isNoTap(session.games.at(-1)) ? 'no-tap' : 'standard';
      $('gameAdvanced').open = dom.noTap.value === 'no-tap' || !!dom.ball.value || !!dom.alley.value;
    }
    updateEntryContext(); persistDrafts();
  }

  function changeSessionMode() {
    const existing = $('sessionMode').value === 'existing';
    $('existingSessionField').hidden = !existing;
    if (existing) {
      const latest = buildSessions(games).sort(latestSessionOrder)[0];
      dom.sessionSelect.value = latest?.key || '';
      selectEntrySession();
    } else {
      entrySessionId = newSessionId();
      dom.sessionName.value = entrySessionId;
      dom.sessionSelect.value = '';
      dom.date.value = todayLocal();
      dom.sessionType.value = 'League';
      fillAlleySelect(dom.alley, '');
      dom.noTap.value = 'standard';
    }
    updateEntryContext(); persistDrafts();
  }

  function calculateStats(...args) { return Stats.calculateStats(...args, games); }

  function leaderboardSummaryForBowler(_bowlerName) {
    const stats = calculateStats(games);
    const recent = progressStats(games);
    const updatedAt = Date.now();
    return {
      games: stats.count,
      average: stats.average,
      highGame: stats.highGameObj ? stats.highGameObj.score : 0,
      highSeries: stats.bestSeries ? stats.bestSeries.total : 0,
      strikePct: stats.strikePct,
      cleanGames: stats.frameCount ? stats.cleanGames : null,
      totalStrikes: stats.frameCount ? stats.totalStrikes : null,
      frameStatsGames: stats.frameCount,
      scoreOnlyGames: stats.count - stats.frameCount,
      frameStatsUpdatedAt: updatedAt,
      bestSessionAvg: stats.bestSession ? stats.bestSession.average : 0,
      updatedAt,
      noTapGames: games.filter(isNoTap).length,
      standardStatsUpdatedAt: updatedAt,
      // Timestamp equality prevents extended stats left by a newer app from
      // being mixed with a basic summary subsequently written by an older app.
      details: {
        updatedAt,
        sessions: stats.sessions.length,
        hasSeries: Boolean(stats.bestSeries),
        openAvg: stats.openAvg,
        games200: stats.games200,
        games250: stats.games250,
        games300: stats.games300,
        last5: stats.last5,
        last10: recent.last10.average,
        last30: recent.last30.average,
        mostStrikes: stats.mostStrikesGame?.strikes ?? null,
        bestStrikePct: stats.bestStrikePctGame ? stats.bestStrikePctGame.strikes / stats.bestStrikePctGame.strikeOpportunities * 100 : null,
        recent200: stats.recent200?.score ?? null
      }
    };
  }

  // A share card is a snapshot of this profile, independent of screen filters.
  // Only include public card fields: never notes, email, account IDs, or equipment.
  function getScoreCardData(key = null) {
    if (!api.ready) return null;
    const session = key === null ? null : buildSessions(games).find(item => item.key === key);
    if (key !== null && !session) return null;
    const source = session ? session.games : games;
    const noTapCount = source.filter(isNoTap).length;
    const noTapOnly = !!session && noTapCount === source.length;
    const included = noTapOnly ? source.map(game => ({...game, noTap: false})) : standardGames(source);
    if (!included.length) return null;
    const stats = calculateStats(included);
    const dates = included.map(game => game.date).sort();
    return {
      kind: session ? 'session' : 'overall',
      name: activeProfileName || 'Bowler',
      date: session?.date || todayLocal(),
      dateLabel: session ? fmtDate(session.date) : dates[0] === dates.at(-1) ? fmtDate(dates[0]) : `${fmtDate(dates[0])} – ${fmtDate(dates.at(-1))}`,
      asOf: session ? '' : fmtDate(todayLocal()),
      sessionType: session ? sessionType(session.games[0]) : '',
      noTapOnly, noTapCount,
      scores: session ? session.games.map((game, index) => ({number: index + 1, score: game.score, noTap: isNoTap(game)})) : [],
      count: stats.count,
      sessions: stats.sessions.length,
      total: included.reduce((sum, game) => sum + game.score, 0),
      average: stats.average,
      highGame: stats.highGameObj?.score ?? null,
      highSeries: stats.bestSeries?.total ?? null,
      frameCount: stats.frameCount,
      strikePct: stats.strikePct,
      closedFramePct: stats.closedFramePct
    };
  }

  function renderStats() {
    const selected = statsGames();
    const stats = calculateStats(selected);
    const series = completedSeriesTotals(selected);
    $('statAverageSeries').textContent = series.length ? avg(series).toFixed(1) : '—';
    $('statAverageSeriesDetail').textContent = series.length ? `${series.length} completed 3-game series` : 'Need 3 games in one session';
    dom.average.textContent = stats.count ? stats.average.toFixed(1) : '—';
    dom.averageDetail.textContent = `${stats.count} game${stats.count === 1 ? '' : 's'}`;

    dom.highGame.textContent = stats.highGameObj ? stats.highGameObj.score : '—';
    dom.highGameDetail.textContent = stats.highGameObj
      ? [fmtDate(stats.highGameObj.date), cleanAlley(stats.highGameObj.alley)].filter(Boolean).join(' · ')
      : 'No games yet';

    dom.highSeries.textContent = stats.bestSeries ? stats.bestSeries.total : '—';
    dom.highSeriesDetail.textContent = stats.bestSeries
      ? `${fmtDate(stats.bestSeries.session.date)} · ${stats.bestSeries.session.name}`
      : 'Need 3 games in one session';

    dom.strikePct.textContent = stats.frameCount ? `${stats.strikePct.toFixed(1)}%` : '—';
    dom.strikePctDetail.textContent = stats.frameCount ? `${stats.totalStrikes} strikes · ${stats.frameCount} games with details` : 'No frame details recorded';

    dom.openAvg.textContent = stats.frameCount ? stats.openAvg.toFixed(2) : '—';
    dom.openRateDetail.textContent = stats.frameCount ? `${stats.openRate.toFixed(1)}% open-frame rate` : 'No frame details recorded';

    dom.closedFramePct.textContent = stats.frameCount ? `${stats.closedFramePct.toFixed(1)}%` : '—';
    dom.closedFrameDetail.textContent = stats.frameCount
      ? `${stats.totalClosed} / ${stats.totalFrames} frames closed`
      : 'No frame details recorded';

    dom.cleanGames.textContent = stats.frameCount ? stats.cleanGames : '—';
    dom.cleanGamesDetail.textContent = stats.frameCount ? `${stats.cleanRate.toFixed(1)}% of games with details` : 'No frame details recorded';

    dom.sessions.textContent = stats.sessions.length;
    dom.gamesAndMilestones.textContent = `${stats.count} games in the selected filters`;

    dom.more200.textContent = stats.games200;
    dom.more250.textContent = stats.games250;
    dom.more300.textContent = stats.games300;
    dom.moreStrikeAvg.textContent = stats.frameCount ? stats.strikesPerGame.toFixed(2) : '—';
    dom.moreLast5.textContent = stats.count ? stats.last5.toFixed(1) : '—';
    dom.recordBestSession.textContent = stats.bestSession ? stats.bestSession.average.toFixed(1) : '—';
    dom.recordBestSessionDetail.textContent = stats.bestSession ? `${fmtDate(stats.bestSession.date)} · ${stats.bestSession.name}` : 'No sessions yet';
    dom.recordMostStrikes.textContent = stats.mostStrikesGame ? stats.mostStrikesGame.strikes : '—';
    dom.recordMostStrikesDetail.textContent = stats.mostStrikesGame ? `${stats.mostStrikesGame.score} game · ${fmtDate(stats.mostStrikesGame.date)}` : 'No games yet';
    dom.recordBestStrikePct.textContent = stats.bestStrikePctGame ? `${((stats.bestStrikePctGame.strikes / stats.bestStrikePctGame.strikeOpportunities) * 100).toFixed(1)}%` : '—';
    dom.recordBestStrikePctDetail.textContent = stats.bestStrikePctGame ? `${stats.bestStrikePctGame.strikes}/${stats.bestStrikePctGame.strikeOpportunities} · ${fmtDate(stats.bestStrikePctGame.date)}` : 'No games yet';
    dom.recordRecent200.textContent = stats.recent200 ? stats.recent200.score : '—';
    dom.recordRecent200Detail.textContent = stats.recent200 ? fmtDate(stats.recent200.date) : 'No 200+ games yet';
  }

  function renderHistory() {
    const source = filteredGames();
    const fullSessions = new Map(buildSessions(games).map(session => [session.key, session]));
    let sessions = matchingSessions(buildSessions(source));
    const sort = dom.sortFilter.value;
    const filterCount = Number(!!sort && sort !== 'newest') + Number(!!$('historyScoring').value) + Number(!!($('sessionFrom').value || $('sessionTo').value));
    if ($('sessionFiltersLabel')) $('sessionFiltersLabel').textContent = filterCount ? `Filters · ${filterCount}` : 'Filters';

    if (sort === 'oldest') {
      sessions.sort((a, b) => a.date.localeCompare(b.date));
    } else if (sort === 'highscore') {
      sessions.sort((a, b) => b.highGame - a.highGame || b.date.localeCompare(a.date));
    } else {
      sessions.sort((a, b) => b.date.localeCompare(a.date));
    }

    dom.emptyHistory.classList.toggle('hidden', games.length > 0);
    $('noSessionMatches').classList.toggle('hidden', !games.length || sessions.length > 0);
    $('historyResultCount').textContent = sessions.length ? `Showing ${Math.min(historyLimit, sessions.length)} of ${sessions.length} sessions` : '';
    $('showMoreSessions').classList.toggle('hidden', sessions.length <= historyLimit);
    sessions = sessions.slice(0, historyLimit);
    if (!sessions.length) { History.patchSessions(dom.sessionsList, []); return; }
    History.patchSessions(dom.sessionsList, History.historyRows(sessions, fullSessions, expandedSessions));

    window.dispatchEvent(new CustomEvent('bowling:history-rendered'));
  }

  function setGameActions(id, open) {
    dom.sessionsList.querySelectorAll('.game-actions-toggle').forEach(button => {
      const show = open && IDs.recordId(button.dataset.id) === id;
      button.setAttribute('aria-expanded', String(show));
      $('gameActions-' + button.dataset.id).hidden = !show;
    });
  }

  async function moveGame(id, direction) {
    if (mutationBusy) return;
    const session = buildSessions(games).find(s => s.games.some(g => g.id === id));
    if (!session) return;
    const index = session.games.findIndex(g => g.id === id), next = index + direction;
    if (next < 0 || next >= session.games.length) return;
    const ordered = [...session.games]; [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    const now = Math.max(Date.now(), ...ordered.map(g => Number(g.updatedAt || 0)+1));
    const updated = ordered.map((g,i) => ({...g,gameOrder:i+1,updatedAt:now}));
    const targetDb = db; mutationBusy = true;
    try {
      await commitGames(updated, [], targetDb);
      if (db !== targetDb) return;
      games = await getAllGames(); renderAll();
      setGameActions(id, true);
      $('gameActionsToggle-' + id)?.focus();
      setStatus($('historyActionStatus'), `Moved game to position ${next + 1}.`, 'success');
      emitDataChanged({type:'batch-upsert',games:clone(updated),bases:updated.map(g => clone(session.games.find(old => old.id === g.id)))});
    } catch (_) { setStatus($('historyActionStatus'), 'Could not change game order. Please try again.', 'error'); }
    finally { mutationBusy = false; }
  }

  function renderAll() {
    renderBallOptions();
    renderAlleyOptions();
    renderStats();
    renderProgress();
    renderComparison();
    renderHistory();
    updateSessionSuggestions();
    updateIdentityBar();
    renderHome();
    window.dispatchEvent(new CustomEvent('bowling:rendered'));
  }

  function validateGameForm(fields = dom) {
    const bowler = activeProfileName || 'Bowler';
    const date = fields.date.value;
    const sessionName = fields.sessionName.value.trim();
    const type = sessionType({sessionType: fields.sessionType?.value});
    const scoreOnly = fields.entryDetail?.value === 'score-only';
    const score = Number(fields.score.value);
    const openFrames = Number(fields.openFrames.value);
    const strikes = Number(fields.strikes.value);
    const strikeOpportunities = Number(fields.strikeOpp.value);
    const notes = fields.notes.value.trim();
    const balls = Balls.fromDraft(Balls.draft(fields.ball), canonicalBall);
    const ballError = Balls.error(balls);
    if (ballError) return {error: ballError};
    const ball = balls[0]?.name || '';
    const alley = cleanAlley(fields.alley?.value);
    if (alley.length > 100) return {error: 'Alley names must be 100 characters or fewer.'};

    if (!date || fields.score.value === '' || (!scoreOnly && (fields.openFrames.value === '' || fields.strikes.value === '' || fields.strikeOpp.value === ''))) {
      return { error: scoreOnly ? 'Please fill in date and score.' : 'Please fill in date, score, open frames, strikes, and strike opportunities, or choose Score only.' };
    }
    if (!isValidDate(date)) return { error: 'Please enter a valid bowling date.' };
    if (!Number.isInteger(score) || score < 0 || score > 300) return { error: 'Score must be a whole number from 0 to 300.' };
    if (!scoreOnly) {
      if (!Number.isInteger(openFrames) || openFrames < 0 || openFrames > 10) return { error: 'Open frames must be a whole number from 0 to 10.' };
      if (!Number.isInteger(strikes) || strikes < 0 || strikes > 12) return { error: 'Strikes must be a whole number from 0 to 12.' };
      if (!Number.isInteger(strikeOpportunities) || strikeOpportunities < 10 || strikeOpportunities > 12) return { error: 'Strike opportunities must be a whole number from 10 to 12.' };
      if (strikes > strikeOpportunities) return { error: 'Strikes cannot exceed strike opportunities.' };
      if (score === 300 && strikes !== 12) return { error: 'A 300 game should be recorded as 12 strikes.' };
      if (score === 300 && openFrames !== 0) return { error: 'A 300 game cannot have open frames.' };
      if (strikes === 12 && score !== 300) return { error: '12 strikes must have a score of 300.' };
      const closedFrames = 10 - openFrames;
      if (strikes > (closedFrames ? closedFrames + 2 : 0)) return { error: 'The strike count is too high for this many open frames. Check both counts, including tenth-frame fill shots.' };
      if (score < strikes * 10) return { error: 'The score is too low for this many strikes. Check the score and strike count.' };
      if (openFrames === 0 && score < 100) return { error: 'A clean game must score at least 100. Check the score or open frames.' };

    }
    return {
      value: { bowler, date, sessionName, sessionId: fields === dom ? entrySessionId : seriesSessionId, sessionType: type, ball, balls, alley, noTap: fields.noTap?.value === 'no-tap', score, scoreOnly, openFrames: scoreOnly ? null : openFrames, strikes: scoreOnly ? null : strikes, strikeOpportunities: scoreOnly ? null : strikeOpportunities, notes }
    };
  }

  function possibleDuplicate(candidate) {
    return games.find((g) => g.id !== editingGameId
      && g.date === candidate.date
      && isNoTap(g) === isNoTap(candidate)
      && sessionKey(g) === sessionKey(candidate)
      && Number(g.score) === candidate.score
      && hasFrameStats(g) === hasFrameStats(candidate)
      && (!hasFrameStats(candidate) || (Number(g.openFrames) === candidate.openFrames
      && Number(g.strikes) === candidate.strikes
      && Number(g.strikeOpportunities || 10) === candidate.strikeOpportunities)));
  }

  function isValidDate(...args) { return Game.isValidDate(...args); }

  function isValidGame(...args) { return Game.isValidGame(...args); }

  function normalizeGame(...args) { return Game.normalizeGame(...args); }

  async function saveGameFromForm() {
    if (mutationBusy) return;
    const validated = validateGameForm();
    if (validated.error) {
      setStatus(dom.entryStatus, validated.error, 'error');
      return;
    }

    const duplicate = possibleDuplicate(validated.value);
    if (duplicate && !window.confirm(`Possible duplicate detected: a ${duplicate.score} game is already saved for ${fmtDate(duplicate.date)} in ${sessionLabel(duplicate)}. Save another copy anyway?`)) {
      setStatus(dom.entryStatus, 'Duplicate save cancelled.');
      return;
    }
    const now = Date.now();
    const existing = editingGameId ? games.find((g) => g.id === editingGameId) : null;
    if (editingGameId && (!existing || (!entryBaseGame || JSON.stringify(normalizeGame(existing)) !== JSON.stringify(normalizeGame(entryBaseGame))))) {
      setStatus(dom.entryStatus, 'This game changed since you opened it. Your draft is kept; cancel and reopen the current game before saving.', 'error'); return;
    }
    const sessionId = entrySessionId || sessionKey(validated.value);
    const game = {
      sessionId, schemaVersion: Game.DATA_SCHEMA_VERSION,
      id: editingGameId || IDs.newGameId(),
      ...validated.value,
      gameOrder: existing ? IDs.orderValue(existing) : nextGameOrder(sessionId),
      createdAt: existing?.createdAt ?? now,
      updatedAt: Math.max(now, Number(existing?.updatedAt || 0) + 1)
    };

    const related = games.filter(g => g.id !== game.id && sessionKey(g) === sessionKey(game) && sessionType(g) !== game.sessionType);
    const updates = [game,...related.map(g => ({...g,sessionType:game.sessionType,updatedAt:Math.max(now,Number(g.updatedAt||0)+1)}))];
    const bases = [existing || null,...related];
    mutationBusy = true;
    dom.saveGameBtn.disabled = true;
    const targetDb = db;
    try {
      await commitGames(updates, [], targetDb);
      if (db !== targetDb) return;
      games = await getAllGames();
      const returnTo = editingGameId ? editReturn : null;
      if (editingGameId) {
        setStatus(dom.entryStatus, '✓ Game updated', 'success');
      } else {
        setStatus(dom.entryStatus, '✓ Game saved', 'success');
      }
      resetEntryForm({ preserveDate: true, preserveSession: true });
      renderAll();
      if (returnTo) {
        returnFromEdit(returnTo);
        setStatus($('historyActionStatus'), '✓ Game updated', 'success');
      }
      emitDataChanged({ type: 'batch-upsert', games: clone(updates), bases: clone(bases) });
    } catch (error) {
      console.error(error);
      setStatus(dom.entryStatus, 'Could not save the game on this device.', 'error');
    } finally {
      mutationBusy = false;
      dom.saveGameBtn.disabled = false;
    }
  }

  function resetEntryForm({ preserveDate = false, preserveSession = false } = {}) {
    const date = preserveDate ? dom.date.value : todayLocal();
    const sessionName = preserveSession ? dom.sessionName.value : newSessionId();
    if (!preserveSession) { entrySessionId = sessionName; dom.sessionType.value = 'League'; }
    dom.date.value = date;
    dom.sessionName.value = sessionName;
    dom.score.value = '';
    dom.openFrames.value = '';
    dom.strikes.value = '';
    dom.strikeOpp.value = '10';
    dom.entryDetail.value = preserveSession && dom.entryDetail.value === 'score-only' ? 'score-only' : 'full';
    setEntryDetail();
    dom.notes.value = '';
    Balls.set(dom.ball, preserveSession ? Balls.fromDraft(Balls.draft(dom.ball)).map(({name}) => ({name})) : []);
    fillAlleySelect(dom.alley, preserveSession ? dom.alley.value : '');
    dom.noTap.value = preserveSession && dom.noTap.value === 'no-tap' ? 'no-tap' : 'standard';
    $('gameAdvanced').open = false;
    editingGameId = null;
    editReturn = null;
    entryBaseGame = null;
    clearDraft('entry');
    dom.saveGameBtn.textContent = 'Save game';
    dom.cancelEditBtn.classList.add('hidden');
    dom.entryHeading.textContent = 'Add game';
    dom.entrySubheading.textContent = 'Enter one game or a full series.';
    clearPhoto();
    updateSessionSuggestions();
    rememberEntry();
    showDraftNotice();
  }

  function startEdit(id) {
    if (hasEntryDraft() && !window.confirm('Discard the unsaved entry and edit this game?')) return;
    const game = games.find((g) => g.id === id);
    if (!game) return;
    editReturn = { view: document.querySelector('.app-view:not([hidden])')?.id?.replace('view-', '') || 'sessions', y: window.scrollY || 0 };
    showView('home', false);
    clearDraft('entry');
    editingGameId = id;
    entryBaseGame = clone(game);
    entrySessionId = sessionKey(game);
    dom.date.value = game.date;
    dom.sessionName.value = game.sessionName || '';
    dom.sessionType.value = sessionType(game);
    updateSessionSuggestions();
    dom.score.value = game.score;
    dom.openFrames.value = game.openFrames ?? '';
    dom.strikes.value = game.strikes ?? '';
    dom.strikeOpp.value = game.strikeOpportunities ?? 10;
    dom.entryDetail.value = hasFrameStats(game) ? 'full' : 'score-only';
    setEntryDetail();
    dom.notes.value = game.notes || '';
    Balls.set(dom.ball, Balls.list(game));
    fillAlleySelect(dom.alley, game.alley || '');
    dom.noTap.value = isNoTap(game) ? 'no-tap' : 'standard';
    $('gameAdvanced').open = !!dom.ball.value || !!dom.alley.value || !!game.notes || isNoTap(game);
    updateEntryContext();
    dom.saveGameBtn.textContent = 'Update game';
    dom.cancelEditBtn.classList.remove('hidden');
    dom.entryHeading.textContent = 'Edit game';
    dom.entrySubheading.textContent = 'Edit the details, then save your changes.';
    setEntryMode(false);
    setStatus(dom.entryStatus, 'Editing saved game.');
    rememberEntry();
    window.scrollTo({ top: document.querySelector('.entry-panel').offsetTop - 12, behavior: 'smooth' });
  }

  function returnFromEdit(destination) {
    showView(destination.view, false);
    $('mainContent').focus({preventScroll: true});
    window.scrollTo({top: destination.y, behavior: 'instant'});
  }

  async function confirmDelete(id) {
    if (mutationBusy) return;
    const game = games.find((g) => g.id === id);
    if (!game) return;
    const targetDb = db;
    const tombstone = { id, updatedAt: Math.max(Date.now(), Number(game.updatedAt || 0) + 1) };
    mutationBusy = true;
    try {
      await commitGames([], [tombstone], targetDb);
      if (db !== targetDb) return;
      games = await getAllGames();
      if (editingGameId === id) resetEntryForm({ preserveDate: true, preserveSession: true });
      clearUndo();
      undoDeletion = { game: clone(game), database: targetDb, deletedAt: tombstone.updatedAt };
      $('undoMessage').textContent = `${game.score} game deleted.`;
      $('undoToast').classList.remove('hidden');
      undoTimer = setTimeout(clearUndo, 15000);
      renderAll();
      emitDataChanged({ type: 'delete', id, tombstone: clone(tombstone), bases: [clone(game)] });
    } catch (error) {
      setStatus(dom.entryStatus, 'Could not delete the game. Please try again.', 'error');
    } finally { mutationBusy = false; }
  }

  async function clearAllHistory() {
    if (mutationBusy) return;
    if (!games.length) { setStatus(dom.settingsStatus, 'There is no bowling history to delete.'); return; }
    const cloudNote = runtime.cloud?.isSignedIn?.() ? ' The deletions will also sync to your cloud account.' : '';
    if (!window.confirm(`Delete every saved bowling game?${cloudNote} This cannot be undone unless you have an exported backup.`)) return;
    const targetDb = db, bases = clone(games), now = Date.now();
    const tombstones = bases.map(game => ({id: game.id, updatedAt: Math.max(now, Number(game.updatedAt || 0) + 1)}));
    mutationBusy = true;
    dom.clearAllBtn.disabled = true;
    try {
      await commitGames([], tombstones, targetDb);
      if (db !== targetDb) return;
      clearUndo();
      const refreshed = await getAllFromDb(targetDb, GAME_STORE);
      if (db !== targetDb) return;
      games = refreshed;
      if (editingGameId) resetEntryForm();
      renderAll();
      emitDataChanged({type: 'batch-delete', tombstones, bases});
      setStatus(dom.settingsStatus, 'All bowling history deleted.', 'success');
    } catch (error) {
      if (db === targetDb) setStatus(dom.settingsStatus, 'Could not delete history. Please try again.', 'error');
    } finally { mutationBusy = false; dom.clearAllBtn.disabled = false; }
  }

  function setEntryMode(photoMode) {
    dom.manualTab.classList.toggle('active', !photoMode);
    dom.manualTab.setAttribute('aria-pressed', String(!photoMode));
    dom.photoTab.setAttribute('aria-pressed', String(photoMode));
    dom.photoTab.classList.toggle('active', photoMode);
    dom.photoTab.setAttribute('aria-expanded', String(photoMode));
    dom.photoArea.classList.toggle('hidden', !photoMode);
  }

  function handlePhotoSelection() {
    const file = dom.scoreboardPhoto.files?.[0];
    if (!file) return;
    clearPhoto(false);
    selectedPhotoUrl = URL.createObjectURL(file);
    dom.photoPreview.src = selectedPhotoUrl;
    dom.photoPreviewWrap.classList.remove('hidden');
    setStatus(dom.entryStatus, 'Photo loaded. Confirm or enter the game numbers below.');
  }

  function clearPhoto(resetInput = true) {
    if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
    selectedPhotoUrl = null;
    dom.photoPreview.removeAttribute('src');
    dom.photoPreviewWrap.classList.add('hidden');
    if (resetInput) dom.scoreboardPhoto.value = '';
  }

  function updateIdentityBar() {
    if (dom.currentProfileName) dom.currentProfileName.textContent = activeProfileName || 'Bowler';
    if ($('headerProfileName')) $('headerProfileName').textContent = activeProfileName || 'Profile';
    const signedIn = Boolean(runtime.cloud?.isSignedIn?.());
    if (dom.defaultBowlerInput) {
      dom.defaultBowlerInput.value = activeProfileName || 'Bowler';
      dom.defaultBowlerInput.disabled = activeLocalScope.kind === 'user';
    }
    if (dom.saveDefaultBowlerBtn) dom.saveDefaultBowlerBtn.disabled = activeLocalScope.kind === 'user';
    if (!signedIn && dom.globalSyncStatus && !dom.globalSyncStatus.textContent) dom.globalSyncStatus.textContent = 'Local only';
  }

  async function loadProfileName(resetWhenMissing = false) {
    let profileName = await getSetting('profileName');
    const legacyDefault = await getSetting('defaultBowler');
    const firstGameName = games.find((g) => String(g.bowler || '').trim())?.bowler || '';
    profileName = String(profileName || legacyDefault || firstGameName || 'Bowler').trim() || 'Bowler';
    if (!await getSetting('profileName')) await setSetting('profileName', profileName);
    activeProfileName = profileName;
    if (resetWhenMissing && !profileName) activeProfileName = 'Bowler';
    updateIdentityBar();
    return activeProfileName;
  }

  async function setProfileName(name, { persist = true } = {}) {
    const next = String(name || '').trim() || 'Bowler';
    activeProfileName = next;
    if (persist) await setSetting('profileName', next);
    updateIdentityBar();
    window.dispatchEvent(new CustomEvent('bowling:profile-options-changed'));
    return next;
  }

  function setSyncStatus(text, state = '') {
    const label = state === 'error' || /error|fail|unavailable|review|attention/i.test(text || '') ? '⚠ Sync needs attention'
      : state === 'on' ? '✓ Synced' : !navigator.onLine ? (runtime.cloud?.isSignedIn?.() ? 'Offline · games will sync later' : 'Offline · saved on this device')
      : state === 'working' ? 'Syncing…' : 'Saved on this device';
    if (dom.globalSyncStatus) { dom.globalSyncStatus.textContent = label; dom.globalSyncStatus.title = text || 'Local only'; }
    if ($('headerSyncNotice')) $('headerSyncNotice').hidden = !/attention/.test(label);
    if ($('entrySyncStatus')) renderEntrySaveState();
    if (dom.globalSyncDot) dom.globalSyncDot.className = `status-dot ${state || 'off'}`.trim();
  }

  function downloadFile(filename, contents, mime) {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportBackup() {
    const tombstones = await getAllTombstones();
    const payload = {
      app: 'Bowling Tracker',
      version: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      profileName: activeProfileName,
      ballInventory: getBallInventory(),
      alleyInventory: getAlleyInventory(),
      games: [...games].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
      tombstones
    };
    downloadFile(`bowling-backup-${todayLocal()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    setStatus(dom.settingsStatus, 'Backup exported.', 'success');
  }

  function csvEscape(...args) { return Backup.csvEscape(...args); }

  function exportCsv() {
    const rows = [
      ['Date','Bowler','Session Type','Session ID','Game Order','Ball','Score','Open Frames','Strikes','Strike Opportunities','Strike %','Clean Game','Notes','Scoring','Ball Usage','Alley','Entry Detail']
    ];
    buildSessions(games).sort((a,b) => a.date.localeCompare(b.date)).forEach(session => session.games.forEach((g,index) => {
      rows.push([
        g.date, g.bowler, sessionType(g), sessionKey(g), index+1, Balls.list(g)[0]?.name || '', g.score, g.openFrames, g.strikes, g.strikeOpportunities,
        hasFrameStats(g) ? (g.strikeOpportunities ? ((g.strikes / g.strikeOpportunities) * 100).toFixed(1) : '0.0') : '',
        hasFrameStats(g) ? (g.openFrames === 0 ? 'Yes' : 'No') : '', g.notes || '', scoringLabel(g), JSON.stringify(Balls.list(g)), cleanAlley(g.alley), hasFrameStats(g) ? 'Full stats' : 'Score only'
      ]);
    }));
    const csv = '\uFEFF' + rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    downloadFile(`bowling-history-${todayLocal()}.csv`, csv, 'text/csv;charset=utf-8');
    setStatus(dom.settingsStatus, 'CSV exported.', 'success');
  }

  function importFingerprint(...args) { return Backup.importFingerprint(...args); }
  function buildImportPlan(...args) { return Backup.buildImportPlan(...args); }
  async function importBackupFile(file) {
    const targetDb = db;
    try {
      const payload = JSON.parse(await file.text());
      if (!payload || !Array.isArray(payload.games)) throw new Error('Backup does not contain a games array.');
      if (payload.games.some(g => !isValidGame(g))) throw new Error('Invalid game data. Check dates, scores, ball names/frame counts, types and game order. No games were imported.');
      const imported = payload.games.map(normalizeGame), rawDeleted = payload.tombstones || [];
      if (!Array.isArray(rawDeleted) || rawDeleted.some(t => !Game.isValidTombstone(t))) throw new Error('Invalid deletion data.');
      const deleted = rawDeleted.map(Game.normalizeTombstone);
      const ids = [...imported,...deleted].map(g => g.id);
      if (new Set(ids).size !== ids.length) throw new Error('The backup repeats a game ID. Resolve repeated IDs before importing.');
      const tombstones = await getAllFromDb(targetDb,TOMBSTONE_STORE);
      const current = await getAllFromDb(targetDb,GAME_STORE);
      if (targetDb !== db) return;
      const rows = buildImportPlan(imported,deleted,current,tombstones);
      const inventory = payload.ballInventory || payload.profile?.ballInventory || [];
      if (!Array.isArray(inventory) || inventory.some(row => Balls.mergeInventory([row]).length !== 1)) throw new Error('Invalid ball inventory in backup.');
      const alleys = payload.alleyInventory || payload.profile?.alleyInventory || [];
      if (!Array.isArray(alleys) || alleys.some(row => Balls.mergeInventory([row]).length !== 1)) throw new Error('Invalid alley list in backup.');
      pendingImport = {database:targetDb,rows,inventory,alleys,snapshot:JSON.stringify([current,tombstones])};
      $('importPreviewSummary').textContent = `${rows.filter(r=>r.kind==='addition').length} additions · ${rows.filter(r=>r.kind==='duplicate').length} duplicates (skipped) · ${rows.filter(r=>r.kind==='conflict').length} conflicts`;
      if (alleys.length) $('importPreviewSummary').textContent += ' · Saved alleys will be merged';
      if (inventory.length) $('importPreviewSummary').textContent += ' · Saved ball inventory will be merged';
      $('importPreviewRows').innerHTML = rows.map(r => `<div class="import-row"><strong>${escapeHtml(r.game?.date || r.local?.date || '')} · ${r.game ? r.game.score+' points · '+scoringLabel(r.game)+(hasFrameStats(r.game) ? ' · Full stats' : ' · Score only') : 'Backup deletion'}</strong>${r.game ? `<p>Backup balls: ${escapeHtml(Balls.summary(r.game))}</p><p>Backup alley: ${escapeHtml(r.game.alley || 'None')}</p>` : ''}<p>${r.kind}${r.local ? ' · Current: '+r.local.score+' points · '+scoringLabel(r.local)+(hasFrameStats(r.local) ? ' · Full stats' : ' · Score only') : r.tombstone ? ' · Deleted on this device' : ''}</p>${r.local ? `<p>Current balls: ${escapeHtml(Balls.summary(r.local))}</p><p>Current alley: ${escapeHtml(r.local.alley || 'None')}</p>` : ''}${r.kind==='conflict' ? `<label>Resolution<select data-import-id="${r.id}"><option value="keep">Keep current data</option><option value="backup">${r.deletion ? 'Apply backup deletion' : 'Use backup game'}</option></select></label>` : ''}</div>`).join('');
      setStatus($('importPreviewStatus'),''); openDialog($('importPreviewDialog'));
    } catch (error) { setStatus(dom.settingsStatus,`Import failed: ${error.message}`,'error'); }
    finally { dom.importJsonInput.value = ''; }
  }
  async function confirmImport() {
    const plan = pendingImport;
    if (!plan || plan.database !== db || mutationBusy) return;
    mutationBusy = true; $('confirmImportBtn').disabled = true;
    try {
      const [current,tombstones] = await Promise.all([getAllFromDb(plan.database,GAME_STORE),getAllFromDb(plan.database,TOMBSTONE_STORE)]);
      if (db !== plan.database) return;
      if (JSON.stringify([current,tombstones]) !== plan.snapshot) throw new Error('History changed while reviewing. Cancel and select the backup again for a fresh preview.');
      const choices = new Map([...$('importPreviewRows').querySelectorAll('[data-import-id]')].map(el => [IDs.recordId(el.dataset.importId),el.value]));
      const selected = plan.rows.filter(r => r.kind==='addition' || (r.kind==='conflict' && choices.get(r.id)==='backup'));
      const now = Date.now();
      const upserts = selected.filter(r=>r.game).map(r=>({...r.game,updatedAt:Math.max(now,r.game.updatedAt+1,Number(r.local?.updatedAt||r.tombstone?.updatedAt||0)+1)}));
      const deletes = selected.filter(r=>r.deletion).map(r=>({...r.deletion,updatedAt:Math.max(now,r.deletion.updatedAt+1,Number(r.local?.updatedAt||0)+1)}));
      await commitGames(upserts,deletes,plan.database);
      if (db !== plan.database) return;
      if (plan.inventory?.length) await mergeBallInventory(plan.inventory);
      if (plan.alleys?.length) await mergeAlleyInventory(plan.alleys);
      if (db !== plan.database) return;
      games = await getAllGames(); pendingImport = null; closeDialog($('importPreviewDialog')); renderAll();
      if (selected.length || plan.inventory?.length || plan.alleys?.length) emitDataChanged({type:'bulk'});
      setStatus(dom.settingsStatus,`Imported ${upserts.length} games and applied ${deletes.length} reviewed deletions.`,'success');
    } catch (error) { setStatus($('importPreviewStatus'),error.message,'error'); }
    finally { mutationBusy = false; $('confirmImportBtn').disabled = false; }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      dom.offlineStatus.textContent = 'Offline use is not supported by this browser';
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
      runtime.updates?.start(registration);
      await navigator.serviceWorker.ready;
      offlineCacheReady = true;
      dom.offlineStatus.textContent = navigator.onLine ? 'Online · ready for offline use' : 'Offline · saved games available';
    } catch (error) {
      console.error(error);
      dom.offlineStatus.textContent = 'Offline use is unavailable on this page';
    }
  }

  async function applyRemoteChanges({ upserts = [], deletes = [], expectedUid } = {}) {
    if (expectedUid !== undefined && activeLocalScope.uid !== expectedUid) return;
    const targetDb = db;
    if (upserts.some(game => !isValidGame(game)) || deletes.some(deletion => !Game.isValidTombstone(deletion))) {
      throw new Error('Cloud history contains invalid or unsupported game data. No local changes were applied.');
    }
    const validUpserts = upserts.map(normalizeGame);
    const validDeletes = deletes.map(Game.normalizeTombstone);
    await commitGames(validUpserts, validDeletes, targetDb);
    if (db !== targetDb) return;
    const refreshed = await getAllFromDb(targetDb, GAME_STORE);
    if (db !== targetDb) return;
    games = refreshed;
    await mergeBallInventory([], expectedUid);
    await mergeAlleyInventory([], expectedUid);
    if (db !== targetDb) return;
    renderAll();
  }

  // One transaction ensures a series or session edit is saved completely or not at all.
  function commitGames(upserts = [], deletions = [], database = db) { return Storage.commitGames(database, upserts, deletions); }

  function clearUndo() {
    clearTimeout(undoTimer);
    undoDeletion = null;
    $('undoToast').classList.add('hidden');
  }

  async function undoLastDeletion() {
    const item = undoDeletion;
    if (!item || item.database !== db || mutationBusy) return;
    mutationBusy = true;
    $('undoDeleteBtn').disabled = true;
    clearTimeout(undoTimer);
    try {
      const current = await idbRequest(GAME_STORE, 'readonly', (store) => store.get(item.game.id));
      const tombstone = await getTombstone(item.game.id);
      if (db !== item.database) return;
      if (current || !tombstone || tombstone.updatedAt !== item.deletedAt) {
        clearUndo();
        setStatus(dom.entryStatus, 'This game changed since deletion. Review its current history before editing.');
        return;
      }
      const restored = { ...item.game, updatedAt: Math.max(Date.now(), item.deletedAt + 1) };
      await commitGames([restored], [], item.database);
      if (db !== item.database) return;
      games = await getAllGames();
      clearUndo();
      renderAll();
      emitDataChanged({ type: 'upsert', game: clone(restored), bases: [{...tombstone, deleted: true}] });
      setStatus(dom.entryStatus, 'Game restored.', 'success');
    } catch (error) {
      $('undoMessage').textContent = 'Restore failed. Try Undo again.';
      undoTimer = setTimeout(clearUndo, 15000);
    } finally { mutationBusy = false; $('undoDeleteBtn').disabled = false; }
  }

  function addToSession(key) {
    const session = buildSessions(games).find((s) => s.key === key);
    if (!session) return;
    if (hasEntryDraft() && !window.confirm('Discard the current entry and add a game to this session?')) return;
    showView('home', false);
    resetEntryForm();
    entrySessionId = session.key;
    dom.date.value = session.date;
    dom.sessionName.value = session.games[0].sessionName || '';
    dom.sessionType.value = sessionType(session.games[0]);
    fillAlleySelect(dom.alley, session.games.at(-1)?.alley || '');
    dom.noTap.value = isNoTap(session.games.at(-1)) ? 'no-tap' : 'standard';
    $('gameAdvanced').open = !!dom.alley.value || dom.noTap.value === 'no-tap';
    updateSessionSuggestions();
    setEntryMode(false);
    rememberEntry();
    setStatus(dom.entryStatus, `Adding to ${session.name} · ${fmtDate(session.date)}.`);
    document.querySelector('.entry-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    dom.score.focus({ preventScroll: true });
  }

  function addSeriesRow() {
    const row = document.createElement('fieldset');
    row.className = 'series-row';
    row.innerHTML = `<legend>Game</legend><div class="form-grid series-core">
      <label class="series-tracking">Tracking<select data-field="entryDetail"><option value="full">Full stats</option><option value="score-only">Score only</option></select></label>
      <label class="series-metric series-score"><span>Score</span><input data-field="score" type="number" min="0" max="300" step="1" inputmode="numeric" required></label>
      <label class="series-metric"><span>Open frames</span><input data-field="openFrames" type="number" min="0" max="10" step="1" inputmode="numeric" required></label>
      <label class="series-metric"><span>Strikes</span><input data-field="strikes" type="number" min="0" max="12" step="1" inputmode="numeric" required></label>
      <label>Strike opportunities<select data-field="strikeOpp" required><option value="10">10</option><option value="11">11</option><option value="12">12</option></select></label>
    </div><div class="series-row-actions"><details class="advanced-options" data-ball-advanced><summary>Advanced</summary><label class="series-notes"><span>Notes <small>optional</small></span><input data-field="notes" type="text"></label><div class="ball-editor" data-ball-editor><div class="ball-usage-row" data-ball-first><label class="ball-name-field"><span>Ball <small>optional</small></span><select data-field="ball" data-ball-select><option value="">No ball selected</option></select></label></div></div></details><button class="text-btn danger-text remove-series-row" type="button">Remove game</button></div>`;
    const fields = seriesFields(row);
    fields.entryDetail.value = dom.entryDetail.value || 'full';
    setEntryDetail(fields);
    fields.entryDetail.addEventListener('change', () => { setEntryDetail(fields); persistDrafts(); });
    row.querySelector('.remove-series-row').addEventListener('click', () => {
      if ($('seriesRows').children.length > 1) { row.remove(); numberSeriesRows(); updateSeriesPreview(); persistDrafts(); }
    });
    row.querySelector('[data-field="score"]').addEventListener('input', (event) => {
      if (event.target.value === '300' && fields.entryDetail.value !== 'score-only') {
        for (const [field, value] of [['openFrames', 0], ['strikes', 12], ['strikeOpp', 12]]) row.querySelector(`[data-field="${field}"]`).value = value;
      }
    });
    row.querySelector('[data-field="strikes"]').addEventListener('input', (event) => {
      const opp = row.querySelector('[data-field="strikeOpp"]');
      if (+event.target.value > +opp.value) opp.value = Math.min(12, +event.target.value);
    });
    Balls.fillSelect(row.querySelector('[data-field="ball"]'), $('seriesBall').value);
    Balls.attach(row.querySelector('[data-field="ball"]'), row.querySelector('[data-ball-editor]'), row.querySelector('[data-ball-first]'), document, persistDrafts);
    $('seriesRows').appendChild(row);
    numberSeriesRows();
    updateSeriesPreview();
    return row;
  }

  function numberSeriesRows() {
    [...$('seriesRows').children].forEach((row, i, rows) => {
      row.querySelector('legend').textContent = `Game ${i + 1}`;
      row.querySelector('.remove-series-row').disabled = rows.length === 1;
    });
  }

  function openSeriesEntry() {
    if (readDraft('series') && !restoringDraft) { recoverDraft('series'); return; }
    if (editingGameId) { setStatus(dom.entryStatus, 'Finish or cancel the game edit before entering a series.'); return; }
    dialogScope = db;
    seriesSessionId = entrySessionId;
    $('seriesDate').value = dom.date.value || todayLocal();
    $('seriesName').value = dom.sessionName.value;
    $('seriesType').value = dom.sessionType.value;
    Balls.fillSelect($('seriesBall'), dom.ball.value);
    fillAlleySelect($('seriesAlley'), dom.alley.value);
    $('seriesNoTap').value = dom.noTap.value === 'no-tap' ? 'no-tap' : 'standard';
    $('seriesAdvanced').open = false;
    if ($('seriesDetails')) $('seriesDetails').open = false;
    $('seriesRows').innerHTML = '';
    const first = addSeriesRow();
    for (const field of ['score', 'openFrames', 'strikes', 'strikeOpp', 'notes', 'ball']) first.querySelector(`[data-field="${field}"]`).value = dom[field].value;
    Balls.set(first.querySelector('[data-field="ball"]'), Balls.draft(dom.ball));
    first.querySelector('[data-ball-advanced]').open = false;
    addSeriesRow(); addSeriesRow();
    setStatus($('seriesStatus'), '');
    updateSeriesPreview();
    dialogBaselines.set('seriesDialog', dialogSnapshot('seriesDialog'));
    openDialog($('seriesDialog'));
    persistDrafts();
  }

  async function saveSeries(event) {
    event.preventDefault();
    if (mutationBusy || dialogScope !== db) return;
    const values = [];
    for (const [i, row] of [...$('seriesRows').children].entries()) {
      const fields = { date: $('seriesDate'), sessionName: $('seriesName'), sessionType: $('seriesType'), noTap: $('seriesNoTap'), alley: $('seriesAlley') };
      for (const field of ['score', 'openFrames', 'strikes', 'strikeOpp', 'notes', 'ball']) fields[field] = row.querySelector(`[data-field="${field}"]`);
      fields.entryDetail = row.querySelector('[data-field="entryDetail"]');
      const result = validateGameForm(fields);
      if (result.error) { setStatus($('seriesStatus'), `Game ${i + 1}: ${result.error}`, 'error'); return; }
      values.push(result.value);
    }
    const duplicate = values.some((value) => possibleDuplicate(value));
    if (duplicate && !window.confirm('One or more games match saved games in this session. Save this series anyway?')) return;
    mutationBusy = true;
    $('saveSeriesBtn').disabled = true;
    const targetDb = db;
    const now = Date.now();
    const used = new Set(games.map((g) => g.id));
    const added = values.map((value, i) => {
      let id = IDs.newGameId();
      while (used.has(id)) id = IDs.newGameId();
      used.add(id);
      return { ...value, id, sessionId: seriesSessionId || sessionKey(value), schemaVersion: Game.DATA_SCHEMA_VERSION, gameOrder: nextGameOrder(seriesSessionId || sessionKey(value)) + i, createdAt: now + i, updatedAt: now + i };
    });
    const related = games.filter(g => sessionKey(g) === sessionKey(added[0]) && sessionType(g) !== added[0].sessionType);
    const updates = [...added,...related.map(g => ({...g,sessionType:added[0].sessionType,updatedAt:Math.max(now,Number(g.updatedAt||0)+1)}))];
    try {
      await commitGames(updates, [], targetDb);
      if (db !== targetDb) return;
      games = await getAllGames();
      entrySessionId = added[0].sessionId;
      dom.date.value = values[0].date;
      dom.sessionName.value = values[0].sessionName;
      dom.sessionType.value = values[0].sessionType;
      fillAlleySelect(dom.alley, values[0].alley);
      dom.noTap.value = values[0].noTap ? 'no-tap' : 'standard';
      clearDraft('series');
      resetEntryForm({ preserveDate: true, preserveSession: true });
      closeDialog($('seriesDialog'));
      renderAll();
      emitDataChanged({ type: 'batch-upsert', games: clone(updates), bases: [...added.map(() => null),...clone(related)] });
      setStatus(dom.entryStatus, `${added.length} games saved to this session.`, 'success');
    } catch (error) { setStatus($('seriesStatus'), 'Could not save the series. No games were added. Please try again.', 'error'); }
    finally { mutationBusy = false; $('saveSeriesBtn').disabled = false; }
  }

  function openSessionEditor(key) {
    const session = buildSessions(games).find((s) => s.key === key);
    if (!session) return;
    editSessionKey = key;
    dialogScope = db;
    $('editSessionDate').value = session.date;
    $('editSessionName').value = session.games[0].sessionName || '';
    $('editSessionType').value = sessionType(session.games[0]);
    $('editSessionCount').textContent = `Update the date and type for all ${session.games.length} games in this session.`;
    setStatus($('sessionEditStatus'), '');
    dialogBaselines.set('editSessionDialog', dialogSnapshot('editSessionDialog'));
    openDialog($('editSessionDialog'));
  }

  async function saveSessionEdit(event) {
    event.preventDefault();
    if (mutationBusy || dialogScope !== db) return;
    const session = buildSessions(games).find((s) => s.key === editSessionKey);
    if (!session) { setStatus($('sessionEditStatus'), 'This session no longer exists. Close and choose another session.', 'error'); return; }
    const date = $('editSessionDate').value;
    const sessionName = $('editSessionName').value.trim();
    if (!isValidDate(date)) { setStatus($('sessionEditStatus'), 'Please enter a valid bowling date.', 'error'); return; }
    // Session identity survives metadata changes, even when dates now match.
    const updatedAt = Math.max(Date.now(), ...session.games.map((g) => Number(g.updatedAt || 0) + 1));
    const updated = session.games.map((g) => ({ ...g, sessionId: sessionKey(g), schemaVersion: Game.DATA_SCHEMA_VERSION, date, sessionName, sessionType: sessionType({sessionType:$('editSessionType').value}), updatedAt }));
    const entryWasDirty = hasEntryDraft();
    const targetDb = db;
    mutationBusy = true;
    $('saveSessionBtn').disabled = true;
    try {
      await commitGames(updated, [], targetDb);
      if (db !== targetDb) return;
      games = await getAllGames();
      if (dom.sessionSelect.value === editSessionKey || session.games.some((g) => g.id === editingGameId)) {
        dom.date.value = date;
        dom.sessionName.value = sessionName;
        dom.sessionType.value = updated[0].sessionType;
      }
      closeDialog($('editSessionDialog'));
      renderAll();
      if (!entryWasDirty) rememberEntry();
      emitDataChanged({ type: 'batch-upsert', games: clone(updated), bases: clone(session.games) });
      setStatus(dom.entryStatus, `Updated ${updated.length} games in the session.`, 'success');
    } catch (error) { setStatus($('sessionEditStatus'), 'Could not update this session. No changes were saved.', 'error'); }
    finally { mutationBusy = false; $('saveSessionBtn').disabled = false; }
  }

  function progressStats(...args) { return Stats.progressStats(...args); }

  function chartScale(...args) { return Stats.chartScale(...args); }

  function renderProgress() {
    const mode = $('chartMode').value === 'recent' ? 'recent' : 'running';
    const chartLabel = mode === 'recent' ? 'Last 10 games average' : 'Running average';
    $('chartDescription').textContent = mode === 'recent'
      ? 'Average of up to 10 recent games at each date, within the selected filters.'
      : 'Your running average within the selected filters.';
    const source = statsGames();
    const stats = progressStats(source, mode);
    const last5Count = Math.min(5, source.length);
    $('last5Count').textContent = last5Count < 5 ? `${last5Count} of 5 games recorded` : 'Most recent 5 games';
    for (const count of [10, 30]) {
      const stat = stats[`last${count}`];
      $(`moreLast${count}`).textContent = stat.average === null ? '—' : stat.average.toFixed(1);
      $(`last${count}Count`).textContent = stat.count < count ? `${stat.count} of ${count} games recorded` : `Most recent ${count} games`;
    }
    const points = stats.points;
    $('chartScaleNote').textContent = '';
    if (!points.length) { $('averageChart').innerHTML = '<p class="section-copy">Add a game to start your progress chart.</p>'; return; }
    const time = (date) => Date.parse(`${date}T12:00:00Z`);
    const first = time(points[0].date), last = time(points.at(-1).date);
    const x = (point) => first === last ? 340 : 44 + (time(point.date) - first) / (last - first) * 590;
    const { low, high, ticks } = chartScale(points);
    $('chartScaleNote').textContent = `Score scale: ${low}–${high} pins · adjusts to your averages. Each point shows the end of a bowling date.`;
    const yValue = value => 194 - (value - low) / (high - low) * 170;
    const y = point => yValue(point.average);
    const path = points.map((point, i) => `${i ? 'L' : 'M'}${x(point).toFixed(2)},${y(point).toFixed(2)}`).join(' ');
    $('averageChart').innerHTML = `<svg class="average-chart" viewBox="0 0 680 230" role="img" aria-labelledby="trendTitle trendDesc">
      <title id="trendTitle">${chartLabel} for selected games by date</title><desc id="trendDesc">${points.length} bowling dates. Latest average ${points.at(-1).average.toFixed(1)} across ${points.at(-1).count} games. Exact values are in the table below.</desc>
      ${ticks.map((value) => `<line x1="44" x2="634" y1="${yValue(value)}" y2="${yValue(value)}" class="chart-grid"/><text x="34" y="${yValue(value) + 5}" text-anchor="end">${value}</text>`).join('')}
      <path d="${path}" class="chart-line"/>
      ${points.map((point) => `<circle cx="${x(point)}" cy="${y(point)}" r="3.5" class="chart-point"><title>${escapeHtml(fmtDate(point.date))}: ${point.average.toFixed(1)} · ${point.count} games</title></circle>`).join('')}
      <text x="44" y="220">${escapeHtml(fmtDate(points[0].date))}</text>${points.length > 1 ? `<text x="634" y="220" text-anchor="end">${escapeHtml(fmtDate(points.at(-1).date))}</text>` : ''}
    </svg><details><summary>View exact averages</summary><div class="trend-table-wrap"><table class="trend-table"><thead><tr><th scope="col">Date</th><th scope="col">${mode === 'recent' ? 'Games in average' : 'Games to date'}</th><th scope="col">Average</th></tr></thead><tbody>${points.map((point) => `<tr><td>${escapeHtml(fmtDate(point.date))}</td><td>${point.count}</td><td>${point.average.toFixed(1)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }

  function showView(view, focus = true) { Navigation.navigate(view, focus); }

  function matchingSessions(sessions) {
    const query = $('sessionSearch').value.replace(/\bno[\s-]?tap\b/gi, '').trim().toLowerCase();
    const from = $('sessionFrom').value;
    const through = $('sessionTo').value;
    return sessions.filter((session) => (!query || [session.name, session.date,
      ...session.games.flatMap(game => [game.notes || '', game.alley || '', game.sessionName || '', sessionType(game), ...Balls.list(game).map(ball => ball.name)])
    ].join(' ').toLowerCase().includes(query))
      && (!from || session.date >= from) && (!through || session.date <= through));
  }

  function renderHome() {
    const source = standardGames();
    const recent = [...source].sort((a, b) => b.date.localeCompare(a.date) || gameOrder(b, a));
    $('homeRecap').innerHTML = `<div><span>Average</span><strong>${source.length ? avg(source.map(game => game.score)).toFixed(1) : '—'}</strong></div><div><span>Last 10</span><strong>${recent.length ? avg(recent.slice(0, 10).map(game => game.score)).toFixed(1) : '—'}</strong></div><div><span>Last game</span><strong>${recent[0]?.score ?? '—'}</strong></div>`;
    const latest = buildSessions(games).sort(latestSessionOrder)[0];
    $('latestSessionShortcut').classList.toggle('hidden', !latest);
    if (latest) {
      $('latestSessionLabel').textContent = `${latest.name} · ${fmtDate(latest.date)} · ${latest.games.length} games`;
      $('continueLatestBtn').dataset.key = latest.key;
    } else { $('latestSessionLabel').textContent = ''; delete $('continueLatestBtn').dataset.key; }
  }

  function updateEntryContext() {
    const date = dom.date.value === todayLocal() ? 'Today' : isValidDate(dom.date.value) ? fmtDate(dom.date.value) : 'Choose a date';
    const name = sessionType({sessionType:dom.sessionType.value});
    const session = buildSessions(games).find(item => item.key === entrySessionId);
    const count = session?.games.length || 0;
    const summary = session ? historySummary(session) : null;
    const totals = summary ? `${count} game${count === 1 ? '' : 's'}${count >= 3 ? ` · ${summary.prefix}${summary.total} total` : ''} · ${summary.prefix}${summary.average.toFixed(1)} avg` : 'New session';
    $('entrySessionSummary').textContent = `${editingGameId ? 'Editing' : 'Adding to'} ${name} · ${date} · ${totals}${dom.alley.value ? ` · ${dom.alley.value}` : ''}${dom.noTap.value === 'no-tap' ? ' · No-tap' : ''}`;
    renderEntrySaveState();
  }

  function draftKey(kind) { return Drafts.draftKey(activeLocalScope, kind); }
  function seriesHasInput(...args) { return Drafts.seriesHasInput(...args); }
  function readDraft(kind) { return Drafts.readDraft(activeLocalScope, kind, localStorage); }
  function clearDraft(kind) { if (!restoringDraft) Drafts.clearDraft(activeLocalScope, kind, localStorage); }
  function showDraftNotice() {
    const entry = !!readDraft('entry'), series = !!readDraft('series');
    $('draftNotice').hidden = !entry && !series;
    $('recoverEntry').hidden = !entry; $('recoverSeries').hidden = !series;
  }
  function persistDrafts() {
    if (restoringDraft || !db) return;
    try {
      if (hasEntryDraft()) Drafts.saveDraft(activeLocalScope, 'entry', {version:1, values:JSON.parse(entrySnapshot()), baseline:entryBaseline, base:entryBaseGame}, localStorage);
      if ($('seriesDialog').open) {
        const rows = [...$('seriesRows').children].map(row => ({...Object.fromEntries(['score','openFrames','strikes','strikeOpp','notes','ball','entryDetail'].map(field => [field,row.querySelector(`[data-field="${field}"]`).value])), balls: Balls.draft(row.querySelector('[data-field="ball"]'))}));
        const draft = {version:1,sessionId:seriesSessionId,date:$('seriesDate').value,name:$('seriesName').value,type:$('seriesType').value,ball:$('seriesBall').value,alley:$('seriesAlley').value,noTap:$('seriesNoTap').value === 'no-tap',rows};
        if (seriesHasInput(draft)) Drafts.saveDraft(activeLocalScope, 'series', draft, localStorage);
        else clearDraft('series');
      }
      showDraftNotice();
    } catch (_) { setStatus(dom.entryStatus, 'Draft storage is unavailable or full. Keep this page open until you save your games.', 'error'); }
  }
  function recoverDraft(kind) {
    const draft = readDraft(kind); if (!draft || draft.version !== 1) return;
    if (hasEntryDraft() && !window.confirm('Replace the current entry with the saved draft?')) return;
    restoringDraft = true;
    try {
      showView('home');
      if (kind === 'entry' && Array.isArray(draft.values)) {
        editingGameId = draft.values[0]; entryBaseGame = draft.base || null;
        editReturn = editingGameId ? {view: 'sessions', y: 0} : null;
        ['date','sessionName','sessionType','score','openFrames','strikes','strikeOpp','notes','ball'].forEach((key,i) => dom[key].value = draft.values[i+1] ?? '');
        dom.noTap.value = draft.values[10] === 'no-tap' ? 'no-tap' : 'standard';
        Balls.set(dom.ball, Array.isArray(draft.values[11]) ? draft.values[11] : [{name: draft.values[9] || ''}]);
        fillAlleySelect(dom.alley, draft.values[12] || '');
        dom.entryDetail.value = draft.values[13] === 'score-only' ? 'score-only' : 'full';
        entrySessionId = draft.values[14] || (draft.base ? normalizeGame(draft.base).sessionId : sessionKey({date:dom.date.value,sessionName:dom.sessionName.value}));
        setEntryDetail();
        entryBaseline = draft.baseline;
        // Older drafts lack ball and/or scoring fields. Keep their original values.
        try {
          const baseline = JSON.parse(entryBaseline);
          if (baseline.length === 9) baseline.push('');
          if (baseline.length === 10) baseline.push('standard');
          if (baseline.length === 11) baseline.push([{name: baseline[9] || '', frames: ''}]);
          if (baseline.length === 12) baseline.push('');
          if (baseline.length === 13) baseline.push('full');
          if (baseline.length === 14) baseline.push(entrySessionId);
          entryBaseline = JSON.stringify(baseline);
        } catch (_) {}
        $('gameAdvanced').open = !!dom.ball.value || !!dom.alley.value || dom.noTap.value === 'no-tap';
        dom.saveGameBtn.textContent = editingGameId ? 'Update game' : 'Save game';
        dom.entryHeading.textContent = editingGameId ? 'Edit game' : 'Add game';
        dom.cancelEditBtn.classList.remove('hidden');
        updateSessionSuggestions(); setStatus(dom.entryStatus, 'Game draft recovered. Review it before saving.', 'success');
      } else if (kind === 'series' && Array.isArray(draft.rows)) {
        if (editingGameId) { setStatus(dom.entryStatus,'Finish or cancel your game edit before recovering a series.'); return; }
        seriesSessionId = draft.sessionId || sessionKey({date:draft.date,sessionName:draft.name});
        dialogScope = db; $('seriesRows').innerHTML = '';
        $('seriesDate').value = draft.date; $('seriesName').value = draft.name; $('seriesType').value = sessionType({sessionType:draft.type}); Balls.fillSelect($('seriesBall'), draft.ball || ''); $('seriesAdvanced').open = !!draft.ball;
        fillAlleySelect($('seriesAlley'), draft.alley || '');
        $('seriesNoTap').value = draft.noTap === true ? 'no-tap' : 'standard';
        $('seriesAdvanced').open = !!draft.ball || !!draft.alley || draft.noTap === true;
        draft.rows.forEach(values => {
          const row = addSeriesRow();
          for (const field of ['score','openFrames','strikes','strikeOpp','notes','ball']) row.querySelector(`[data-field="${field}"]`).value = values[field] ?? '';
          row.querySelector('[data-field="entryDetail"]').value = values.entryDetail === 'score-only' ? 'score-only' : 'full';
          setEntryDetail(seriesFields(row));
          Balls.set(row.querySelector('[data-field="ball"]'), Array.isArray(values.balls) ? values.balls : [{name: values.ball || ''}]);
          row.querySelector('[data-ball-advanced]').open = !!values.ball || (values.balls?.length || 0) > 1;
        });
        dialogBaselines.set('seriesDialog',''); openDialog($('seriesDialog')); updateSeriesPreview();
        setStatus($('seriesStatus'),'Series draft recovered. Review it before saving.','success');
      }
    } finally { restoringDraft = false; }
  }

  function entrySnapshot() {
    return JSON.stringify([editingGameId, ...['date', 'sessionName', 'sessionType', 'score', 'openFrames', 'strikes', 'strikeOpp', 'notes', 'ball', 'noTap'].map((key) => dom[key].value), Balls.draft(dom.ball), dom.alley.value, dom.entryDetail.value || 'full', entrySessionId]);
  }
  function rememberEntry() { entryBaseline = entrySnapshot(); renderEntrySaveState(); }
  function renderEntrySaveState() {
    const sync = dom.globalSyncStatus.textContent || '';
    const needsAttention = /error|fail|unavailable|review|attention/i.test(sync);
    $('entrySyncStatus').textContent = needsAttention ? 'Sync needs attention · open Profile' : !navigator.onLine && runtime.cloud?.isSignedIn?.()
      ? 'Saved games will sync when you’re back online.' : hasEntryDraft() ? 'Unsaved changes' : '';
    $('entrySyncStatus').classList.toggle('error', needsAttention);
  }
  function hasEntryDraft() { return entryBaseline !== null && entrySnapshot() !== entryBaseline; }
  function dialogSnapshot(id) {
    const values = [...$(id).querySelectorAll('input, select')].map((input) => input.value);
    if (id === 'seriesDialog') values.push([...$('seriesRows').children].map(row => Balls.draft(row.querySelector('[data-field="ball"]'))));
    return JSON.stringify(values);
  }
  function dialogHasChanges(id) { return $(id).open && dialogBaselines.has(id) && dialogSnapshot(id) !== dialogBaselines.get(id); }
  function closeEntryDialog(id) {
    if (mutationBusy) return false;
    if (dialogHasChanges(id) && !window.confirm('Discard the unsaved changes in this window?')) return false;
    closeDialog($(id));
    if (id === 'seriesDialog') { clearDraft('series'); showDraftNotice(); }
    return true;
  }

  function updateSeriesPreview() {
    const scores = [...$('seriesRows').querySelectorAll('[data-field="score"]')];
    const entered = scores.filter((input) => input.value !== '' && Number.isInteger(Number(input.value)) && +input.value >= 0 && +input.value <= 300);
    const total = entered.reduce((sum, input) => sum + Number(input.value), 0);
    if ($('seriesContextLabel')) $('seriesContextLabel').textContent = `${$('seriesType').value} · ${$('seriesDate').value === todayLocal() ? 'Today' : fmtDate($('seriesDate').value)}`;
    $('seriesPreview').textContent = `${$('seriesNoTap').value === 'no-tap' ? 'No-tap series · ' : ''}${entered.length}/${scores.length} scores entered · Total ${total}${entered.length ? ` · Average ${(total / entered.length).toFixed(1)}` : ''}${$('seriesNoTap').value === 'no-tap' ? ' · Excluded from standard stats' : ''}`;
  }

  function wireNavigation() {
    dom.sessionsList.addEventListener('toggle', event => {
      if (event.target.matches?.('details[data-session-key]')) expandedSessions.set(event.target.dataset.sessionKey, event.target.open);
    }, true);
    dom.sessionsList.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.disabled || !dom.sessionsList.contains(button)) return;
      const id = IDs.recordId(button.dataset.id), key = button.dataset.key;
      if (button.classList.contains('add-to-session')) addToSession(key);
      else if (button.classList.contains('edit-session')) openSessionEditor(key);
      else if (button.classList.contains('game-actions-toggle')) setGameActions(id, $('gameActions-' + id).hidden);
      else if (button.classList.contains('move-game')) moveGame(id, Number(button.dataset.direction));
      else if (button.classList.contains('edit-game')) startEdit(id);
      else if (button.classList.contains('delete-game')) confirmDelete(id);
    });
    dom.sessionsList.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const row = event.target.closest('.game-row');
      const toggle = row?.querySelector('.game-actions-toggle');
      if (!toggle || $('gameActions-' + toggle.dataset.id).hidden) return;
      event.preventDefault();
      setGameActions(IDs.recordId(toggle.dataset.id), false);
      toggle.focus();
    });
    document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.goView)));
    for (const id of ['sessionSearch', 'sessionFrom', 'sessionTo']) $(id).addEventListener('input', () => { historyLimit = 10; renderHistory(); });
    $('historyScoring').addEventListener('change', () => { historyLimit = 10; renderHistory(); });
    $('clearSessionFilters').addEventListener('click', () => {
      for (const id of ['sessionSearch', 'sessionFrom', 'sessionTo']) $(id).value = '';
      $('historyScoring').value = '';
      dom.sortFilter.value = 'newest';
      historyLimit = 10; renderHistory(); $('sessionSearch').focus();
    });
    $('showMoreSessions').addEventListener('click', () => { historyLimit += 10; renderHistory(); });
    $('continueLatestBtn').addEventListener('click', () => { if ($('continueLatestBtn').dataset.key) addToSession($('continueLatestBtn').dataset.key); });
    $('seriesForm').addEventListener('input', updateSeriesPreview);
    document.querySelectorAll('.entry-grid input').forEach((input) => input.addEventListener('input', renderEntrySaveState));
    for (const id of ['seriesDialog', 'editSessionDialog']) {
      $(id).addEventListener('cancel', (event) => { event.preventDefault(); closeEntryDialog(id); });
    }
    window.addEventListener('beforeunload', (event) => {
      if (hasEntryDraft() || dialogHasChanges('seriesDialog') || dialogHasChanges('editSessionDialog')) {
        event.preventDefault(); event.returnValue = '';
      }
    });
    document.querySelectorAll('.profile-menu button').forEach((button) => button.addEventListener('click', () => { $('profileMenu').open = false; }));
    Navigation.initialize();
  }

  function wireEnhancements() {
    $('openSeriesBtn').addEventListener('click', openSeriesEntry);
    $('addSeriesRow').addEventListener('click', () => {addSeriesRow().querySelector('input').focus();persistDrafts();});
    $('seriesForm').addEventListener('submit', saveSeries);
    $('editSessionForm').addEventListener('submit', saveSessionEdit);
    $('undoDeleteBtn').addEventListener('click', undoLastDeletion);
    document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeEntryDialog(button.dataset.close)));
  }

  function wireEvents() {
    Balls.attach(dom.ball, $('gameBallEditor'), $('gameBallFirst'), document, () => { persistDrafts(); renderEntrySaveState(); });
    wireEnhancements();
    wireNavigation();
    $('applySeriesBall').addEventListener('click', applySeriesBall);
    $('seriesBall').addEventListener('input', persistDrafts);
    $('seriesNoTap').addEventListener('change', () => { updateSeriesPreview(); persistDrafts(); });
    dom.noTap.addEventListener('change', () => { updateEntryContext(); persistDrafts(); });
    $('recoverEntry').addEventListener('click', () => recoverDraft('entry'));
    $('recoverSeries').addEventListener('click', () => recoverDraft('series'));
    $('discardDrafts').addEventListener('click', () => { if (window.confirm('Discard saved game and series drafts?')) { clearDraft('entry'); clearDraft('series'); showDraftNotice(); } });
    for (const id of ['statsFrom','statsTo','statsType','statsBall','statsAlley']) $(id).addEventListener('change', () => {
      if (id === 'statsFrom' || id === 'statsTo') statsPreset = 'custom';
      refreshStatsView();
    });
    document.querySelectorAll('[data-stats-preset]').forEach(button => button.addEventListener('click', () => applyStatsPreset(button.dataset.statsPreset)));
    $('chartMode').addEventListener('change', renderProgress);
    $('clearStatsFilters').addEventListener('click', () => {
      $('statsType').value = ''; $('statsBall').value = ''; $('statsAlley').value = ''; applyStatsPreset('all');
    });
    $('confirmImportBtn').addEventListener('click', confirmImport);
    $('cancelImportBtn').addEventListener('click', () => { pendingImport = null; closeDialog($('importPreviewDialog')); });
    $('importPreviewDialog').addEventListener('cancel', () => { pendingImport = null; });
    for (const input of [dom.date,dom.sessionType,dom.score,dom.openFrames,dom.strikes,dom.strikeOpp,dom.notes,dom.ball,dom.alley]) input.addEventListener('input', () => { persistDrafts(); renderEntrySaveState(); });
    $('seriesForm').addEventListener('input', persistDrafts);
    $('seriesForm').addEventListener('change', persistDrafts);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistDrafts(); });
    window.addEventListener('pagehide', persistDrafts);
    dom.manualTab.addEventListener('click', () => setEntryMode(false));
    dom.photoTab.addEventListener('click', () => setEntryMode(dom.photoArea.classList.contains('hidden')));
    dom.scoreboardPhoto.addEventListener('change', handlePhotoSelection);
    dom.clearPhotoBtn.addEventListener('click', () => clearPhoto());
    dom.saveGameBtn.addEventListener('click', saveGameFromForm);
    dom.cancelEditBtn.addEventListener('click', () => {
      if (hasEntryDraft() && !window.confirm('Discard your unsaved changes?')) return;
      const returnTo = editReturn;
      resetEntryForm({ preserveDate: true, preserveSession: true });
      setStatus(dom.entryStatus, 'Edit cancelled.');
      if (returnTo) returnFromEdit(returnTo);
    });
    dom.sortFilter.addEventListener('change', renderHistory);
    dom.sessionSelect.addEventListener('change', selectEntrySession);
    $('sessionMode').addEventListener('change', changeSessionMode);
    dom.sessionType.addEventListener('change', () => { updateEntryContext(); persistDrafts(); });
    dom.date.addEventListener('change', () => {
      const session = games.find(game => sessionKey(game) === entrySessionId);
      if (session && session.date !== dom.date.value) entrySessionId = newSessionId();
      updateSessionSuggestions(); persistDrafts();
    });
    $('seriesDate').addEventListener('change', () => {
      const session = games.find(game => sessionKey(game) === seriesSessionId);
      if (session && session.date !== $('seriesDate').value) seriesSessionId = newSessionId();
      persistDrafts();
    });
    dom.alley.addEventListener('change', updateEntryContext);

    dom.entryDetail.addEventListener('change', () => { setEntryDetail(); persistDrafts(); renderEntrySaveState(); });
    document.querySelectorAll('[name="entryTracking"]').forEach(input => input.addEventListener('change', () => {
      dom.entryDetail.value = input.value; setEntryDetail(); persistDrafts(); renderEntrySaveState();
    }));
    dom.score.addEventListener('input', () => {
      if (Number(dom.score.value) === 300 && dom.entryDetail.value !== 'score-only') {
        dom.strikes.value = '12';
        dom.strikeOpp.value = '12';
        dom.openFrames.value = '0';
      }
    });
    dom.strikes.addEventListener('input', () => {
      const strikes = Number(dom.strikes.value || 0);
      if (strikes > Number(dom.strikeOpp.value || 10)) dom.strikeOpp.value = String(Math.min(12, Math.max(10, strikes)));
    });

    [dom.score,dom.strikes].forEach(input => input.addEventListener('input', persistDrafts));

    [dom.score, dom.openFrames, dom.strikes, dom.strikeOpp, dom.notes].forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') saveGameFromForm();
      });
    });

    dom.editProfileBtn?.addEventListener('click', () => {
      if (activeLocalScope.kind === 'user' || runtime.cloud?.isSignedIn?.()) {
        document.getElementById('openCloudBtn')?.click();
        setTimeout(() => { if ($('cloudDialog').open) $('profileDisplayNameInput')?.focus(); }, 50);
      } else {
        openDialog(dom.settingsDialog);
        setTimeout(() => { if (dom.settingsDialog.open) dom.defaultBowlerInput?.focus(); }, 50);
      }
    });
    dom.openSettingsBtn.addEventListener('click', () => openDialog(dom.settingsDialog));
    dom.closeSettingsBtn.addEventListener('click', () => closeDialog(dom.settingsDialog));
    dom.settingsDialog.addEventListener('click', (event) => {
      if (event.target === dom.settingsDialog) closeDialog(dom.settingsDialog);
    });
    dom.saveDefaultBowlerBtn.addEventListener('click', async () => {
      if (activeLocalScope.kind === 'user') {
        setStatus(dom.settingsStatus, 'Change your name in Profile → Account & sync → Display name.', 'error');
        return;
      }
      const name = dom.defaultBowlerInput.value.trim() || 'Bowler';
      await setProfileName(name);
      await setSetting('defaultBowler', name);
      setStatus(dom.settingsStatus, 'Local profile saved.', 'success');
    });
    dom.exportJsonBtn.addEventListener('click', exportBackup);
    dom.exportCsvBtn.addEventListener('click', exportCsv);
    dom.importJsonBtn.addEventListener('click', () => dom.importJsonInput.click());
    dom.importJsonInput.addEventListener('change', () => {
      const file = dom.importJsonInput.files?.[0];
      if (file) importBackupFile(file);
    });
    dom.clearAllBtn.addEventListener('click', clearAllHistory);

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      dom.installBtn.classList.remove('hidden');
    });
    dom.installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      dom.installBtn.classList.add('hidden');
    });
    window.addEventListener('online', () => { dom.offlineStatus.textContent = offlineCacheReady ? 'Online · ready for offline use' : 'Online · offline setup pending'; });
    window.addEventListener('offline', () => { dom.offlineStatus.textContent = 'Offline · saved games available'; });
  }

  const ballService = Inventory.createNamedInventory({
    setting: 'ballInventory', label: 'ball', getDatabase: () => db,
    getUid: () => activeLocalScope.uid, seeds: ballNames, ready: () => api.ready,
    onChange: () => { renderBallOptions(); window.dispatchEvent(new CustomEvent('bowling:inventory-changed')); },
    onEdit: () => emitDataChanged({type: 'inventory'})
  });

  const alleyService = Inventory.createNamedInventory({
    setting: 'alleyInventory', label: 'alley', getDatabase: () => db,
    getUid: () => activeLocalScope.uid, seeds: alleyNames, ready: () => api.ready,
    onChange: () => { renderAlleyOptions(); window.dispatchEvent(new CustomEvent('bowling:alley-inventory-changed')); },
    onEdit: () => emitDataChanged({type: 'inventory'})
  });

  const api = {
    canApplyUpdate: () => api.ready && !mutationBusy && !restoringDraft && !editingGameId && !hasEntryDraft()
      && !undoDeletion && !selectedPhotoUrl && !document.querySelector('dialog[open]')
      && !runtime.cloud?.isBusy?.(),
    version: BACKUP_SCHEMA_VERSION,
    ready: false,
    startupError: null,
    showView,
    getGames: () => clone(games),
    getScoreCardData,
    getTombstones: async () => clone(await getAllTombstones()),
    getBowlerNames: () => [activeProfileName || 'Bowler'],
    getDefaultBowler: async () => activeProfileName || await getSetting('profileName') || await getSetting('defaultBowler') || 'Bowler',
    getProfileName: () => activeProfileName || 'Bowler',
    setProfileName,
    getAlleyInventory,
    editAlleyInventory,
    mergeAlleyInventory,
    getBallInventory,
    editBallInventory,
    mergeBallInventory,
    setSyncStatus,
    getLeaderboardSummary: (bowlerName) => clone(leaderboardSummaryForBowler(bowlerName)),
    getLocalScopeInfo,
    getSyncBaseline: async uid => activeLocalScope.uid === uid ? getSettingFromDb(db, 'syncBaseline') : null,
    saveSyncBaseline: async (snapshot, uid) => {
      if (activeLocalScope.uid !== uid) return false;
      const target = db;
      await setSettingOnDb(target, 'syncBaseline', snapshot);
      return db === target && activeLocalScope.uid === uid;
    },
    getAccountLocalGameCount,
    activateAccount: (...args) => changeLocalScope(() => activateAccount(...args)),
    activateGuest: (...args) => changeLocalScope(() => activateGuest(...args)),
    copyAccountDataToGuest: (...args) => changeLocalScope(() => copyAccountDataToGuest(...args)),
    applyRemoteChanges,
    renderAll,
    formatDate: fmtDate
  };


  async function init() {
    api.ready = false;
    api.startupError = null;
    dom.date.value = todayLocal();
    entrySessionId = newSessionId();
    dom.sessionName.value = entrySessionId;
    dom.sessionType.value = 'League';
    setEntryMode(false);
    wireEvents();
    rememberEntry();

    if (!('indexedDB' in window)) {
      api.startupError = 'This browser does not provide IndexedDB.';
      setStatus(dom.entryStatus, 'This browser does not provide IndexedDB, so persistent storage is unavailable.', 'error');
      dom.saveGameBtn.disabled = true;
      window.dispatchEvent(new CustomEvent('bowling:ready', { detail: { ok: false } }));
      return;
    }

    try {
      db = await openInitialDatabase();
      games = await getAllGames();
      await loadProfileName();
      await loadBallInventory();
      await loadAlleyInventory();
      renderAll();
      showDraftNotice();
      api.ready = true;
      Navigation.restoreScroll();
      window.dispatchEvent(new CustomEvent('bowling:ready', { detail: { ok: true } }));
    } catch (error) {
      console.error(error);
      api.startupError = error?.message || 'App startup failed.';
      dom.saveGameBtn.disabled = true;
      $('saveSeriesBtn').disabled = true;
      setSyncStatus('Startup failed · sync unavailable', 'error');
      setStatus(dom.entryStatus, `Could not start the app: ${api.startupError}. Reopen the app to retry.`, 'error');
      window.dispatchEvent(new CustomEvent('bowling:ready', { detail: { ok: false } }));
    }

    registerServiceWorker();
  }

  return Object.assign(api, {init});
})();
