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
  const APP_VERSION = 4;

  let activeView = 'home';
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
    cleanGames: $('statCleanGames'),
    cleanGamesDetail: $('statCleanGamesDetail'),
    totalStrikes: $('statTotalStrikes'),
    strikesPerGame: $('statStrikesPerGame'),
    sessions: $('statSessions'),
    gamesAndMilestones: $('statGamesAndMilestones'),
    moreGames: $('moreGames'),
    more200: $('more200'),
    more250: $('more250'),
    more300: $('more300'),
    moreStrikeAvg: $('moreStrikeAvg'),
    moreCleanRate: $('moreCleanRate'),
    moreLast5: $('moreLast5'),
    moreBestSessionAvg: $('moreBestSessionAvg'),
    recordHighGame: $('recordHighGame'),
    recordHighGameDetail: $('recordHighGameDetail'),
    recordHighSeries: $('recordHighSeries'),
    recordHighSeriesDetail: $('recordHighSeriesDetail'),
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
    return (game.sessionName || '').trim() || 'Bowling Session';
  }

  function sessionKey(game) {
    return `${game.date}|||${sessionLabel(game).toLowerCase()}`;
  }

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
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
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
    $('seriesDialog').close();
    $('editSessionDialog').close();
    games = await getAllGames();
    editingGameId = null;
    await loadProfileName(true);
    resetEntryForm({ preserveDate: false, preserveSession: false });
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
      sessionGames.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
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
    for (const session of sessions) {
      if (session.games.length < 3) continue;
      for (let i = 0; i <= session.games.length - 3; i += 1) {
        const slice = session.games.slice(i, i + 3);
        const total = slice.reduce((sum, g) => sum + g.score, 0);
        if (!best || total > best.total) {
          best = { total, session, startIndex: i };
        }
      }
    }
    return best;
  }

  function filteredGames() {
    return [...games];
  }

  function updateSessionSuggestions({ chooseRecent = false } = {}) {
    const sessions = buildSessions(games).sort((a, b) => b.date.localeCompare(a.date));
    if (chooseRecent && !editingGameId) {
      const recent = games.filter((g) => g.date === dom.date.value)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
      dom.sessionName.value = recent?.sessionName || '';
    }
    dom.sessionSelect.innerHTML = '<option value="">＋ New session</option>' + sessions.map((session) =>
      `<option value="${escapeHtml(session.key)}">${escapeHtml(fmtDate(session.date))} · ${escapeHtml(session.name)} · ${session.games.length} game${session.games.length === 1 ? '' : 's'}</option>`
    ).join('');
    const key = sessionKey({ date: dom.date.value, sessionName: dom.sessionName.value });
    dom.sessionSelect.value = sessions.some((session) => session.key === key) ? key : '';
    updateEntryContext();
  }

  function selectEntrySession() {
    const session = buildSessions(games).find((item) => item.key === dom.sessionSelect.value);
    if (session) {
      dom.date.value = session.date;
      dom.sessionName.value = session.games[0].sessionName || '';
    } else {
      dom.sessionName.value = '';
      dom.sessionName.focus();
    }
    updateEntryContext();
  }

  function calculateStats(sourceGames) {
    const count = sourceGames.length;
    const sessions = buildSessions(sourceGames);
    const scores = sourceGames.map((g) => g.score);
    const totalStrikes = sourceGames.reduce((sum, g) => sum + g.strikes, 0);
    const strikeOpps = sourceGames.reduce((sum, g) => sum + g.strikeOpportunities, 0);
    const totalOpen = sourceGames.reduce((sum, g) => sum + g.openFrames, 0);
    const cleanGames = sourceGames.filter((g) => g.openFrames === 0).length;
    const sortedRecent = [...sourceGames].sort((a, b) => b.date.localeCompare(a.date) || Number(b.createdAt || 0) - Number(a.createdAt || 0) || b.id - a.id);
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
    return {
      games: stats.count,
      average: stats.average,
      highGame: stats.highGameObj ? stats.highGameObj.score : 0,
      highSeries: stats.bestSeries ? stats.bestSeries.total : 0,
      strikePct: stats.strikePct,
      cleanGames: stats.cleanGames,
      totalStrikes: stats.totalStrikes,
      bestSessionAvg: stats.bestSession ? stats.bestSession.average : 0,
      updatedAt: Date.now()
    };
  }

  function renderStats() {
    const stats = calculateStats(filteredGames());
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

    dom.cleanGames.textContent = stats.cleanGames;
    dom.cleanGamesDetail.textContent = `${stats.cleanRate.toFixed(1)}% of games`;

    dom.totalStrikes.textContent = stats.totalStrikes;
    dom.strikesPerGame.textContent = `${stats.strikesPerGame.toFixed(2)} per game`;

    dom.sessions.textContent = stats.sessions.length;
    dom.gamesAndMilestones.textContent = `${stats.count} games · ${stats.games200} scores of 200+`;

    dom.moreGames.textContent = stats.count;
    dom.more200.textContent = stats.games200;
    dom.more250.textContent = stats.games250;
    dom.more300.textContent = stats.games300;
    dom.moreStrikeAvg.textContent = stats.count ? stats.strikesPerGame.toFixed(2) : '—';
    dom.moreCleanRate.textContent = stats.count ? `${stats.cleanRate.toFixed(1)}%` : '—';
    dom.moreLast5.textContent = stats.count ? stats.last5.toFixed(1) : '—';
    dom.moreBestSessionAvg.textContent = stats.bestSession ? stats.bestSession.average.toFixed(1) : '—';

    dom.recordHighGame.textContent = stats.highGameObj ? stats.highGameObj.score : '—';
    dom.recordHighGameDetail.textContent = stats.highGameObj ? fmtDate(stats.highGameObj.date) : 'No games yet';
    dom.recordHighSeries.textContent = stats.bestSeries ? stats.bestSeries.total : '—';
    dom.recordHighSeriesDetail.textContent = stats.bestSeries ? `${fmtDate(stats.bestSeries.session.date)} · ${stats.bestSeries.session.name}` : 'Need 3 games';
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
      const cleanCount = session.games.filter((g) => g.openFrames === 0).length;
      return `
        <details class="session-card" data-session-key="${escapeHtml(session.key)}" ${expandedSessions.has(session.key) ? (expandedSessions.get(session.key) ? 'open' : '') : (index === 0 ? 'open' : '')}>
          <summary class="session-header">
            <div>
              <div class="session-title">${escapeHtml(fmtDate(session.date))}</div>
              <div class="session-meta">${escapeHtml(session.name)} · ${session.games.length} game${session.games.length === 1 ? '' : 's'}</div>
            </div>
            <div class="session-badges">
              <span class="badge">Avg ${session.average.toFixed(1)}</span>
              <span class="badge">Series ${session.total}</span>
              <span class="badge">${session.strikes} strikes</span>
              <span class="badge">${session.openFrames} opens</span>
              ${cleanCount ? `<span class="badge">${cleanCount} clean</span>` : ''}
            </div>
          </summary>
          <div class="session-actions">
            <button class="btn secondary compact add-to-session" data-key="${escapeHtml(session.key)}" type="button">＋ Add game</button>
            <button class="text-btn edit-session" data-key="${escapeHtml(session.key)}" type="button">Edit session</button>
          </div>
          <div class="games-grid">
            ${session.games.map((g, index) => `
              <div class="game-row">
                <div>
                  <div class="game-row-top">
                    <div>
                      <div class="game-number">Game ${index + 1}</div>
                      <div class="game-score">${g.score}</div>
                    </div>
                    <div class="game-actions">
                      <button class="text-btn edit-game" data-id="${g.id}" type="button">Edit</button>
                      <button class="text-btn danger-text delete-game" data-id="${g.id}" type="button">Delete</button>
                    </div>
                  </div>
                  ${g.notes ? `<div class="game-notes">${escapeHtml(g.notes)}</div>` : ''}
                </div>
                <div class="game-stats">
                  ${g.openFrames === 0 ? '✓ Clean game · ' : ''}${g.openFrames} open frame${g.openFrames === 1 ? '' : 's'}<br>
                  ${g.strikes} strike${g.strikes === 1 ? '' : 's'} · ${g.strikeOpportunities ? ((g.strikes / g.strikeOpportunities) * 100).toFixed(1) : '0.0'}% strike rate
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      `;
    }).join('');

    dom.sessionsList.querySelectorAll('details[data-session-key]').forEach((detail) => detail.addEventListener('toggle', () => expandedSessions.set(detail.dataset.sessionKey, detail.open)));
    dom.sessionsList.querySelectorAll('.add-to-session').forEach((button) => button.addEventListener('click', () => addToSession(button.dataset.key)));
    dom.sessionsList.querySelectorAll('.edit-session').forEach((button) => button.addEventListener('click', () => openSessionEditor(button.dataset.key)));
    dom.sessionsList.querySelectorAll('.edit-game').forEach((button) => {
      button.addEventListener('click', () => startEdit(Number(button.dataset.id)));
    });
    dom.sessionsList.querySelectorAll('.delete-game').forEach((button) => {
      button.addEventListener('click', () => confirmDelete(Number(button.dataset.id)));
    });
  }

  function renderAll() {
    renderStats();
    renderProgress();
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
    const score = Number(fields.score.value);
    const openFrames = Number(fields.openFrames.value);
    const strikes = Number(fields.strikes.value);
    const strikeOpportunities = Number(fields.strikeOpp.value);
    const notes = fields.notes.value.trim();

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
      value: { bowler, date, sessionName, score, openFrames, strikes, strikeOpportunities, notes }
    };
  }

  function possibleDuplicate(candidate) {
    const session = String(candidate.sessionName || '').trim().toLowerCase();
    return games.find((g) => Number(g.id) !== Number(editingGameId)
      && g.date === candidate.date
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
    return ['createdAt', 'updatedAt'].every((key) => game[key] === undefined || integerIn(game[key], 0, Number.MAX_SAFE_INTEGER));
  }

  function normalizeGame(game) {
    const strikes = Number(game.strikes);
    return {
      id: Number(game.id),
      bowler: String(game.bowler).trim(),
      date: String(game.date),
      sessionName: String(game.sessionName || ''),
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
    const game = {
      id: editingGameId || (now * 1000 + Math.floor(Math.random() * 1000)),
      ...validated.value,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    mutationBusy = true;
    dom.saveGameBtn.disabled = true;
    const targetDb = db;
    try {
      await commitGames([game], [], targetDb);
      if (db !== targetDb) return;
      games = await getAllGames();
      if (editingGameId) {
        setStatus(dom.entryStatus, 'Game updated.', 'success');
      } else {
        setStatus(dom.entryStatus, 'Game saved and added to this session.', 'success');
      }
      resetEntryForm({ preserveDate: true, preserveSession: true });
      renderAll();
      emitDataChanged({ type: 'upsert', game: clone(game) });
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
    const sessionName = preserveSession ? dom.sessionName.value : '';
    dom.date.value = date;
    dom.sessionName.value = sessionName;
    dom.score.value = '';
    dom.openFrames.value = '';
    dom.strikes.value = '';
    dom.strikeOpp.value = '10';
    dom.notes.value = '';
    editingGameId = null;
    dom.saveGameBtn.textContent = 'Save game';
    dom.cancelEditBtn.classList.add('hidden');
    dom.entryHeading.textContent = 'Add game';
    dom.entrySubheading.textContent = 'Enter the numbers directly or use a scoreboard photo as a reference.';
    clearPhoto();
    updateSessionSuggestions();
    rememberEntry();
  }

  function startEdit(id) {
    if (hasEntryDraft() && !window.confirm('Discard the unsaved entry and edit this game?')) return;
    showView('home', false);
    const game = games.find((g) => g.id === id);
    if (!game) return;
    editingGameId = id;
    dom.date.value = game.date;
    dom.sessionName.value = game.sessionName || '';
    updateSessionSuggestions();
    dom.score.value = game.score;
    dom.openFrames.value = game.openFrames;
    dom.strikes.value = game.strikes;
    dom.strikeOpp.value = game.strikeOpportunities;
    dom.notes.value = game.notes || '';
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
      emitDataChanged({ type: 'delete', id, tombstone: clone(tombstone) });
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
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv() {
    const rows = [
      ['Date','Bowler','Session','Score','Open Frames','Strikes','Strike Opportunities','Strike %','Clean Game','Notes']
    ];
    [...games].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0)).forEach((g) => {
      rows.push([
        g.date, g.bowler, sessionLabel(g), g.score, g.openFrames, g.strikes, g.strikeOpportunities,
        g.strikeOpportunities ? ((g.strikes / g.strikeOpportunities) * 100).toFixed(1) : '0.0',
        g.openFrames === 0 ? 'Yes' : 'No', g.notes || ''
      ]);
    });
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    downloadFile(`bowling-history-${todayLocal()}.csv`, csv, 'text/csv;charset=utf-8');
    setStatus(dom.settingsStatus, 'CSV exported.', 'success');
  }

  async function importBackupFile(file) {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || !Array.isArray(payload.games)) throw new Error('Backup does not contain a games array.');
      const invalidRows = payload.games.map((game, i) => isValidGame(game) ? null : i + 1).filter((row) => row !== null);
      if (invalidRows.length) throw new Error(`Invalid game data in backup row${invalidRows.length === 1 ? '' : 's'} ${invalidRows.slice(0, 5).join(', ')}${invalidRows.length > 5 ? '…' : ''}. Check dates and numeric values. No games were imported.`);
      const imported = payload.games.map(normalizeGame);
      const importedTombstones = Array.isArray(payload.tombstones)
        ? payload.tombstones.filter((t) => t && Number.isFinite(Number(t.id)) && Number.isFinite(Number(t.updatedAt)))
          .map((t) => ({ id: Number(t.id), updatedAt: Number(t.updatedAt) }))
        : [];

      if (!imported.length && payload.games.length) throw new Error('No valid games were found in the backup.');
      if (!window.confirm(`Import ${imported.length} game${imported.length === 1 ? '' : 's'}? Existing games with the same IDs will be updated.`)) return;

      for (const game of imported) {
        const existingTombstone = await getTombstone(game.id);
        if (!existingTombstone || game.updatedAt > existingTombstone.updatedAt) {
          await putGame(game);
          await deleteTombstone(game.id);
        }
      }
      for (const tombstone of importedTombstones) {
        const existingGame = (await idbRequest(GAME_STORE, 'readonly', (store) => store.get(tombstone.id))) || null;
        const existingTombstone = await getTombstone(tombstone.id);
        if ((!existingGame || tombstone.updatedAt >= Number(existingGame.updatedAt || 0))
          && (!existingTombstone || tombstone.updatedAt > existingTombstone.updatedAt)) {
          await putTombstone(tombstone);
          await deleteGameRecord(tombstone.id);
        }
      }

      if (payload.profileName && activeLocalScope.kind !== 'user') await setProfileName(payload.profileName);
      games = await getAllGames();
      renderAll();
      emitDataChanged({ type: 'bulk' });
      setStatus(dom.settingsStatus, `Imported ${imported.length} game${imported.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      console.error(error);
      setStatus(dom.settingsStatus, `Import failed: ${error.message}`, 'error');
    } finally {
      dom.importJsonInput.value = '';
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      dom.offlineStatus.textContent = 'Offline install not supported in this browser';
      return;
    }
    try {
      await navigator.serviceWorker.register('./service-worker.js');
      dom.offlineStatus.textContent = navigator.onLine ? 'Offline-ready after first load' : 'Offline';
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
      emitDataChanged({ type: 'upsert', game: clone(restored) });
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
    </div><button class="text-btn danger-text remove-series-row" type="button">Remove game</button>`;
    row.querySelector('.remove-series-row').addEventListener('click', () => {
      if ($('seriesRows').children.length > 1) { row.remove(); numberSeriesRows(); updateSeriesPreview(); }
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
    if (editingGameId) { setStatus(dom.entryStatus, 'Finish or cancel the game edit before entering a series.'); return; }
    dialogScope = db;
    $('seriesDate').value = dom.date.value || todayLocal();
    $('seriesName').value = dom.sessionName.value;
    $('seriesRows').innerHTML = '';
    const first = addSeriesRow();
    for (const field of ['score', 'openFrames', 'strikes', 'strikeOpp', 'notes']) first.querySelector(`[data-field="${field}"]`).value = dom[field].value;
    addSeriesRow(); addSeriesRow();
    setStatus($('seriesStatus'), '');
    updateSeriesPreview();
    dialogBaselines.set('seriesDialog', dialogSnapshot('seriesDialog'));
    $('seriesDialog').showModal();
  }

  async function saveSeries(event) {
    event.preventDefault();
    if (mutationBusy || dialogScope !== db) return;
    const values = [];
    for (const [i, row] of [...$('seriesRows').children].entries()) {
      const fields = { date: $('seriesDate'), sessionName: $('seriesName') };
      for (const field of ['score', 'openFrames', 'strikes', 'strikeOpp', 'notes']) fields[field] = row.querySelector(`[data-field="${field}"]`);
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
      return { ...value, id, createdAt: now + i, updatedAt: now + i };
    });
    try {
      await commitGames(added, [], targetDb);
      if (db !== targetDb) return;
      games = await getAllGames();
      dom.date.value = values[0].date;
      dom.sessionName.value = values[0].sessionName;
      resetEntryForm({ preserveDate: true, preserveSession: true });
      $('seriesDialog').close();
      renderAll();
      emitDataChanged({ type: 'batch-upsert', games: clone(added) });
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
    $('editSessionCount').textContent = `Update the date and name for all ${session.games.length} games in this session.`;
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
      && !window.confirm('A session already has this date and name. Combine both sessions?')) return;
    const updatedAt = Math.max(Date.now(), ...session.games.map((g) => Number(g.updatedAt || 0) + 1));
    const updated = session.games.map((g) => ({ ...g, date, sessionName, updatedAt }));
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
      }
      $('editSessionDialog').close();
      renderAll();
      if (!entryWasDirty) rememberEntry();
      emitDataChanged({ type: 'batch-upsert', games: clone(updated) });
      setStatus(dom.entryStatus, `Updated ${updated.length} games in the session.`, 'success');
    } catch (error) { setStatus($('sessionEditStatus'), 'Could not update this session. No changes were saved.', 'error'); }
    finally { mutationBusy = false; $('saveSessionBtn').disabled = false; }
  }

  function progressStats(source) {
    const ordered = [...source].sort((a, b) => a.date.localeCompare(b.date) || Number(a.createdAt || 0) - Number(b.createdAt || 0) || a.id - b.id);
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
    const stats = progressStats(games);
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
      <title id="trendTitle">Running career average by date</title><desc id="trendDesc">${points.length} bowling dates. Latest average ${points.at(-1).average.toFixed(1)} across ${points.at(-1).count} games. Exact values are in the table below.</desc>
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
    const query = $('sessionSearch').value.trim().toLowerCase();
    const from = $('sessionFrom').value;
    const through = $('sessionTo').value;
    return sessions.filter((session) => (!query || session.name.toLowerCase().includes(query))
      && (!from || session.date >= from) && (!through || session.date <= through));
  }

  function renderHome() {
    const stats = calculateStats(games);
    $('homeRecap').innerHTML = `<div><strong>${games.length ? stats.average.toFixed(1) : '—'}</strong><span>Career average</span></div><div><strong>${games.length}</strong><span>Games logged</span></div>`;
    const latest = buildSessions(games).sort((a, b) => b.date.localeCompare(a.date))[0];
    $('latestSessionShortcut').classList.toggle('hidden', !latest);
    if (latest) {
      $('latestSessionLabel').textContent = `${latest.name} · ${fmtDate(latest.date)} · ${latest.games.length} games`;
      $('continueLatestBtn').dataset.key = latest.key;
    } else { $('latestSessionLabel').textContent = ''; delete $('continueLatestBtn').dataset.key; }
  }

  function updateEntryContext() {
    const date = isValidDate(dom.date.value) ? fmtDate(dom.date.value) : 'Choose a date';
    const name = sessionLabel({ sessionName: dom.sessionName.value });
    $('entrySessionSummary').textContent = `${editingGameId ? 'Editing game in' : 'Adding to'} ${name} · ${date}`;
    renderEntrySaveState();
  }

  function entrySnapshot() {
    return JSON.stringify([editingGameId, ...['date', 'sessionName', 'score', 'openFrames', 'strikes', 'strikeOpp', 'notes'].map((key) => dom[key].value)]);
  }
  function rememberEntry() { entryBaseline = entrySnapshot(); renderEntrySaveState(); }
  function renderEntrySaveState() {
    const sync = dom.globalSyncStatus.textContent;
    $('entrySyncStatus').textContent = hasEntryDraft() ? `Unsaved changes · tap ${editingGameId ? 'Update game' : 'Save game'}` : sync === 'Local only' || !sync ? 'Games save on this device · local only' : sync;
  }
  function hasEntryDraft() { return entryBaseline !== null && entrySnapshot() !== entryBaseline; }
  function dialogSnapshot(id) { return JSON.stringify([...$(id).querySelectorAll('input')].map((input) => input.value)); }
  function dialogHasChanges(id) { return $(id).open && dialogBaselines.has(id) && dialogSnapshot(id) !== dialogBaselines.get(id); }
  function closeEntryDialog(id) {
    if (mutationBusy) return false;
    if (dialogHasChanges(id) && !window.confirm('Discard the unsaved changes in this window?')) return false;
    $(id).close();
    return true;
  }

  function updateSeriesPreview() {
    const scores = [...$('seriesRows').querySelectorAll('[data-field="score"]')];
    const entered = scores.filter((input) => input.value !== '' && Number.isInteger(Number(input.value)) && +input.value >= 0 && +input.value <= 300);
    const total = entered.reduce((sum, input) => sum + Number(input.value), 0);
    $('seriesPreview').textContent = `${entered.length}/${scores.length} scores entered · Total ${total}${entered.length ? ` · Average ${(total / entered.length).toFixed(1)}` : ''}`;
  }

  function wireNavigation() {
    document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.goView)));
    for (const id of ['sessionSearch', 'sessionFrom', 'sessionTo']) $(id).addEventListener('input', () => { historyLimit = 10; renderHistory(); });
    $('clearSessionFilters').addEventListener('click', () => {
      for (const id of ['sessionSearch', 'sessionFrom', 'sessionTo']) $(id).value = '';
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
    $('addSeriesRow').addEventListener('click', () => addSeriesRow().querySelector('input').focus());
    $('seriesForm').addEventListener('submit', saveSeries);
    $('editSessionForm').addEventListener('submit', saveSessionEdit);
    $('undoDeleteBtn').addEventListener('click', undoLastDeletion);
    document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeEntryDialog(button.dataset.close)));
  }

  function wireEvents() {
    wireEnhancements();
    wireNavigation();
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
    dom.sessionName.addEventListener('input', () => updateSessionSuggestions());
    dom.date.addEventListener('change', () => updateSessionSuggestions({ chooseRecent: true }));

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
    window.addEventListener('online', () => { dom.offlineStatus.textContent = 'Online · offline cache ready'; });
    window.addEventListener('offline', () => { dom.offlineStatus.textContent = 'Offline · local data available'; });
  }

  const api = {
    version: APP_VERSION,
    ready: false,
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
    dom.date.value = todayLocal();
    setEntryMode(false);
    wireEvents();
    rememberEntry();

    if (!('indexedDB' in window)) {
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
      api.ready = true;
      window.dispatchEvent(new CustomEvent('bowling:ready', { detail: { ok: true } }));
    } catch (error) {
      console.error(error);
      setStatus(dom.entryStatus, 'Could not open local storage. Try opening the installed web app again.', 'error');
      window.dispatchEvent(new CustomEvent('bowling:ready', { detail: { ok: false } }));
    }

    registerServiceWorker();
  }

  init();
})();
