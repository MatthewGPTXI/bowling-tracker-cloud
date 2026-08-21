(() => {
  'use strict';

  const DB_NAME = 'bowling-tracker-db';
  const DB_VERSION = 2;
  const GAME_STORE = 'games';
  const SETTINGS_STORE = 'settings';
  const TOMBSTONE_STORE = 'tombstones';
  const APP_VERSION = 2;

  let db;
  let games = [];
  let editingGameId = null;
  let deferredInstallPrompt = null;
  let selectedPhotoUrl = null;

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
    bowler: $('bowlerInput'),
    date: $('dateInput'),
    sessionName: $('sessionNameInput'),
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
    bowlerFilter: $('bowlerFilter'),
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
    return `${game.bowler}|||${game.date}|||${sessionLabel(game).toLowerCase()}`;
  }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function emitDataChanged(detail = { type: 'bulk' }) {
    window.dispatchEvent(new CustomEvent('bowling:data-changed', { detail }));
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
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

  function idbRequest(storeName, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = action(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
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
    const filter = dom.bowlerFilter.value;
    return filter === 'all' ? [...games] : games.filter((g) => g.bowler === filter);
  }

  function calculateStats(sourceGames) {
    const count = sourceGames.length;
    const sessions = buildSessions(sourceGames);
    const scores = sourceGames.map((g) => g.score);
    const totalStrikes = sourceGames.reduce((sum, g) => sum + g.strikes, 0);
    const strikeOpps = sourceGames.reduce((sum, g) => sum + g.strikeOpportunities, 0);
    const totalOpen = sourceGames.reduce((sum, g) => sum + g.openFrames, 0);
    const cleanGames = sourceGames.filter((g) => g.openFrames === 0).length;
    const sortedRecent = [...sourceGames].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const bestSession = sessions.length ? sessions.reduce((best, s) => s.average > best.average ? s : best) : null;
    const bestSeries = bestThreeGameSeries(sessions);
    const highGameObj = sourceGames.length ? sourceGames.reduce((best, g) => g.score > best.score ? g : best) : null;

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
      bestSession
    };
  }

  function leaderboardSummaryForBowler(bowlerName) {
    const source = games.filter((g) => g.bowler === bowlerName);
    const stats = calculateStats(source);
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
      ? `${fmtDate(stats.highGameObj.date)} · ${stats.highGameObj.bowler}`
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
  }

  function updateBowlerFilter() {
    const previous = dom.bowlerFilter.value;
    const names = [...new Set(games.map((g) => g.bowler).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    dom.bowlerFilter.innerHTML = '<option value="all">All bowlers</option>' + names
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    if (names.includes(previous)) dom.bowlerFilter.value = previous;
  }

  function renderHistory() {
    const source = filteredGames();
    const sessions = buildSessions(source);
    const sort = dom.sortFilter.value;

    if (sort === 'oldest') {
      sessions.sort((a, b) => a.date.localeCompare(b.date));
    } else if (sort === 'highscore') {
      sessions.sort((a, b) => b.highGame - a.highGame || b.date.localeCompare(a.date));
    } else {
      sessions.sort((a, b) => b.date.localeCompare(a.date));
    }

    dom.emptyHistory.classList.toggle('hidden', sessions.length > 0);
    if (!sessions.length) {
      dom.sessionsList.innerHTML = '';
      return;
    }

    dom.sessionsList.innerHTML = sessions.map((session) => {
      const cleanCount = session.games.filter((g) => g.openFrames === 0).length;
      return `
        <article class="session-card">
          <div class="session-header">
            <div>
              <div class="session-title">${escapeHtml(session.bowler)} · ${escapeHtml(fmtDate(session.date))}</div>
              <div class="session-meta">${escapeHtml(session.name)} · ${session.games.length} game${session.games.length === 1 ? '' : 's'}</div>
            </div>
            <div class="session-badges">
              <span class="badge">Avg ${session.average.toFixed(1)}</span>
              <span class="badge">Series ${session.total}</span>
              <span class="badge">${session.strikes} strikes</span>
              <span class="badge">${session.openFrames} opens</span>
              ${cleanCount ? `<span class="badge">${cleanCount} clean</span>` : ''}
            </div>
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
        </article>
      `;
    }).join('');

    dom.sessionsList.querySelectorAll('.edit-game').forEach((button) => {
      button.addEventListener('click', () => startEdit(Number(button.dataset.id)));
    });
    dom.sessionsList.querySelectorAll('.delete-game').forEach((button) => {
      button.addEventListener('click', () => confirmDelete(Number(button.dataset.id)));
    });
  }

  function renderAll() {
    updateBowlerFilter();
    renderStats();
    renderHistory();
    window.dispatchEvent(new CustomEvent('bowling:rendered'));
  }

  function validateGameForm() {
    const bowler = dom.bowler.value.trim();
    const date = dom.date.value;
    const sessionName = dom.sessionName.value.trim();
    const score = Number(dom.score.value);
    const openFrames = Number(dom.openFrames.value);
    const strikes = Number(dom.strikes.value);
    const strikeOpportunities = Number(dom.strikeOpp.value);
    const notes = dom.notes.value.trim();

    if (!bowler || !date || dom.score.value === '' || dom.openFrames.value === '' || dom.strikes.value === '' || dom.strikeOpp.value === '') {
      return { error: 'Please fill in bowler, date, score, open frames, strikes, and strike opportunities.' };
    }
    if (!Number.isInteger(score) || score < 0 || score > 300) return { error: 'Score must be a whole number from 0 to 300.' };
    if (!Number.isInteger(openFrames) || openFrames < 0 || openFrames > 10) return { error: 'Open frames must be a whole number from 0 to 10.' };
    if (!Number.isInteger(strikes) || strikes < 0 || strikes > 12) return { error: 'Strikes must be a whole number from 0 to 12.' };
    if (!Number.isInteger(strikeOpportunities) || strikeOpportunities < 1 || strikeOpportunities > 12) return { error: 'Strike opportunities must be a whole number from 1 to 12.' };
    if (strikes > strikeOpportunities) return { error: 'Strikes cannot exceed strike opportunities.' };
    if (score === 300 && strikes !== 12) return { error: 'A 300 game should be recorded as 12 strikes.' };

    return {
      value: { bowler, date, sessionName, score, openFrames, strikes, strikeOpportunities, notes }
    };
  }

  function isValidGame(game) {
    return game && typeof game === 'object'
      && Number.isFinite(Number(game.id))
      && typeof game.bowler === 'string'
      && game.bowler.trim().length > 0
      && /^\d{4}-\d{2}-\d{2}$/.test(game.date || '')
      && Number.isInteger(Number(game.score)) && Number(game.score) >= 0 && Number(game.score) <= 300
      && Number.isInteger(Number(game.openFrames)) && Number(game.openFrames) >= 0 && Number(game.openFrames) <= 10
      && Number.isInteger(Number(game.strikes)) && Number(game.strikes) >= 0 && Number(game.strikes) <= 12;
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
      strikeOpportunities: Math.max(Number(game.strikeOpportunities || 10), strikes, 1),
      notes: String(game.notes || ''),
      createdAt: Number(game.createdAt || Date.now()),
      updatedAt: Number(game.updatedAt || game.createdAt || Date.now())
    };
  }

  async function saveGameFromForm() {
    const validated = validateGameForm();
    if (validated.error) {
      setStatus(dom.entryStatus, validated.error, 'error');
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

    try {
      await putGame(game);
      await deleteTombstone(game.id);
      games = await getAllGames();
      if (editingGameId) {
        setStatus(dom.entryStatus, 'Game updated.', 'success');
      } else {
        setStatus(dom.entryStatus, 'Game saved and added to this session.', 'success');
      }
      resetEntryForm({ preserveBowler: true, preserveDate: true, preserveSession: true });
      renderAll();
      emitDataChanged({ type: 'upsert', game: clone(game) });
    } catch (error) {
      console.error(error);
      setStatus(dom.entryStatus, 'Could not save the game on this device.', 'error');
    }
  }

  function resetEntryForm({ preserveBowler = false, preserveDate = false, preserveSession = false } = {}) {
    const bowler = preserveBowler ? dom.bowler.value : '';
    const date = preserveDate ? dom.date.value : todayLocal();
    const sessionName = preserveSession ? dom.sessionName.value : '';
    dom.bowler.value = bowler;
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
  }

  function startEdit(id) {
    const game = games.find((g) => g.id === id);
    if (!game) return;
    editingGameId = id;
    dom.bowler.value = game.bowler;
    dom.date.value = game.date;
    dom.sessionName.value = game.sessionName || '';
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
    window.scrollTo({ top: document.querySelector('.entry-panel').offsetTop - 12, behavior: 'smooth' });
  }

  async function confirmDelete(id) {
    const game = games.find((g) => g.id === id);
    if (!game) return;
    if (!window.confirm(`Delete the ${game.score} game from ${fmtDate(game.date)}?`)) return;
    const tombstone = { id, updatedAt: Date.now() };
    await putTombstone(tombstone);
    await deleteGameRecord(id);
    games = await getAllGames();
    renderAll();
    emitDataChanged({ type: 'delete', id, tombstone: clone(tombstone) });
  }

  function setEntryMode(photoMode) {
    dom.manualTab.classList.toggle('active', !photoMode);
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

  async function loadDefaultBowler() {
    const defaultBowler = await getSetting('defaultBowler');
    if (defaultBowler) {
      dom.bowler.value = defaultBowler;
      dom.defaultBowlerInput.value = defaultBowler;
    }
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
      const imported = payload.games.filter(isValidGame).map(normalizeGame);
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

  async function applyRemoteChanges({ upserts = [], deletes = [] } = {}) {
    for (const candidate of upserts) {
      if (!isValidGame(candidate)) continue;
      const game = normalizeGame(candidate);
      await putGame(game);
      await deleteTombstone(game.id);
    }
    for (const deletion of deletes) {
      const id = Number(deletion.id);
      const updatedAt = Number(deletion.updatedAt || Date.now());
      if (!Number.isFinite(id)) continue;
      await putTombstone({ id, updatedAt });
      await deleteGameRecord(id);
    }
    games = await getAllGames();
    renderAll();
  }

  function wireEvents() {
    dom.manualTab.addEventListener('click', () => setEntryMode(false));
    dom.photoTab.addEventListener('click', () => setEntryMode(true));
    dom.scoreboardPhoto.addEventListener('change', handlePhotoSelection);
    dom.clearPhotoBtn.addEventListener('click', () => clearPhoto());
    dom.saveGameBtn.addEventListener('click', saveGameFromForm);
    dom.cancelEditBtn.addEventListener('click', () => {
      resetEntryForm({ preserveBowler: true, preserveDate: true, preserveSession: true });
      setStatus(dom.entryStatus, 'Edit cancelled.');
    });
    dom.bowlerFilter.addEventListener('change', () => { renderStats(); renderHistory(); });
    dom.sortFilter.addEventListener('change', renderHistory);

    dom.score.addEventListener('input', () => {
      if (Number(dom.score.value) === 300) {
        dom.strikes.value = '12';
        dom.strikeOpp.value = '12';
        dom.openFrames.value = '0';
      }
    });
    dom.strikes.addEventListener('input', () => {
      const strikes = Number(dom.strikes.value || 0);
      if (strikes > Number(dom.strikeOpp.value || 0)) dom.strikeOpp.value = String(Math.min(12, strikes));
    });

    [dom.score, dom.openFrames, dom.strikes, dom.strikeOpp, dom.notes].forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') saveGameFromForm();
      });
    });

    dom.openSettingsBtn.addEventListener('click', () => dom.settingsDialog.showModal());
    dom.closeSettingsBtn.addEventListener('click', () => dom.settingsDialog.close());
    dom.settingsDialog.addEventListener('click', (event) => {
      if (event.target === dom.settingsDialog) dom.settingsDialog.close();
    });
    dom.saveDefaultBowlerBtn.addEventListener('click', async () => {
      const name = dom.defaultBowlerInput.value.trim();
      await setSetting('defaultBowler', name);
      if (name) dom.bowler.value = name;
      setStatus(dom.settingsStatus, name ? 'Default bowler saved.' : 'Default bowler cleared.', 'success');
      window.dispatchEvent(new CustomEvent('bowling:profile-options-changed'));
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
    getBowlerNames: () => [...new Set(games.map((g) => g.bowler).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    getDefaultBowler: () => getSetting('defaultBowler'),
    getLeaderboardSummary: (bowlerName) => clone(leaderboardSummaryForBowler(bowlerName)),
    applyRemoteChanges,
    renderAll,
    formatDate: fmtDate
  };
  window.BowlingApp = api;

  async function init() {
    dom.date.value = todayLocal();
    setEntryMode(false);
    wireEvents();

    if (!('indexedDB' in window)) {
      setStatus(dom.entryStatus, 'This browser does not provide IndexedDB, so persistent storage is unavailable.', 'error');
      dom.saveGameBtn.disabled = true;
      window.dispatchEvent(new CustomEvent('bowling:ready', { detail: { ok: false } }));
      return;
    }

    try {
      db = await openDatabase();
      games = await getAllGames();
      await loadDefaultBowler();
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
