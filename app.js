(() => {
  'use strict';

  const LEGACY_DB_NAME = 'bowling-tracker-db';
  const GUEST_DB_NAME = 'bowling-tracker-db-guest';
  const USER_DB_PREFIX = 'bowling-tracker-db-user-';
  const LAST_ACCOUNT_STORAGE_KEY = 'bowling-tracker-last-account-uid';
  const LEGACY_CLAIM_KEY = 'accountIsolationClaimedBy';
  const DB_VERSION = 2;
  const GAME_STORE = 'games';
  const SETTINGS_STORE = 'settings';
  const TOMBSTONE_STORE = 'tombstones';
  const APP_VERSION = 7;
  const Balls = window.BowlingBalls;
  const SESSION_TYPES = ['League', 'Practice', 'Tournament'];
  let restoringDraft = false;
  let entryBaseGame = null;
  let pendingImport = null;

  let activeView = 'home';
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
  let activeLocalScope = { kind: 'guest', uid: '', dbName: GUEST_DB_NAME };
  let games = [];
  let editingGameId = null;
  let deferredInstallPrompt = null;
  let offlineCacheReady = false;
  let selectedPhotoUrl = null;
  let activeProfileName = 'Bowler';

  const $ = (id) => document.getElementById(id);

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
    noTap: $('noTapInput'),
    sessionSelect: $('sessionSelect'),
    score: $('scoreInput'),
    openFrames: $('openFramesInput'),
    strikes: $('strikesInput'),
    strikeOpp: $('strikeOppInput'),
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

  function avg(values) {
    return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
  }

  function sessionLabel(game) {
    return sessionType(game);
  }

  function sessionKey(game) {
    return `${game.date}|||${String(game.sessionName || '').trim().toLowerCase() || 'bowling session'}`;
  }

  function sessionType(game) { return SESSION_TYPES.includes(game?.sessionType) ? game.sessionType : 'League'; }
  function isNoTap(game) { return game?.noTap === true; }
  function standardGames(source = games) { return source.filter(game => !isNoTap(game)); }
  function scoringLabel(game) { return isNoTap(game) ? 'No-tap' : 'Standard'; }
  function cleanBall(value) { return String(value || '').trim().replace(/\s+/g,' '); }
  function ballKey(value) { return cleanBall(value).toLowerCase(); }
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
    $('ballOptions').innerHTML = names.map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
    $('statsBall').innerHTML = '<option value="">All balls</option><option value="none">No ball recorded</option>' + names.map(name => `<option value="ball:${escapeHtml(ballKey(name))}">${escapeHtml(name)}</option>`).join('');
    $('statsBall').value = selected === 'none' || names.some(name => 'ball:'+ballKey(name) === selected) ? selected : '';
  }
  function applySeriesBall() {
    const value = cleanBall($('seriesBall').value);
    const inputs = [...$('seriesRows').children].map(row => row.querySelector('[data-field="ball"]'));
    if (inputs.some(input => {
      const rows = Balls.fromDraft(Balls.draft(input));
      return rows.length > 1 || rows.some(row => row.frames !== null || ballKey(row.name) !== ballKey(value));
    }) && !window.confirm('Replace all ball selections and frame counts for every game in this series?')) return;
    inputs.forEach(input => Balls.set(input, value ? [{name: value}] : [])); persistDrafts();
  }

  function newSessionId() { return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function gameOrder(a, b) { return Number(a.gameOrder ?? a.createdAt ?? a.id) - Number(b.gameOrder ?? b.createdAt ?? b.id) || a.id - b.id; }
  function latestSessionOrder(a, b) { return b.date.localeCompare(a.date) || Math.max(...b.games.map(g => g.createdAt || g.id)) - Math.max(...a.games.map(g => g.createdAt || g.id)); }
  function nextGameOrder(name, date) { return Math.max(0, ...games.filter(g => sessionKey(g) === sessionKey({sessionName:name,date})).map(g => Number(g.gameOrder ?? g.createdAt ?? g.id))) + 1; }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function emitDataChanged(detail = { type: 'bulk' }) {
    setSyncStatus('Saved on this device' + (window.BowlingCloud?.isSignedIn?.() ? ' · awaiting sync' : ' · local only'), 'working');
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

  function openDatabase(dbName) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(GAME_STORE)) {
          const store = database.createObjectStore(GAME_STORE, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('bowler', 'bowler', { unique: false });
        }
        if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
          database.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(TOMBSTONE_STORE)) {
          database.createObjectStore(TOMBSTONE_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function idbRequestOn(database, storeName, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = action(store);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbRequest(storeName, mode, action) {
    return idbRequestOn(db, storeName, mode, action);
  }

  async function getAllGames() {
    return idbRequest(GAME_STORE, 'readonly', (store) => store.getAll());
  }

  async function putGame(game) {
    return idbRequest(GAME_STORE, 'readwrite', (store) => store.put(game));
  }

  async function deleteGameRecord(id) {
    return idbRequest(GAME_STORE, 'readwrite', (store) => store.delete(id));
  }

  async function clearGames() {
    return idbRequest(GAME_STORE, 'readwrite', (store) => store.clear());
  }

  async function getAllTombstones() {
    return idbRequest(TOMBSTONE_STORE, 'readonly', (store) => store.getAll());
  }

  async function getTombstone(id) {
    return idbRequest(TOMBSTONE_STORE, 'readonly', (store) => store.get(id));
  }

  async function putTombstone(tombstone) {
    return idbRequest(TOMBSTONE_STORE, 'readwrite', (store) => store.put(tombstone));
  }

  async function deleteTombstone(id) {
    return idbRequest(TOMBSTONE_STORE, 'readwrite', (store) => store.delete(id));
  }

  async function getSetting(key) {
    const result = await idbRequest(SETTINGS_STORE, 'readonly', (store) => store.get(key));
    return result ? result.value : null;
  }

  async function setSetting(key, value) {
    return idbRequest(SETTINGS_STORE, 'readwrite', (store) => store.put({ key, value }));
  }

  async function getAllFromDb(database, storeName) {
    return idbRequestOn(database, storeName, 'readonly', (store) => store.getAll());
  }

  async function getSettingFromDb(database, key) {
    const result = await idbRequestOn(database, SETTINGS_STORE, 'readonly', (store) => store.get(key));
    return result ? result.value : null;
  }

  async function setSettingOnDb(database, key, value) {
    return idbRequestOn(database, SETTINGS_STORE, 'readwrite', (store) => store.put({ key, value }));
  }

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
      if (gameAt >= existingGameAt && gameAt > deleteAt) {
        await idbRequestOn(targetDb, GAME_STORE, 'readwrite', (store) => store.put(sourceGame));
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
  }

  async function refreshFromActiveDatabase() {
    clearUndo();
    expandedSessions.clear();
    historyLimit = 10;
    for (const id of ['sessionSearch', 'sessionFrom', 'sessionTo']) $(id).value = '';
    $('historyScoring').value = '';
    $('seriesDialog').close();
    $('editSessionDialog').close();
    games = await getAllGames();
    editingGameId = null;
    await loadProfileName(true);
    restoringDraft = true;
    resetEntryForm({ preserveDate: false, preserveSession: false });
    restoringDraft = false;
    pendingImport = null; $('importPreviewDialog').close();
    for (const id of ['statsFrom','statsTo','statsType','statsBall']) $(id).value = '';
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

  function buildSessions(sourceGames) {
    const map = new Map();
    for (const game of sourceGames) {
      const key = sessionKey(game);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(game);
    }
    return [...map.entries()].map(([key, sessionGames]) => {
      sessionGames.sort(gameOrder);
      const total = sessionGames.reduce((sum, g) => sum + g.score, 0);
      const openFrames = sessionGames.reduce((sum, g) => sum + g.openFrames, 0);
      const strikes = sessionGames.reduce((sum, g) => sum + g.strikes, 0);
      const strikeOpps = sessionGames.reduce((sum, g) => sum + g.strikeOpportunities, 0);
      return {
        key,
        games: sessionGames,
        bowler: sessionGames[0].bowler,
        date: sessionGames[0].date,
        name: sessionLabel(sessionGames[0]),
        total,
        average: total / sessionGames.length,
        openFrames,
        strikes,
        strikePct: strikeOpps ? (strikes / strikeOpps) * 100 : 0,
        highGame: Math.max(...sessionGames.map((g) => g.score))
      };
    });
  }

  function bestThreeGameSeries(sessions) {
    let best = null;
    const fullSessions = new Map(buildSessions(games).map(session => [session.key,session]));
    for (const session of sessions) {
      if (session.games.length < 3) continue;
      const fullSession = fullSessions.get(session.key);
      const fullPositions = new Map(fullSession?.games.map((game,index) => [game.id,index]) || []);
      for (let i = 0; i <= session.games.length - 3; i += 1) {
        const slice = session.games.slice(i, i + 3);
        const positions = slice.map(g => fullPositions.get(g.id) ?? -1);
        if (positions.every(index => index >= 0) && (positions[1] !== positions[0]+1 || positions[2] !== positions[1]+1)) continue;
        const total = slice.reduce((sum, g) => sum + g.score, 0);
        if (!best || total > best.total) {
          best = { total, session, startIndex: i };
        }
      }
    }
    return best;
  }

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
    return standardGames().filter(g => (!from || g.date >= from) && (!through || g.date <= through) && (!type || sessionType(g) === type) && matchesBall(g));
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
    return {previousFrom,previousTo,current:calculateStats(statsGames()),previous:calculateStats(games.filter(g => g.date >= previousFrom && g.date <= previousTo && (!type || sessionType(g) === type) && matchesBall(g)))};
  }
  function renderComparison() {
    const comparison = periodComparison();
    const from = $('statsFrom').value, through = $('statsTo').value;
    const range = from || through ? `${from ? fmtDate(from) : 'First game'} – ${through ? fmtDate(through) : 'Latest game'}` : 'All time';
    const selectedBall = $('statsBall').value;
    $('statsBallNote').hidden = !selectedBall.startsWith('ball:');
    const ball = selectedBall === 'none' ? 'No ball recorded' : ballNames().find(name => 'ball:' + ballKey(name) === selectedBall) || 'All balls';
    $('statsRangeStatus').textContent = from && through && from > through ? 'Start date must be on or before end date.' : `${statsGames().length} games · ${range} · ${$('statsType').value || 'All types'} · ${ball}`;
    document.querySelectorAll('[data-stats-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.statsPreset === statsPreset)));
    $('statsPeriodPanel').hidden = !comparison;
    if (!comparison) { $('periodComparison').textContent = ''; return; }
    const {current,previous,previousFrom,previousTo} = comparison;
    const value = (s,key) => s.count ? s[key].toFixed(1) : '—';
    $('periodComparison').innerHTML = `<p>Previous period: ${escapeHtml(fmtDate(previousFrom))} – ${escapeHtml(fmtDate(previousTo))}</p><div class="trend-table-wrap"><table class="trend-table"><thead><tr><th>Metric</th><th>Selected</th><th>Previous</th><th>Change</th></tr></thead><tbody>${[['Average','average'],['Strike %','strikePct'],['Open frames / game','openAvg']].map(([label,key]) => `<tr><th>${label}</th><td>${value(current,key)}</td><td>${value(previous,key)}</td><td>${current.count && previous.count ? (current[key]-previous[key] >= 0 ? '+' : '')+(current[key]-previous[key]).toFixed(1) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function updateSessionSuggestions() {
    const sessions = buildSessions(games).sort(latestSessionOrder);
    dom.sessionSelect.innerHTML = '<option value="">Choose an existing session…</option>' + sessions.map((session, i) =>
      `<option value="${escapeHtml(session.key)}">${escapeHtml(fmtDate(session.date))} · ${escapeHtml(session.name)} · Session ${sessions.length-i} · ${session.games.length} games</option>`
    ).join('');
    const key = sessionKey({date:dom.date.value,sessionName:dom.sessionName.value});
    const current = sessions.find(s => s.key === key);
    dom.sessionSelect.value = current ? key : '';
    $('sessionMode').value = current ? 'existing' : 'new';
    $('existingSessionField').hidden = !current;
    updateEntryContext();
  }

  function selectEntrySession() {
    const session = buildSessions(games).find(s => s.key === dom.sessionSelect.value);
    if (session) {
      dom.date.value = session.date;
      dom.sessionName.value = session.games[0].sessionName || '';
      dom.sessionType.value = sessionType(session.games[0]);
      dom.noTap.value = isNoTap(session.games.at(-1)) ? 'no-tap' : 'standard';
      $('gameAdvanced').open = dom.noTap.value === 'no-tap' || !!dom.ball.value;
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
      dom.sessionName.value = newSessionId();
      dom.sessionSelect.value = '';
      dom.date.value = todayLocal();
      dom.sessionType.value = 'League';
      dom.noTap.value = 'standard';
    }
    updateEntryContext(); persistDrafts();
  }

  function calculateStats(sourceGames) {
    sourceGames = standardGames(sourceGames);
    const count = sourceGames.length;
    const sessions = buildSessions(sourceGames);
    const scores = sourceGames.map((g) => g.score);
    const totalStrikes = sourceGames.reduce((sum, g) => sum + g.strikes, 0);
    const strikeOpps = sourceGames.reduce((sum, g) => sum + g.strikeOpportunities, 0);
    const totalOpen = sourceGames.reduce((sum, g) => sum + g.openFrames, 0);
    // Tenth-frame fill shots do not add frames to a ten-frame game.
    const totalFrames = count * 10;
    const totalClosed = totalFrames - totalOpen;
    const cleanGames = sourceGames.filter((g) => g.openFrames === 0).length;
    const sortedRecent = [...sourceGames].sort((a, b) => b.date.localeCompare(a.date) || gameOrder(b, a));
    const bestSession = sessions.length ? sessions.reduce((best, s) => s.average > best.average ? s : best) : null;
    const bestSeries = bestThreeGameSeries(sessions);
    const highGameObj = sourceGames.length ? sourceGames.reduce((best, g) => g.score > best.score ? g : best) : null;
    const mostStrikesGame = sourceGames.length ? sourceGames.reduce((best, g) => {
      if (g.strikes > best.strikes) return g;
      if (g.strikes === best.strikes && Number(g.createdAt || 0) > Number(best.createdAt || 0)) return g;
      return best;
    }) : null;
    const bestStrikePctGame = sourceGames.length ? sourceGames.reduce((best, g) => {
      const pct = g.strikeOpportunities ? g.strikes / g.strikeOpportunities : 0;
      const bestPct = best.strikeOpportunities ? best.strikes / best.strikeOpportunities : 0;
      if (pct > bestPct) return g;
      if (pct === bestPct && g.strikes > best.strikes) return g;
      if (pct === bestPct && g.strikes === best.strikes && Number(g.createdAt || 0) > Number(best.createdAt || 0)) return g;
      return best;
    }) : null;
    const recent200 = [...sourceGames].filter((g) => g.score >= 200).sort((a, b) => {
      const dateCmp = String(b.date).localeCompare(String(a.date));
      return dateCmp || Number(b.createdAt || 0) - Number(a.createdAt || 0);
    })[0] || null;

    return {
      count,
      sessions,
      average: count ? avg(scores) : 0,
      highGameObj,
      bestSeries,
      totalStrikes,
      strikePct: strikeOpps ? (totalStrikes / strikeOpps) * 100 : 0,
      openAvg: count ? totalOpen / count : 0,
      openRate: count ? (totalOpen / (count * 10)) * 100 : 0,
      totalFrames,
      totalClosed,
      closedFramePct: totalFrames ? (totalClosed / totalFrames) * 100 : 0,
      cleanGames,
      cleanRate: count ? (cleanGames / count) * 100 : 0,
      strikesPerGame: count ? totalStrikes / count : 0,
      games200: sourceGames.filter((g) => g.score >= 200).length,
      games250: sourceGames.filter((g) => g.score >= 250).length,
      games300: sourceGames.filter((g) => g.score === 300).length,
      last5: sortedRecent.length ? avg(sortedRecent.slice(0, 5).map((g) => g.score)) : 0,
      bestSession,
      mostStrikesGame,
      bestStrikePctGame,
      recent200
    };
  }

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
      cleanGames: stats.cleanGames,
      totalStrikes: stats.totalStrikes,
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

  function renderStats() {
    const stats = calculateStats(statsGames());
    dom.average.textContent = stats.count ? stats.average.toFixed(1) : '—';
    dom.averageDetail.textContent = `${stats.count} game${stats.count === 1 ? '' : 's'}`;

    dom.highGame.textContent = stats.highGameObj ? stats.highGameObj.score : '—';
    dom.highGameDetail.textContent = stats.highGameObj
      ? fmtDate(stats.highGameObj.date)
      : 'No games yet';

    dom.highSeries.textContent = stats.bestSeries ? stats.bestSeries.total : '—';
    dom.highSeriesDetail.textContent = stats.bestSeries
      ? `${fmtDate(stats.bestSeries.session.date)} · ${stats.bestSeries.session.name}`
      : 'Need 3 games in one session';

    dom.strikePct.textContent = stats.count ? `${stats.strikePct.toFixed(1)}%` : '—';
    dom.strikePctDetail.textContent = `${stats.totalStrikes} strike${stats.totalStrikes === 1 ? '' : 's'}`;

    dom.openAvg.textContent = stats.count ? stats.openAvg.toFixed(2) : '—';
    dom.openRateDetail.textContent = `${stats.openRate.toFixed(1)}% open-frame rate`;

    dom.closedFramePct.textContent = stats.count ? `${stats.closedFramePct.toFixed(1)}%` : '—';
    dom.closedFrameDetail.textContent = stats.count
      ? `${stats.totalClosed} / ${stats.totalFrames} frames closed`
      : 'No standard games in these filters';

    dom.cleanGames.textContent = stats.cleanGames;
    dom.cleanGamesDetail.textContent = `${stats.cleanRate.toFixed(1)}% of games`;

    dom.sessions.textContent = stats.sessions.length;
    dom.gamesAndMilestones.textContent = `${stats.count} games in the selected filters`;

    dom.more200.textContent = stats.games200;
    dom.more250.textContent = stats.games250;
    dom.more300.textContent = stats.games300;
    dom.moreStrikeAvg.textContent = stats.count ? stats.strikesPerGame.toFixed(2) : '—';
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
    if (!sessions.length) { dom.sessionsList.innerHTML = ''; return; }
    dom.sessionsList.innerHTML = sessions.map((session, index) => {
      const fullSession = fullSessions.get(session.key) || session;
      const positions = new Map(fullSession.games.map((game, position) => [game.id, position]));
      const summary = historySummary(session);
      return `
        <details class="session-card" data-session-key="${escapeHtml(session.key)}" ${expandedSessions.has(session.key) ? (expandedSessions.get(session.key) ? 'open' : '') : (index === 0 ? 'open' : '')}>
          <summary class="session-header">
            <div>
              <div class="session-title">${escapeHtml(fmtDate(session.date))}</div>
              <div class="session-meta">${escapeHtml(session.name)} · ${session.games.length} game${session.games.length === 1 ? '' : 's'}</div>
            </div>
            <div class="session-badges">
              <span class="badge">${summary.prefix}Avg ${summary.average.toFixed(1)}</span>
              <span class="badge">${summary.prefix}Total ${summary.total}</span>
              ${summary.noTapCount ? `<span class="badge no-tap-badge">${summary.noTapCount} no-tap</span>` : ''}
            </div>
          </summary>
          <div class="session-actions">
            <button class="btn secondary compact add-to-session" data-key="${escapeHtml(session.key)}" type="button">＋ Add game</button>
            <button class="text-btn edit-session" data-key="${escapeHtml(session.key)}" type="button">Edit session</button>
          </div>
          <div class="games-grid">
            ${session.games.map(g => `
              <article class="game-row">
                <div class="game-row-summary">
                  <div class="game-score-block"><span class="game-number">Game ${positions.get(g.id) + 1}</span><strong class="game-score">${g.score}</strong></div>
                  <div class="game-row-info">
                    <p class="game-ball">${escapeHtml(Balls.summary(g))}</p>
                    ${isNoTap(g) ? '<span class="badge no-tap-badge">No-tap</span>' : ''}
                    <p class="game-stats">${g.strikes} strikes · ${g.openFrames === 0 ? '✓ Clean game' : g.openFrames + ' open frames'}</p>
                  </div>
                  <button id="gameActionsToggle-${g.id}" class="text-btn game-actions-toggle" data-id="${g.id}" type="button" aria-expanded="false" aria-controls="gameActions-${g.id}" aria-label="Actions for game ${positions.get(g.id) + 1}">Actions</button>
                </div>
                ${g.notes ? `<p class="game-notes">${escapeHtml(g.notes)}</p>` : ''}
                <div id="gameActions-${g.id}" class="game-detail-panel" hidden>
                  <p class="game-stats">${g.strikes} / ${g.strikeOpportunities} strike opportunities · ${g.strikeOpportunities ? ((g.strikes / g.strikeOpportunities) * 100).toFixed(1) : '0.0'}% strike rate</p>
                  <div class="game-actions" role="group" aria-label="Game ${positions.get(g.id) + 1} actions">
                      <button class="text-btn edit-game" data-id="${g.id}" type="button">Edit game</button>
                      <button class="text-btn move-game" data-id="${g.id}" data-direction="-1" type="button" ${positions.get(g.id) === 0 ? 'disabled' : ''} aria-label="Move game ${positions.get(g.id)+1} earlier">↑ Earlier</button>
                      <button class="text-btn move-game" data-id="${g.id}" data-direction="1" type="button" ${positions.get(g.id) === fullSession.games.length-1 ? 'disabled' : ''} aria-label="Move game ${positions.get(g.id)+1} later">↓ Later</button>
                      <button class="text-btn danger-text delete-game" data-id="${g.id}" type="button">Delete</button>
                  </div>
                </div>
              </article>
            `).join('')}
          </div>
        </details>
      `;
    }).join('');

    dom.sessionsList.querySelectorAll('details[data-session-key]').forEach((detail) => detail.addEventListener('toggle', () => expandedSessions.set(detail.dataset.sessionKey, detail.open)));
    dom.sessionsList.querySelectorAll('.add-to-session').forEach((button) => button.addEventListener('click', () => addToSession(button.dataset.key)));
    dom.sessionsList.querySelectorAll('.edit-session').forEach((button) => button.addEventListener('click', () => openSessionEditor(button.dataset.key)));
    dom.sessionsList.querySelectorAll('.game-actions-toggle').forEach(button => button.addEventListener('click', () => {
      const panel = $('gameActions-' + button.dataset.id);
      setGameActions(Number(button.dataset.id), panel.hidden);
    }));
    dom.sessionsList.querySelectorAll('.move-game').forEach(button => button.addEventListener('click', () => moveGame(Number(button.dataset.id), Number(button.dataset.direction))));
    dom.sessionsList.querySelectorAll('.edit-game').forEach((button) => {
      button.addEventListener('click', () => startEdit(Number(button.dataset.id)));
    });
    dom.sessionsList.querySelectorAll('.delete-game').forEach((button) => {
      button.addEventListener('click', () => confirmDelete(Number(button.dataset.id)));
    });
  }

  function setGameActions(id, open) {
    dom.sessionsList.querySelectorAll('.game-actions-toggle').forEach(button => {
      const show = open && Number(button.dataset.id) === id;
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
    const score = Number(fields.score.value);
    const openFrames = Number(fields.openFrames.value);
    const strikes = Number(fields.strikes.value);
    const strikeOpportunities = Number(fields.strikeOpp.value);
    const notes = fields.notes.value.trim();
    const balls = Balls.fromDraft(Balls.draft(fields.ball), canonicalBall);
    const ballError = Balls.error(balls);
    if (ballError) return {error: ballError};
    const ball = balls[0]?.name || '';

    if (!date || fields.score.value === '' || fields.openFrames.value === '' || fields.strikes.value === '' || fields.strikeOpp.value === '') {
      return { error: 'Please fill in date, score, open frames, strikes, and strike opportunities.' };
    }
    if (!isValidDate(date)) return { error: 'Please enter a valid bowling date.' };
    if (!Number.isInteger(score) || score < 0 || score > 300) return { error: 'Score must be a whole number from 0 to 300.' };
    if (!Number.isInteger(openFrames) || openFrames < 0 || openFrames > 10) return { error: 'Open frames must be a whole number from 0 to 10.' };
    if (!Number.isInteger(strikes) || strikes < 0 || strikes > 12) return { error: 'Strikes must be a whole number from 0 to 12.' };
    if (!Number.isInteger(strikeOpportunities) || strikeOpportunities < 10 || strikeOpportunities > 12) return { error: 'Strike opportunities must be a whole number from 10 to 12.' };
    if (strikes > strikeOpportunities) return { error: 'Strikes cannot exceed strike opportunities.' };
    if (score === 300 && strikes !== 12) return { error: 'A 300 game should be recorded as 12 strikes.' };

    return {
      value: { bowler, date, sessionName, sessionType: type, ball, balls, noTap: fields.noTap?.value === 'no-tap', score, openFrames, strikes, strikeOpportunities, notes }
    };
  }

  function possibleDuplicate(candidate) {
    const session = String(candidate.sessionName || '').trim().toLowerCase();
    return games.find((g) => Number(g.id) !== Number(editingGameId)
      && g.date === candidate.date
      && isNoTap(g) === isNoTap(candidate)
      && String(g.sessionName || '').trim().toLowerCase() === session
      && Number(g.score) === candidate.score
      && Number(g.openFrames) === candidate.openFrames
      && Number(g.strikes) === candidate.strikes
      && Number(g.strikeOpportunities || 10) === candidate.strikeOpportunities);
  }

  function unusualGameWarnings(candidate) {
    const warnings = [];
    if (candidate.strikes > 0 && candidate.score < 10) warnings.push('the score is under 10 but strikes are recorded');
    if (candidate.strikes === 12 && candidate.score !== 300) warnings.push('12 strikes are recorded but the score is not 300');
    if (candidate.openFrames === 0 && candidate.score < 100) warnings.push('the game is marked clean with a score under 100');
    return warnings;
  }

  function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function isValidGame(game) {
    const integerIn = (value, low, high) => value !== null && value !== undefined
      && String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= low && Number(value) <= high;
    if (!game || typeof game !== 'object'
      || !integerIn(game.id, 1, Number.MAX_SAFE_INTEGER)
      || typeof game.bowler !== 'string' || !game.bowler.trim()
      || !isValidDate(game.date)
      || !integerIn(game.score, 0, 300) || !integerIn(game.openFrames, 0, 10) || !integerIn(game.strikes, 0, 12)) return false;
    if (game.strikeOpportunities !== undefined && (!integerIn(game.strikeOpportunities, 10, 12)
      || Number(game.strikeOpportunities) < Number(game.strikes))) return false;
    if (Number(game.score) === 300 && Number(game.strikes) !== 12) return false;
    if (game.ball !== undefined && (typeof game.ball !== 'string' || cleanBall(game.ball).length > 100)) return false;
    if (game.balls !== undefined && Balls.error(game.balls)) return false;
    if (game.noTap !== undefined && typeof game.noTap !== 'boolean') return false;
    if (game.sessionType !== undefined && !SESSION_TYPES.includes(game.sessionType)) return false;
    if (game.gameOrder !== undefined && !integerIn(game.gameOrder, 0, Number.MAX_SAFE_INTEGER)) return false;
    return ['createdAt', 'updatedAt'].every((key) => game[key] === undefined || integerIn(game[key], 0, Number.MAX_SAFE_INTEGER));
  }

  function normalizeGame(game) {
    const strikes = Number(game.strikes);
    return {
      id: Number(game.id),
      bowler: String(game.bowler).trim(),
      date: String(game.date),
      sessionName: String(game.sessionName || ''),
      sessionType: sessionType(game),
      ball: Balls.list(game)[0]?.name || '',
      balls: Balls.list(game),
      noTap: isNoTap(game),
      ...(game.gameOrder !== undefined ? {gameOrder: Number(game.gameOrder)} : {}),
      score: Number(game.score),
      openFrames: Number(game.openFrames),
      strikes,
      strikeOpportunities: Math.min(12, Math.max(Number(game.strikeOpportunities || 10), strikes, 10)),
      notes: String(game.notes || ''),
      createdAt: Number(game.createdAt || Date.now()),
      updatedAt: Number(game.updatedAt || game.createdAt || Date.now())
    };
  }

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
    const warnings = unusualGameWarnings(validated.value);
    if (warnings.length && !window.confirm(`This game looks unusual because ${warnings.join(' and ')}. Save it anyway?`)) {
      setStatus(dom.entryStatus, 'Save cancelled so you can review the game details.');
      return;
    }

    const now = Date.now();
    const existing = editingGameId ? games.find((g) => g.id === editingGameId) : null;
    if (editingGameId && (!existing || JSON.stringify(existing) !== JSON.stringify(entryBaseGame))) {
      setStatus(dom.entryStatus, 'This game changed since you opened it. Your draft is kept; cancel and reopen the current game before saving.', 'error'); return;
    }
    const game = {
      id: editingGameId || (now * 1000 + Math.floor(Math.random() * 1000)),
      ...validated.value,
      gameOrder: existing ? (existing.gameOrder ?? existing.createdAt ?? existing.id) : nextGameOrder(validated.value.sessionName, validated.value.date),
      createdAt: existing?.createdAt || now,
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
      if (editingGameId) {
        setStatus(dom.entryStatus, 'Game updated.', 'success');
      } else {
        setStatus(dom.entryStatus, 'Game saved and added to this session.', 'success');
      }
      resetEntryForm({ preserveDate: true, preserveSession: true });
      renderAll();
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
    if (!preserveSession) dom.sessionType.value = 'League';
    dom.date.value = date;
    dom.sessionName.value = sessionName;
    dom.score.value = '';
    dom.openFrames.value = '';
    dom.strikes.value = '';
    dom.strikeOpp.value = '10';
    dom.notes.value = '';
    Balls.set(dom.ball, []);
    dom.noTap.value = preserveSession && dom.noTap.value === 'no-tap' ? 'no-tap' : 'standard';
    $('gameAdvanced').open = dom.noTap.value === 'no-tap';
    editingGameId = null;
    entryBaseGame = null;
    clearDraft('entry');
    dom.saveGameBtn.textContent = 'Save game';
    dom.cancelEditBtn.classList.add('hidden');
    dom.entryHeading.textContent = 'Add game';
    dom.entrySubheading.textContent = 'Enter the numbers directly or use a scoreboard photo as a reference.';
    clearPhoto();
    updateSessionSuggestions();
    rememberEntry();
    showDraftNotice();
  }

  function startEdit(id) {
    if (hasEntryDraft() && !window.confirm('Discard the unsaved entry and edit this game?')) return;
    showView('home', false);
    const game = games.find((g) => g.id === id);
    if (!game) return;
    clearDraft('entry');
    editingGameId = id;
    entryBaseGame = clone(game);
    dom.date.value = game.date;
    dom.sessionName.value = game.sessionName || '';
    dom.sessionType.value = sessionType(game);
    updateSessionSuggestions();
    dom.score.value = game.score;
    dom.openFrames.value = game.openFrames;
    dom.strikes.value = game.strikes;
    dom.strikeOpp.value = game.strikeOpportunities;
    dom.notes.value = game.notes || '';
    Balls.set(dom.ball, Balls.list(game));
    dom.noTap.value = isNoTap(game) ? 'no-tap' : 'standard';
    $('gameAdvanced').open = !!dom.ball.value || isNoTap(game);
    updateEntryContext();
    dom.saveGameBtn.textContent = 'Update game';
    dom.cancelEditBtn.classList.remove('hidden');
    dom.entryHeading.textContent = 'Edit game';
    dom.entrySubheading.textContent = 'Update the saved values, then tap Update game.';
    setEntryMode(false);
    setStatus(dom.entryStatus, 'Editing saved game.');
    rememberEntry();
    window.scrollTo({ top: document.querySelector('.entry-panel').offsetTop - 12, behavior: 'smooth' });
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

  function setEntryMode(photoMode) {
    dom.manualTab.classList.toggle('active', !photoMode);
    dom.manualTab.setAttribute('aria-pressed', String(!photoMode));
    dom.photoTab.setAttribute('aria-pressed', String(photoMode));
    dom.photoTab.classList.toggle('active', photoMode);
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
    const signedIn = Boolean(window.BowlingCloud?.isSignedIn?.());
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
    if (dom.globalSyncStatus) dom.globalSyncStatus.textContent = text || 'Local only';
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
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      profileName: activeProfileName,
      games: [...games].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
      tombstones
    };
    downloadFile(`bowling-backup-${todayLocal()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    setStatus(dom.settingsStatus, 'Backup exported.', 'success');
  }

  function csvEscape(value) {
    const raw = String(value ?? '');
    const text = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv() {
    const rows = [
      ['Date','Bowler','Session Type','Session ID','Game Order','Ball','Score','Open Frames','Strikes','Strike Opportunities','Strike %','Clean Game','Notes','Scoring','Ball Usage']
    ];
    buildSessions(games).sort((a,b) => a.date.localeCompare(b.date)).forEach(session => session.games.forEach((g,index) => {
      rows.push([
        g.date, g.bowler, sessionType(g), sessionKey(g), index+1, Balls.list(g)[0]?.name || '', g.score, g.openFrames, g.strikes, g.strikeOpportunities,
        g.strikeOpportunities ? ((g.strikes / g.strikeOpportunities) * 100).toFixed(1) : '0.0',
        g.openFrames === 0 ? 'Yes' : 'No', g.notes || '', scoringLabel(g), JSON.stringify(Balls.list(g))
      ]);
    }));
    const csv = '\uFEFF' + rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    downloadFile(`bowling-history-${todayLocal()}.csv`, csv, 'text/csv;charset=utf-8');
    setStatus(dom.settingsStatus, 'CSV exported.', 'success');
  }

  function importFingerprint(game) {
    if (!game) return '';
    if (game.deleted) return `deleted:${game.id}`;
    const normalized = normalizeGame(game); delete normalized.updatedAt; delete normalized.createdAt;
    return JSON.stringify(normalized);
  }
  function buildImportPlan(imported, deleted, current, tombstones) {
    const saved = new Map(current.map(g => [g.id,g])), removed = new Map(tombstones.map(t => [t.id,t]));
    const rows = [];
    for (const game of imported) {
      const local = saved.get(game.id), tombstone = removed.get(game.id);
      const kind = local ? (importFingerprint(local) === importFingerprint(game) ? 'duplicate' : 'conflict') : tombstone ? 'conflict' : 'addition';
      rows.push({kind,id:game.id,game,local,tombstone});
    }
    for (const deletion of deleted) {
      const local = saved.get(deletion.id);
      rows.push({kind:local ? 'conflict' : 'duplicate',id:deletion.id,deletion,local});
    }
    return rows;
  }
  async function importBackupFile(file) {
    const targetDb = db;
    try {
      const payload = JSON.parse(await file.text());
      if (!payload || !Array.isArray(payload.games)) throw new Error('Backup does not contain a games array.');
      if (payload.games.some(g => !isValidGame(g))) throw new Error('Invalid game data. Check dates, scores, ball names/frame counts, types and game order. No games were imported.');
      const imported = payload.games.map(normalizeGame), deleted = payload.tombstones || [];
      if (!Array.isArray(deleted) || deleted.some(t => !Number.isSafeInteger(t?.id) || t.id <= 0 || !Number.isSafeInteger(t.updatedAt) || t.updatedAt < 0)) throw new Error('Invalid deletion data.');
      const ids = [...imported,...deleted].map(g => g.id);
      if (new Set(ids).size !== ids.length) throw new Error('The backup repeats a game ID. Resolve repeated IDs before importing.');
      const tombstones = await getAllFromDb(targetDb,TOMBSTONE_STORE);
      const current = await getAllFromDb(targetDb,GAME_STORE);
      if (targetDb !== db) return;
      const rows = buildImportPlan(imported,deleted,current,tombstones);
      pendingImport = {database:targetDb,rows,snapshot:JSON.stringify([current,tombstones])};
      $('importPreviewSummary').textContent = `${rows.filter(r=>r.kind==='addition').length} additions · ${rows.filter(r=>r.kind==='duplicate').length} duplicates (skipped) · ${rows.filter(r=>r.kind==='conflict').length} conflicts`;
      $('importPreviewRows').innerHTML = rows.map(r => `<div class="import-row"><strong>${escapeHtml(r.game?.date || r.local?.date || '')} · ${r.game ? r.game.score+' points · '+scoringLabel(r.game) : 'Backup deletion'}</strong>${r.game ? `<p>Backup balls: ${escapeHtml(Balls.summary(r.game))}</p>` : ''}<p>${r.kind}${r.local ? ' · Current: '+r.local.score+' points · '+scoringLabel(r.local) : r.tombstone ? ' · Deleted on this device' : ''}</p>${r.local ? `<p>Current balls: ${escapeHtml(Balls.summary(r.local))}</p>` : ''}${r.kind==='conflict' ? `<label>Resolution<select data-import-id="${r.id}"><option value="keep">Keep current data</option><option value="backup">${r.deletion ? 'Apply backup deletion' : 'Use backup game'}</option></select></label>` : ''}</div>`).join('');
      setStatus($('importPreviewStatus'),''); $('importPreviewDialog').showModal();
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
      const choices = new Map([...$('importPreviewRows').querySelectorAll('[data-import-id]')].map(el => [Number(el.dataset.importId),el.value]));
      const selected = plan.rows.filter(r => r.kind==='addition' || (r.kind==='conflict' && choices.get(r.id)==='backup'));
      const now = Date.now();
      const upserts = selected.filter(r=>r.game).map(r=>({...r.game,updatedAt:Math.max(now,r.game.updatedAt+1,Number(r.local?.updatedAt||r.tombstone?.updatedAt||0)+1)}));
      const deletes = selected.filter(r=>r.deletion).map(r=>({...r.deletion,updatedAt:Math.max(now,r.deletion.updatedAt+1,Number(r.local?.updatedAt||0)+1)}));
      await commitGames(upserts,deletes,plan.database);
      if (db !== plan.database) return;
      games = await getAllGames(); pendingImport = null; $('importPreviewDialog').close(); renderAll();
      if (selected.length) emitDataChanged({type:'bulk'});
      setStatus(dom.settingsStatus,`Imported ${upserts.length} games and applied ${deletes.length} reviewed deletions.`,'success');
    } catch (error) { setStatus($('importPreviewStatus'),error.message,'error'); }
    finally { mutationBusy = false; $('confirmImportBtn').disabled = false; }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      dom.offlineStatus.textContent = 'Offline install not supported in this browser';
      return;
    }
    try {
      await navigator.serviceWorker.register('./service-worker.js');
      await navigator.serviceWorker.ready;
      offlineCacheReady = true;
      dom.offlineStatus.textContent = navigator.onLine ? 'Online · offline cache ready' : 'Offline · local data available';
    } catch (error) {
      console.error(error);
      dom.offlineStatus.textContent = 'Offline cache unavailable on this URL';
    }
  }

  async function applyRemoteChanges({ upserts = [], deletes = [], expectedUid } = {}) {
    if (expectedUid !== undefined && activeLocalScope.uid !== expectedUid) return;
    const targetDb = db;
    const validUpserts = upserts.filter(isValidGame).map(normalizeGame);
    const validDeletes = deletes.map((deletion) => ({ id: Number(deletion.id), updatedAt: Number(deletion.updatedAt || Date.now()) }))
      .filter((deletion) => Number.isSafeInteger(deletion.id) && deletion.id > 0 && Number.isFinite(deletion.updatedAt));
    await commitGames(validUpserts, validDeletes, targetDb);
    if (db !== targetDb) return;
    const refreshed = await getAllFromDb(targetDb, GAME_STORE);
    if (db !== targetDb) return;
    games = refreshed;
    renderAll();
  }

  // One transaction ensures a series or session edit is saved completely or not at all.
  function commitGames(upserts = [], deletions = [], database = db) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction([GAME_STORE, TOMBSTONE_STORE], 'readwrite');
      const saved = tx.objectStore(GAME_STORE);
      const removed = tx.objectStore(TOMBSTONE_STORE);
      for (const game of upserts) { saved.put(game); removed.delete(game.id); }
      for (const tombstone of deletions) { removed.put(tombstone); saved.delete(tombstone.id); }
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Save cancelled'));
      tx.onerror = () => reject(tx.error);
    });
  }

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
    dom.date.value = session.date;
    dom.sessionName.value = session.games[0].sessionName || '';
    dom.sessionType.value = sessionType(session.games[0]);
    dom.noTap.value = isNoTap(session.games.at(-1)) ? 'no-tap' : 'standard';
    $('gameAdvanced').open = dom.noTap.value === 'no-tap';
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
    row.innerHTML = `<legend>Game</legend><div class="form-grid">
      <label>Score<input data-field="score" type="number" min="0" max="300" step="1" inputmode="numeric" required></label>
      <label>Open frames<input data-field="openFrames" type="number" min="0" max="10" step="1" inputmode="numeric" required></label>
      <label>Strikes<input data-field="strikes" type="number" min="0" max="12" step="1" inputmode="numeric" required></label>
      <label>Strike opportunities<input data-field="strikeOpp" type="number" min="10" max="12" step="1" inputmode="numeric" value="10" required></label>
      <label class="series-notes">Notes <small>optional</small><input data-field="notes" type="text"></label>
    </div><details class="advanced-options" data-ball-advanced><summary>Advanced</summary><div class="ball-editor" data-ball-editor><div class="ball-usage-row" data-ball-first><label class="ball-name-field">Ball <small>optional</small><input data-field="ball" type="text" list="ballOptions" maxlength="100" placeholder="Choose or type a ball"></label></div></div></details><button class="text-btn danger-text remove-series-row" type="button">Remove game</button>`;
    row.querySelector('.remove-series-row').addEventListener('click', () => {
      if ($('seriesRows').children.length > 1) { row.remove(); numberSeriesRows(); updateSeriesPreview(); persistDrafts(); }
    });
    row.querySelector('[data-field="score"]').addEventListener('input', (event) => {
      if (event.target.value === '300') {
        for (const [field, value] of [['openFrames', 0], ['strikes', 12], ['strikeOpp', 12]]) row.querySelector(`[data-field="${field}"]`).value = value;
      }
    });
    row.querySelector('[data-field="strikes"]').addEventListener('input', (event) => {
      const opp = row.querySelector('[data-field="strikeOpp"]');
      if (+event.target.value > +opp.value) opp.value = Math.min(12, +event.target.value);
    });
    row.querySelector('[data-field="ball"]').value = $('seriesBall').value;
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
    $('seriesDate').value = dom.date.value || todayLocal();
    $('seriesName').value = dom.sessionName.value;
    $('seriesType').value = dom.sessionType.value;
    $('seriesBall').value = dom.ball.value;
    $('seriesNoTap').value = dom.noTap.value === 'no-tap' ? 'no-tap' : 'standard';
    $('seriesAdvanced').open = !!dom.ball.value || $('seriesNoTap').value === 'no-tap';
    $('seriesRows').innerHTML = '';
    const first = addSeriesRow();
    for (const field of ['score', 'openFrames', 'strikes', 'strikeOpp', 'notes', 'ball']) first.querySelector(`[data-field="${field}"]`).value = dom[field].value;
    Balls.set(first.querySelector('[data-field="ball"]'), Balls.draft(dom.ball));
    first.querySelector('[data-ball-advanced]').open = Balls.fromDraft(Balls.draft(dom.ball)).length > 0;
    addSeriesRow(); addSeriesRow();
    setStatus($('seriesStatus'), '');
    updateSeriesPreview();
    dialogBaselines.set('seriesDialog', dialogSnapshot('seriesDialog'));
    $('seriesDialog').showModal();
    persistDrafts();
  }

  async function saveSeries(event) {
    event.preventDefault();
    if (mutationBusy || dialogScope !== db) return;
    const values = [];
    for (const [i, row] of [...$('seriesRows').children].entries()) {
      const fields = { date: $('seriesDate'), sessionName: $('seriesName'), sessionType: $('seriesType'), noTap: $('seriesNoTap') };
      for (const field of ['score', 'openFrames', 'strikes', 'strikeOpp', 'notes', 'ball']) fields[field] = row.querySelector(`[data-field="${field}"]`);
      const result = validateGameForm(fields);
      if (result.error) { setStatus($('seriesStatus'), `Game ${i + 1}: ${result.error}`, 'error'); return; }
      values.push(result.value);
    }
    const duplicate = values.some((value) => possibleDuplicate(value));
    if (duplicate && !window.confirm('One or more games match saved games in this session. Save this series anyway?')) return;
    const warnings = values.flatMap((value, i) => unusualGameWarnings(value).map((warning) => `Game ${i + 1}: ${warning}`));
    if (warnings.length && !window.confirm(`${warnings.join('\n')}\nSave this series anyway?`)) return;
    mutationBusy = true;
    $('saveSeriesBtn').disabled = true;
    const targetDb = db;
    const now = Date.now();
    const used = new Set(games.map((g) => g.id));
    const added = values.map((value, i) => {
      let id = now * 1000 + i;
      while (used.has(id)) id++;
      used.add(id);
      return { ...value, id, gameOrder: nextGameOrder(value.sessionName, value.date) + i, createdAt: now + i, updatedAt: now + i };
    });
    const related = games.filter(g => sessionKey(g) === sessionKey(added[0]) && sessionType(g) !== added[0].sessionType);
    const updates = [...added,...related.map(g => ({...g,sessionType:added[0].sessionType,updatedAt:Math.max(now,Number(g.updatedAt||0)+1)}))];
    try {
      await commitGames(updates, [], targetDb);
      if (db !== targetDb) return;
      games = await getAllGames();
      dom.date.value = values[0].date;
      dom.sessionName.value = values[0].sessionName;
      dom.sessionType.value = values[0].sessionType;
      dom.noTap.value = values[0].noTap ? 'no-tap' : 'standard';
      clearDraft('series');
      resetEntryForm({ preserveDate: true, preserveSession: true });
      $('seriesDialog').close();
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
    $('editSessionDialog').showModal();
  }

  async function saveSessionEdit(event) {
    event.preventDefault();
    if (mutationBusy || dialogScope !== db) return;
    const session = buildSessions(games).find((s) => s.key === editSessionKey);
    if (!session) { setStatus($('sessionEditStatus'), 'This session no longer exists. Close and choose another session.', 'error'); return; }
    const date = $('editSessionDate').value;
    const sessionName = $('editSessionName').value.trim();
    if (!isValidDate(date)) { setStatus($('sessionEditStatus'), 'Please enter a valid bowling date.', 'error'); return; }
    const newKey = sessionKey({ date, sessionName });
    if (newKey !== editSessionKey && games.some((g) => sessionKey(g) === newKey)
      && !window.confirm('This date change would combine two existing sessions. Combine them?')) return;
    const updatedAt = Math.max(Date.now(), ...session.games.map((g) => Number(g.updatedAt || 0) + 1));
    const updated = session.games.map((g) => ({ ...g, date, sessionName, sessionType: sessionType({sessionType:$('editSessionType').value}), updatedAt }));
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
      $('editSessionDialog').close();
      renderAll();
      if (!entryWasDirty) rememberEntry();
      emitDataChanged({ type: 'batch-upsert', games: clone(updated), bases: clone(session.games) });
      setStatus(dom.entryStatus, `Updated ${updated.length} games in the session.`, 'success');
    } catch (error) { setStatus($('sessionEditStatus'), 'Could not update this session. No changes were saved.', 'error'); }
    finally { mutationBusy = false; $('saveSessionBtn').disabled = false; }
  }

  function progressStats(source) {
    source = standardGames(source);
    const ordered = [...source].sort((a, b) => a.date.localeCompare(b.date) || gameOrder(a, b));
    const recent = (count) => {
      const slice = ordered.slice(-count);
      return { count: slice.length, average: slice.length ? slice.reduce((sum, g) => sum + g.score, 0) / slice.length : null };
    };
    let sum = 0;
    const points = [];
    ordered.forEach((game, i) => {
      sum += game.score;
      const point = { date: game.date, average: sum / (i + 1), count: i + 1 };
      if (points.at(-1)?.date === game.date) points[points.length - 1] = point;
      else points.push(point);
    });
    return { last10: recent(10), last30: recent(30), points };
  }

  function renderProgress() {
    const stats = progressStats(statsGames());
    const last5Count = Math.min(5, statsGames().length);
    $('last5Count').textContent = last5Count < 5 ? `${last5Count} of 5 games recorded` : 'Most recent 5 games';
    for (const count of [10, 30]) {
      const stat = stats[`last${count}`];
      $(`moreLast${count}`).textContent = stat.average === null ? '—' : stat.average.toFixed(1);
      $(`last${count}Count`).textContent = stat.count < count ? `${stat.count} of ${count} games recorded` : `Most recent ${count} games`;
    }
    const points = stats.points;
    if (!points.length) { $('averageChart').innerHTML = '<p class="section-copy">Add a game to start your progress chart.</p>'; return; }
    const time = (date) => Date.parse(`${date}T12:00:00Z`);
    const first = time(points[0].date), last = time(points.at(-1).date);
    const x = (point) => first === last ? 340 : 44 + (time(point.date) - first) / (last - first) * 590;
    const y = (point) => 194 - point.average / 300 * 170;
    const path = points.map((point, i) => `${i ? 'L' : 'M'}${x(point).toFixed(2)},${y(point).toFixed(2)}`).join(' ');
    $('averageChart').innerHTML = `<svg class="average-chart" viewBox="0 0 680 230" role="img" aria-labelledby="trendTitle trendDesc">
      <title id="trendTitle">Running average for selected games by date</title><desc id="trendDesc">${points.length} bowling dates. Latest average ${points.at(-1).average.toFixed(1)} across ${points.at(-1).count} games. Exact values are in the table below.</desc>
      ${[0, 150, 300].map((value) => `<line x1="44" x2="634" y1="${194 - value / 300 * 170}" y2="${194 - value / 300 * 170}" class="chart-grid"/><text x="34" y="${199 - value / 300 * 170}" text-anchor="end">${value}</text>`).join('')}
      <path d="${path}" class="chart-line"/>
      ${points.map((point) => `<circle cx="${x(point)}" cy="${y(point)}" r="3.5" class="chart-point"><title>${escapeHtml(fmtDate(point.date))}: ${point.average.toFixed(1)} · ${point.count} games</title></circle>`).join('')}
      <text x="44" y="220">${escapeHtml(fmtDate(points[0].date))}</text>${points.length > 1 ? `<text x="634" y="220" text-anchor="end">${escapeHtml(fmtDate(points.at(-1).date))}</text>` : ''}
    </svg><details><summary>View exact averages</summary><div class="trend-table-wrap"><table class="trend-table"><thead><tr><th scope="col">Date</th><th scope="col">Games to date</th><th scope="col">Average</th></tr></thead><tbody>${points.map((point) => `<tr><td>${escapeHtml(fmtDate(point.date))}</td><td>${point.count}</td><td>${point.average.toFixed(1)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }

  function showView(view, focus = true) {
    if (!['home', 'sessions', 'stats', 'friends'].includes(view)) return;
    activeView = view;
    document.querySelectorAll('.app-view').forEach((panel) => { panel.hidden = panel.id !== `view-${view}`; });
    document.querySelectorAll('.app-nav [data-go-view]').forEach((button) => {
      if (button.dataset.goView === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $('profileMenu').open = false;
    if (focus) { $('mainContent').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  function matchingSessions(sessions) {
    const query = $('sessionSearch').value.replace(/\bno[\s-]?tap\b/gi, '').trim().toLowerCase();
    const from = $('sessionFrom').value;
    const through = $('sessionTo').value;
    return sessions.filter((session) => (!query || session.name.toLowerCase().includes(query))
      && (!from || session.date >= from) && (!through || session.date <= through));
  }

  function renderHome() {
    const stats = calculateStats(games);
    $('homeRecap').innerHTML = `<div><strong>${stats.count ? stats.average.toFixed(1) : '—'}</strong><span>Standard average</span></div><div><strong>${stats.count}</strong><span>Standard games</span></div>`;
    const latest = buildSessions(games).sort(latestSessionOrder)[0];
    $('latestSessionShortcut').classList.toggle('hidden', !latest);
    if (latest) {
      $('latestSessionLabel').textContent = `${latest.name} · ${fmtDate(latest.date)} · ${latest.games.length} games`;
      $('continueLatestBtn').dataset.key = latest.key;
    } else { $('latestSessionLabel').textContent = ''; delete $('continueLatestBtn').dataset.key; }
  }

  function updateEntryContext() {
    const date = isValidDate(dom.date.value) ? fmtDate(dom.date.value) : 'Choose a date';
    const name = sessionType({sessionType:dom.sessionType.value});
    $('entrySessionSummary').textContent = `${editingGameId ? 'Editing game in' : 'Adding to'} ${name} · ${date}${dom.noTap.value === 'no-tap' ? ' · No-tap: excluded from standard stats' : ''}`;
    renderEntrySaveState();
  }

  function draftKey(kind) { return `bowling-draft:${activeLocalScope.dbName || activeLocalScope.uid || 'guest'}:${kind}`; }
  function readDraft(kind) { try { return JSON.parse(safeLocalStorageGet(draftKey(kind)) || 'null'); } catch (_) { return null; } }
  function clearDraft(kind) { if (!restoringDraft) safeLocalStorageSet(draftKey(kind), ''); }
  function showDraftNotice() {
    const entry = !!readDraft('entry'), series = !!readDraft('series');
    $('draftNotice').hidden = !entry && !series;
    $('recoverEntry').hidden = !entry; $('recoverSeries').hidden = !series;
  }
  function persistDrafts() {
    if (restoringDraft || !db) return;
    try {
      if (hasEntryDraft()) localStorage.setItem(draftKey('entry'), JSON.stringify({version:1, values:JSON.parse(entrySnapshot()), baseline:entryBaseline, base:entryBaseGame}));
      if ($('seriesDialog').open) {
        const rows = [...$('seriesRows').children].map(row => ({...Object.fromEntries(['score','openFrames','strikes','strikeOpp','notes','ball'].map(field => [field,row.querySelector(`[data-field="${field}"]`).value])), balls: Balls.draft(row.querySelector('[data-field="ball"]'))}));
        localStorage.setItem(draftKey('series'),JSON.stringify({version:1,date:$('seriesDate').value,name:$('seriesName').value,type:$('seriesType').value,ball:$('seriesBall').value,noTap:$('seriesNoTap').value === 'no-tap',rows}));
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
        ['date','sessionName','sessionType','score','openFrames','strikes','strikeOpp','notes','ball'].forEach((key,i) => dom[key].value = draft.values[i+1] ?? '');
        dom.noTap.value = draft.values[10] === 'no-tap' ? 'no-tap' : 'standard';
        Balls.set(dom.ball, Array.isArray(draft.values[11]) ? draft.values[11] : [{name: dom.ball.value}]);
        entryBaseline = draft.baseline;
        // Older drafts lack ball and/or scoring fields. Keep their original values.
        try {
          const baseline = JSON.parse(entryBaseline);
          if (baseline.length === 9) baseline.push('');
          if (baseline.length === 10) baseline.push('standard');
          if (baseline.length === 11) baseline.push([{name: baseline[9] || '', frames: ''}]);
          entryBaseline = JSON.stringify(baseline);
        } catch (_) {}
        $('gameAdvanced').open = !!dom.ball.value || dom.noTap.value === 'no-tap';
        dom.saveGameBtn.textContent = editingGameId ? 'Update game' : 'Save game';
        dom.entryHeading.textContent = editingGameId ? 'Edit game' : 'Add game';
        dom.cancelEditBtn.classList.remove('hidden');
        updateSessionSuggestions(); setStatus(dom.entryStatus, 'Game draft recovered. Review it before saving.', 'success');
      } else if (kind === 'series' && Array.isArray(draft.rows)) {
        if (editingGameId) { setStatus(dom.entryStatus,'Finish or cancel your game edit before recovering a series.'); return; }
        dialogScope = db; $('seriesRows').innerHTML = '';
        $('seriesDate').value = draft.date; $('seriesName').value = draft.name; $('seriesType').value = sessionType({sessionType:draft.type}); $('seriesBall').value = draft.ball || ''; $('seriesAdvanced').open = !!draft.ball;
        $('seriesNoTap').value = draft.noTap === true ? 'no-tap' : 'standard';
        $('seriesAdvanced').open = !!draft.ball || draft.noTap === true;
        draft.rows.forEach(values => {
          const row = addSeriesRow();
          for (const field of ['score','openFrames','strikes','strikeOpp','notes','ball']) row.querySelector(`[data-field="${field}"]`).value = values[field] ?? '';
          Balls.set(row.querySelector('[data-field="ball"]'), Array.isArray(values.balls) ? values.balls : [{name: values.ball || ''}]);
          row.querySelector('[data-ball-advanced]').open = !!values.ball || (values.balls?.length || 0) > 1;
        });
        dialogBaselines.set('seriesDialog',''); $('seriesDialog').showModal(); updateSeriesPreview();
        setStatus($('seriesStatus'),'Series draft recovered. Review it before saving.','success');
      }
    } finally { restoringDraft = false; }
  }

  function entrySnapshot() {
    return JSON.stringify([editingGameId, ...['date', 'sessionName', 'sessionType', 'score', 'openFrames', 'strikes', 'strikeOpp', 'notes', 'ball', 'noTap'].map((key) => dom[key].value), Balls.draft(dom.ball)]);
  }
  function rememberEntry() { entryBaseline = entrySnapshot(); renderEntrySaveState(); }
  function renderEntrySaveState() {
    const sync = dom.globalSyncStatus.textContent;
    $('entrySyncStatus').textContent = hasEntryDraft() ? `Draft on this device · tap ${editingGameId ? 'Update game' : 'Save game'} to add it to history` : sync === 'Local only' || !sync ? 'Games save on this device · local only' : sync;
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
    $(id).close();
    if (id === 'seriesDialog') { clearDraft('series'); showDraftNotice(); }
    return true;
  }

  function updateSeriesPreview() {
    const scores = [...$('seriesRows').querySelectorAll('[data-field="score"]')];
    const entered = scores.filter((input) => input.value !== '' && Number.isInteger(Number(input.value)) && +input.value >= 0 && +input.value <= 300);
    const total = entered.reduce((sum, input) => sum + Number(input.value), 0);
    $('seriesPreview').textContent = `${$('seriesNoTap').value === 'no-tap' ? 'No-tap series · ' : ''}${entered.length}/${scores.length} scores entered · Total ${total}${entered.length ? ` · Average ${(total / entered.length).toFixed(1)}` : ''}${$('seriesNoTap').value === 'no-tap' ? ' · Excluded from standard stats' : ''}`;
  }

  function wireNavigation() {
    dom.sessionsList.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const row = event.target.closest('.game-row');
      const toggle = row?.querySelector('.game-actions-toggle');
      if (!toggle || $('gameActions-' + toggle.dataset.id).hidden) return;
      event.preventDefault();
      setGameActions(Number(toggle.dataset.id), false);
      toggle.focus();
    });
    document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.goView)));
    for (const id of ['sessionSearch', 'sessionFrom', 'sessionTo']) $(id).addEventListener('input', () => { historyLimit = 10; renderHistory(); });
    $('historyScoring').addEventListener('change', () => { historyLimit = 10; renderHistory(); });
    $('clearSessionFilters').addEventListener('click', () => {
      for (const id of ['sessionSearch', 'sessionFrom', 'sessionTo']) $(id).value = '';
      $('historyScoring').value = '';
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
    showView('home', false);
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
    for (const id of ['statsFrom','statsTo','statsType','statsBall']) $(id).addEventListener('change', () => {
      if (id === 'statsFrom' || id === 'statsTo') statsPreset = 'custom';
      refreshStatsView();
    });
    document.querySelectorAll('[data-stats-preset]').forEach(button => button.addEventListener('click', () => applyStatsPreset(button.dataset.statsPreset)));
    $('clearStatsFilters').addEventListener('click', () => {
      $('statsType').value = ''; $('statsBall').value = ''; applyStatsPreset('all');
    });
    $('confirmImportBtn').addEventListener('click', confirmImport);
    $('cancelImportBtn').addEventListener('click', () => { pendingImport = null; $('importPreviewDialog').close(); });
    $('importPreviewDialog').addEventListener('cancel', () => { pendingImport = null; });
    for (const input of [dom.date,dom.sessionType,dom.score,dom.openFrames,dom.strikes,dom.strikeOpp,dom.notes,dom.ball]) input.addEventListener('input', () => { persistDrafts(); renderEntrySaveState(); });
    $('seriesForm').addEventListener('input', persistDrafts);
    $('seriesForm').addEventListener('change', persistDrafts);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistDrafts(); });
    window.addEventListener('pagehide', persistDrafts);
    dom.manualTab.addEventListener('click', () => setEntryMode(false));
    dom.photoTab.addEventListener('click', () => setEntryMode(true));
    dom.scoreboardPhoto.addEventListener('change', handlePhotoSelection);
    dom.clearPhotoBtn.addEventListener('click', () => clearPhoto());
    dom.saveGameBtn.addEventListener('click', saveGameFromForm);
    dom.cancelEditBtn.addEventListener('click', () => {
      if (hasEntryDraft() && !window.confirm('Discard your unsaved changes?')) return;
      resetEntryForm({ preserveDate: true, preserveSession: true });
      setStatus(dom.entryStatus, 'Edit cancelled.');
    });
    dom.sortFilter.addEventListener('change', renderHistory);
    dom.sessionSelect.addEventListener('change', selectEntrySession);
    $('sessionMode').addEventListener('change', changeSessionMode);
    dom.sessionType.addEventListener('change', () => { updateEntryContext(); persistDrafts(); });
    dom.date.addEventListener('change', () => { updateSessionSuggestions(); persistDrafts(); });

    dom.score.addEventListener('input', () => {
      if (Number(dom.score.value) === 300) {
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
      if (activeLocalScope.kind === 'user' || window.BowlingCloud?.isSignedIn?.()) {
        document.getElementById('openCloudBtn')?.click();
        setTimeout(() => document.getElementById('profileDisplayNameInput')?.focus(), 50);
      } else {
        dom.settingsDialog.showModal();
        setTimeout(() => dom.defaultBowlerInput?.focus(), 50);
      }
    });
    dom.openSettingsBtn.addEventListener('click', () => dom.settingsDialog.showModal());
    dom.closeSettingsBtn.addEventListener('click', () => dom.settingsDialog.close());
    dom.settingsDialog.addEventListener('click', (event) => {
      if (event.target === dom.settingsDialog) dom.settingsDialog.close();
    });
    dom.saveDefaultBowlerBtn.addEventListener('click', async () => {
      if (activeLocalScope.kind === 'user') {
        setStatus(dom.settingsStatus, 'While signed in, change your name under Cloud Sync → Leaderboard profile.', 'error');
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
    dom.clearAllBtn.addEventListener('click', async () => {
      if (!games.length) {
        setStatus(dom.settingsStatus, 'There is no bowling history to delete.');
        return;
      }
      const cloudNote = window.BowlingCloud?.isSignedIn?.()
        ? ' The deletions will also sync to your cloud account.'
        : '';
      if (!window.confirm(`Delete every saved bowling game?${cloudNote} This cannot be undone unless you have an exported backup.`)) return;
      clearUndo();
      const now = Date.now();
      for (const game of games) await putTombstone({ id: game.id, updatedAt: now });
      await clearGames();
      games = [];
      renderAll();
      emitDataChanged({ type: 'bulk' });
      setStatus(dom.settingsStatus, 'All bowling history deleted.', 'success');
    });

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
    window.addEventListener('online', () => { dom.offlineStatus.textContent = offlineCacheReady ? 'Online · offline cache ready' : 'Online · offline cache not ready'; });
    window.addEventListener('offline', () => { dom.offlineStatus.textContent = 'Offline · local data available'; });
  }

  const api = {
    version: APP_VERSION,
    ready: false,
    startupError: null,
    getGames: () => clone(games),
    getTombstones: async () => clone(await getAllTombstones()),
    getBowlerNames: () => [activeProfileName || 'Bowler'],
    getDefaultBowler: async () => activeProfileName || await getSetting('profileName') || await getSetting('defaultBowler') || 'Bowler',
    getProfileName: () => activeProfileName || 'Bowler',
    setProfileName,
    setSyncStatus,
    getLeaderboardSummary: (bowlerName) => clone(leaderboardSummaryForBowler(bowlerName)),
    getLocalScopeInfo,
    getAccountLocalGameCount,
    activateAccount,
    activateGuest,
    copyAccountDataToGuest,
    applyRemoteChanges,
    renderAll,
    formatDate: fmtDate
  };
  window.BowlingApp = api;

  async function init() {
    api.ready = false;
    api.startupError = null;
    dom.date.value = todayLocal();
    dom.sessionName.value = newSessionId();
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
      renderAll();
      showDraftNotice();
      api.ready = true;
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

  init();
})();
