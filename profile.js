(() => {
  'use strict';

  const STYLE_ID = 'bowling-profile-goal-styles';
  const VIEW_ID = 'view-profile';
  const NAV_ID = 'nav-profile';
  let goalInputDirty = false;
  let inventoryEditName = '';
  let inventorySignature = '';
  let alleyInventoryEditName = '';
  let alleyInventorySignature = '';

  const $ = id => document.getElementById(id);
  const app = () => window.BowlingApp;

  function scopeKey() {
    const info = app()?.getLocalScopeInfo?.();
    return String(info?.dbName || info?.uid || 'guest').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  function goalStorageKey() {
    return `bowling-goal-average:${scopeKey()}`;
  }

  function readGoal() {
    try {
      const value = Number(localStorage.getItem(goalStorageKey()));
      return Number.isFinite(value) && value > 0 && value <= 300 ? value : null;
    } catch (_) {
      return null;
    }
  }

  function writeGoal(value) {
    try {
      if (value === null) localStorage.removeItem(goalStorageKey());
      else localStorage.setItem(goalStorageKey(), String(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function standardGames() {
    return (app()?.getGames?.() || []).filter(game => game?.noTap !== true && Number.isFinite(Number(game?.score)));
  }

  function currentAverage() {
    const games = standardGames();
    return games.length ? games.reduce((sum, game) => sum + Number(game.score), 0) / games.length : null;
  }

  function installStyles() {
    if ($(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .app-nav { grid-template-columns: repeat(5, minmax(0, 1fr)); }
      .profile-summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .profile-summary-card { min-width: 0; padding: 16px; border: 1px solid var(--line); border-radius: 16px; background: #0e1727; display: grid; gap: 7px; }
      .profile-summary-card span { color: var(--muted); font-size: .78rem; }
      .profile-summary-card strong { font-size: 1.45rem; overflow-wrap: anywhere; }
      .profile-summary-card small { color: var(--muted); line-height: 1.35; }
      .profile-goal-row { display: grid; grid-template-columns: minmax(0, 240px) auto auto; gap: 10px; align-items: end; }
      .profile-goal-row label { min-width: 0; }
      .profile-goal-row .btn { white-space: nowrap; }
      .profile-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .profile-actions .btn { min-width: 150px; }
      .goal-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
      .goal-help { position: relative; flex-shrink: 0; }
      .goal-help > summary { list-style: none; width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 999px; display: grid; place-items: center; cursor: pointer; color: var(--accent-2); background: var(--panel-2); font-weight: 900; }
      .goal-help > summary::-webkit-details-marker { display: none; }
      .goal-help-copy { margin-top: 10px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: #0d1524; color: var(--muted); font-size: .82rem; line-height: 1.5; }
      .goal-color-legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .goal-color-chip { border-radius: 999px; padding: 6px 10px; border: 1px solid var(--line); font-size: .75rem; font-weight: 800; }
      .goal-color-chip.good { color: var(--accent-2); border-color: #315b50; background: var(--success-bg); }
      .goal-color-chip.bad { color: var(--danger); border-color: #6b3038; background: var(--danger-bg); }
      .goal-color-chip.neutral { color: var(--muted); }
      .game-average-status { display: block; margin-top: 4px; font-size: .72rem; font-weight: 750; line-height: 1.2; }
      .game-average-status.above { color: var(--accent-2); }
      .game-average-status.below { color: var(--danger); }
      .game-average-status.at-average { color: var(--muted); }
      .history-color-help { margin: 8px 0 12px; }
      .history-color-help > summary { width: fit-content; min-height: 36px; display: inline-flex; align-items: center; gap: 7px; color: var(--muted); cursor: pointer; font-size: .78rem; font-weight: 700; }
      .history-color-help .help-mark { width: 22px; height: 22px; display: inline-grid; place-items: center; border: 1px solid var(--line); border-radius: 999px; color: var(--accent-2); }
      .history-color-help p { margin-top: 6px; color: var(--muted); font-size: .78rem; line-height: 1.45; }
      @media (max-width: 700px) {
        .app-nav button { font-size: .68rem; }
        .profile-summary-grid { grid-template-columns: 1fr 1fr; }
        .profile-summary-card:first-child { grid-column: 1 / -1; }
        .profile-goal-row { grid-template-columns: 1fr 1fr; }
        .profile-goal-row label { grid-column: 1 / -1; }
        .profile-goal-row .btn { width: 100%; }
      }
      @media (max-width: 380px) {
        .app-nav button { font-size: .63rem; }
        .profile-summary-grid { grid-template-columns: 1fr; }
        .profile-summary-card:first-child { grid-column: auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function profileMarkup() {
    return `
      <section class="panel" aria-labelledby="profileHeading">
        <div class="section-heading">
          <div><p class="eyebrow">YOUR PROFILE</p><h2 id="profileHeading">Profile</h2><p class="section-copy">Your account, equipment, and goals.</p></div>
        </div>
        <div class="profile-summary-grid">
          <div class="profile-summary-card"><span>Bowler</span><strong id="profileNameSummary">Bowler</strong><small id="profileScopeSummary">Current local profile</small></div>
          <div class="profile-summary-card"><span>Average</span><strong id="profileAverageSummary">—</strong><small id="profileAverageDetail">No games yet</small></div>
          <div class="profile-summary-card"><span>Goal average</span><strong id="profileGoalSummary">Not set</strong><small id="profileGoalProgress">Uses running average for game colors</small></div>
        </div>
      </section>



      <section class="panel" aria-labelledby="ballInventoryHeading">
        <div class="section-heading"><div><p class="eyebrow">YOUR EQUIPMENT</p><h2 id="ballInventoryHeading">Ball inventory</h2><p class="section-copy">Choose from these balls when adding a game or series.</p></div></div>
        <form id="ballInventoryForm" class="inventory-form">
          <label>Ball name<input id="inventoryBallName" type="text" maxlength="100" required placeholder="e.g. Storm Concept" autocomplete="off"></label>
          <button id="saveInventoryBall" class="btn primary" type="submit">Add ball</button>
          <button id="cancelInventoryEdit" class="text-btn" type="button" hidden>Cancel</button>
        </form>
        <p id="inventoryEmpty" class="field-help">No balls added yet.</p>
        <ul id="ballInventoryList" class="inventory-list" aria-label="Your bowling balls"></ul>
        <p class="field-help">Renaming or removing a ball keeps past game tags unchanged.</p>
        <p id="inventorySyncNote" class="field-help"></p>
        <p id="inventoryStatus" class="status-text" role="status"></p>
      </section>

      <section class="panel" aria-labelledby="alleyInventoryHeading">
        <div class="section-heading"><div><p class="eyebrow">YOUR LOCATIONS</p><h2 id="alleyInventoryHeading">Alleys</h2><p class="section-copy">Choose from these alleys when adding a game or series.</p></div></div>
        <form id="alleyInventoryForm" class="inventory-form">
          <label>Alley name<input id="alleyInventoryAlleyName" type="text" maxlength="100" required placeholder="e.g. Bowlero Pasadena" autocomplete="off"></label>
          <button id="saveAlleyInventoryAlley" class="btn primary" type="submit">Add alley</button>
          <button id="cancelAlleyInventoryEdit" class="text-btn" type="button" hidden>Cancel</button>
        </form>
        <p id="alleyInventoryEmpty" class="field-help">No alleys added yet.</p>
        <ul id="alleyInventoryList" class="inventory-list" aria-label="Your bowling alleys"></ul>
        <p class="field-help">Renaming or removing an alley keeps past game tags unchanged.</p>
        <p id="alleyInventorySyncNote" class="field-help"></p>
        <p id="alleyInventoryStatus" class="status-text" role="status"></p>
      </section>

      <section class="panel" aria-labelledby="goalAverageHeading">
        <div class="goal-heading">
          <div><p class="eyebrow">AVERAGE TARGET</p><h2 id="goalAverageHeading">Goal average</h2><p class="section-copy">Set the average you are working toward.</p></div>
          <details class="goal-help">
            <summary aria-label="How goal average changes game colors">?</summary>
            <div class="goal-help-copy">Green means at or above your goal; red means below. Without a goal, colors compare games with your running average. No-tap games are excluded. This goal is saved only on this device.</div>
          </details>
        </div>
        <div class="profile-goal-row">
          <label><span>Goal average</span><input id="goalAverageInput" type="number" min="1" max="300" step="0.1" inputmode="decimal" placeholder="175"><small class="field-help">Optional · 1–300</small></label>
          <button id="saveGoalAverageBtn" class="btn primary" type="button">Save goal</button>
          <button id="clearGoalAverageBtn" class="btn secondary" type="button">Remove goal</button>
        </div>
        <div class="goal-color-legend" aria-label="Game color legend">
          <span id="goalGreenLegend" class="goal-color-chip good">Green · Above average</span>
          <span id="goalRedLegend" class="goal-color-chip bad">Red · Below average</span>
          <span id="goalNeutralLegend" class="goal-color-chip neutral">Neutral · At average</span>
        </div>
        <p id="goalAverageStatus" class="status-text" aria-live="polite"></p>
      </section>

      <section class="panel" aria-labelledby="profileSettingsHeading">
        <div class="section-heading"><div><p class="eyebrow">ACCOUNT & APP</p><h2 id="profileSettingsHeading">Account & backups</h2></div></div>
        <div id="profileActionButtons" class="profile-actions"></div>
      </section>
    `;
  }

  function ensureProfileUI() {
    installStyles();
    const nav = document.querySelector('.app-nav');
    const main = $('mainContent');
    if (!nav || !main) return false;

    if (!$(NAV_ID)) {
      const button = document.createElement('button');
      button.id = NAV_ID;
      button.type = 'button';
      button.dataset.goView = 'profile';
      button.setAttribute('aria-controls', VIEW_ID);
      button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>Profile';
      button.addEventListener('click', showProfile);
      nav.appendChild(button);
    }

    if (!$(VIEW_ID)) {
      const view = document.createElement('div');
      view.id = VIEW_ID;
      view.className = 'app-view';
      view.setAttribute('role', 'region');
      view.setAttribute('aria-label', 'Profile');
      view.hidden = true;
      view.innerHTML = profileMarkup();
      main.appendChild(view);

      $('goalAverageInput').addEventListener('input', () => { goalInputDirty = true; });
      $('goalAverageInput').addEventListener('keydown', event => { if (event.key === 'Enter') saveGoal(); });
      $('saveGoalAverageBtn').addEventListener('click', saveGoal);
      $('clearGoalAverageBtn').addEventListener('click', clearGoal);
      $('alleyInventoryForm').addEventListener('submit', saveAlleyInventoryAlley);
      $('cancelAlleyInventoryEdit').addEventListener('click', resetAlleyInventoryEditor);
      $('ballInventoryForm').addEventListener('submit', saveInventoryBall);
      $('cancelInventoryEdit').addEventListener('click', resetInventoryEditor);
    }

    moveSettingsButtons();
    ensureHistoryHelp();
    const menu = $('profileMenu');
    if (menu) menu.hidden = true;
    const edit = $('editProfileBtn');
    if (edit && edit.dataset.profileRoute !== 'true') {
      edit.dataset.profileRoute = 'true';
      edit.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        showProfile();
      }, true);
    }
    return true;
  }

  function moveSettingsButtons() {
    const actions = $('profileActionButtons');
    if (!actions) return;
    const cloud = $('openCloudBtn');
    const settings = $('openSettingsBtn');
    const install = $('installBtn');
    if (cloud && cloud.parentElement !== actions) actions.appendChild(cloud);
    if (settings) {
      settings.textContent = 'Data & backups';
      if (settings.parentElement !== actions) actions.appendChild(settings);
    }
    if (install && install.parentElement !== actions) actions.appendChild(install);
  }

  function showProfile() {
    ensureProfileUI();
    document.querySelectorAll('.app-view').forEach(panel => { panel.hidden = panel.id !== VIEW_ID; });
    document.querySelectorAll('.app-nav [data-go-view]').forEach(button => {
      if (button.dataset.goView === 'profile') button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const menu = $('profileMenu');
    if (menu) menu.open = false;
    renderProfile(true);
    $('mainContent')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function ensureHistoryHelp() {
    if ($('historyColorHelp')) return;
    const anchor = $('historyActionStatus');
    if (!anchor) return;
    const details = document.createElement('details');
    details.id = 'historyColorHelp';
    details.className = 'history-color-help';
    details.innerHTML = '<summary>Game color coding <span class="help-mark" aria-hidden="true">?</span></summary><p id="historyColorHelpCopy"></p>';
    anchor.before(details);
  }

  function saveGoal() {
    const input = $('goalAverageInput');
    const raw = String(input?.value || '').trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value <= 0 || value > 300) {
      setGoalStatus('Enter a goal average from 1 to 300.', 'error');
      input?.focus();
      return;
    }
    const normalized = Math.round(value * 10) / 10;
    if (!writeGoal(normalized)) {
      setGoalStatus('This browser could not save the goal average.', 'error');
      return;
    }
    goalInputDirty = false;
    setGoalStatus(`Goal average saved at ${normalized.toFixed(1)}. Game colors now compare against this goal.`, 'success');
    renderProfile(true);
    renderGameBenchmarks();
    renderHomeGoal();
  }

  function clearGoal() {
    if (!writeGoal(null)) {
      setGoalStatus('This browser could not remove the goal average.', 'error');
      return;
    }
    goalInputDirty = false;
    setGoalStatus('Goal removed. Game colors now compare against your current running average.', 'success');
    renderProfile(true);
    renderGameBenchmarks();
    renderHomeGoal();
  }

  function setGoalStatus(message, type = '') {
    const status = $('goalAverageStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.remove('success', 'error');
    if (type) status.classList.add(type);
  }

  function renderProfile(forceInput = false) {
    if (!ensureProfileUI()) return;
    renderInventory();
    renderAlleyInventory();
    const average = currentAverage();
    const goal = readGoal();
    const games = standardGames();
    const name = app()?.getProfileName?.() || 'Bowler';
    const scope = app()?.getLocalScopeInfo?.();

    $('profileNameSummary').textContent = name;
    $('profileScopeSummary').textContent = scope?.kind === 'user' ? 'Signed-in profile on this device' : 'Local profile on this device';
    $('profileAverageSummary').textContent = average === null ? '—' : average.toFixed(1);
    $('profileAverageDetail').textContent = games.length ? `${games.length} game${games.length === 1 ? '' : 's'}` : 'No games yet';
    $('profileGoalSummary').textContent = goal === null ? 'Not set' : goal.toFixed(1);

    if (goal === null) {
      $('profileGoalProgress').textContent = 'Game colors use your running average';
    } else if (average === null) {
      $('profileGoalProgress').textContent = 'Add games to track progress';
    } else {
      const delta = average - goal;
      $('profileGoalProgress').textContent = delta >= 0
        ? `Goal reached · ${Math.abs(delta).toFixed(1)} pins above`
        : `${Math.abs(delta).toFixed(1)} pins to goal`;
    }

    if (forceInput || !goalInputDirty) $('goalAverageInput').value = goal === null ? '' : String(goal);
    $('clearGoalAverageBtn').disabled = goal === null;
    $('goalGreenLegend').textContent = goal === null ? 'Green · Above average' : 'Green · At/above goal';
    $('goalRedLegend').textContent = goal === null ? 'Red · Below average' : 'Red · Below goal';
    $('goalNeutralLegend').textContent = goal === null ? 'Neutral · At average' : `Benchmark · Goal ${goal.toFixed(1)}`;

    const help = $('historyColorHelpCopy');
    if (help) {
      help.textContent = goal === null
        ? `Green means a standard game is above your current running average${average === null ? '' : ` (${average.toFixed(1)})`}; red means below it. Set a Goal average in Profile to use a fixed target instead. No-tap games are excluded.`
        : `Your Goal average (${goal.toFixed(1)}) is the color benchmark: at/above goal is green and below goal is red. Your current running average${average === null ? ' is not available yet' : ` is ${average.toFixed(1)}`}. No-tap games are excluded.`;
    }
  }

  function resetInventoryEditor() {
    inventoryEditName = '';
    $('inventoryBallName').value = '';
    $('saveInventoryBall').textContent = 'Add ball';
    $('cancelInventoryEdit').hidden = true;
  }

  async function saveInventoryBall(event) {
    event.preventDefault();
    const scope = scopeKey();
    const editing = !!inventoryEditName;
    $('saveInventoryBall').disabled = true;
    try {
      await app().editBallInventory($('inventoryBallName').value, inventoryEditName);
      if (scope !== scopeKey()) return;
      resetInventoryEditor();
      $('inventoryStatus').textContent = editing ? 'Ball renamed. Past games keep their original ball name.' : 'Ball added to your inventory.';
      $('inventoryBallName').focus();
    } catch (error) {
      if (scope === scopeKey()) $('inventoryStatus').textContent = error.message;
    } finally { $('saveInventoryBall').disabled = !app()?.ready; }
  }

  function renderInventory() {
    $('saveInventoryBall').disabled = !app()?.ready;
    $('inventorySyncNote').textContent = window.BowlingCloud?.isSignedIn?.()
      ? 'Syncs with your account when online.'
      : 'Saved on this device. Sign in to sync.';
    const rows = (app()?.getBallInventory?.() || []).filter(row => !row.removed);
    const signature = JSON.stringify([scopeKey(), rows]);
    if (inventorySignature === signature) return;
    inventorySignature = signature;
    $('inventoryEmpty').hidden = rows.length > 0;
    const list = $('ballInventoryList');
    list.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('li');
      const name = document.createElement('strong'); name.textContent = row.name; item.appendChild(name);
      const actions = document.createElement('div'); actions.className = 'inventory-actions'; item.appendChild(actions);
      const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'text-btn'; rename.textContent = 'Rename';
      rename.setAttribute('aria-label', `Rename ${row.name}`);
      rename.addEventListener('click', () => {
        inventoryEditName = row.name; $('inventoryBallName').value = row.name;
        $('saveInventoryBall').textContent = 'Save name'; $('cancelInventoryEdit').hidden = false;
        $('inventoryStatus').textContent = ''; $('inventoryBallName').focus();
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-btn danger-text'; remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${row.name}`);
      remove.addEventListener('click', async () => {
        const scope = scopeKey(); remove.disabled = true;
        try {
          await app().editBallInventory(row.name, '', true);
          if (scope !== scopeKey()) return;
          if (inventoryEditName === row.name) resetInventoryEditor();
          $('inventoryStatus').textContent = 'Ball removed from inventory. Past games are unchanged.';
        } catch (error) { if (scope === scopeKey()) $('inventoryStatus').textContent = error.message; }
        finally { remove.disabled = false; }
      });
      actions.append(rename, remove); list.appendChild(item);
    }
  }

  function resetAlleyInventoryEditor() {
    alleyInventoryEditName = '';
    $('alleyInventoryAlleyName').value = '';
    $('saveAlleyInventoryAlley').textContent = 'Add alley';
    $('cancelAlleyInventoryEdit').hidden = true;
  }

  async function saveAlleyInventoryAlley(event) {
    event.preventDefault();
    const scope = scopeKey();
    const editing = !!alleyInventoryEditName;
    $('saveAlleyInventoryAlley').disabled = true;
    try {
      await app().editAlleyInventory($('alleyInventoryAlleyName').value, alleyInventoryEditName);
      if (scope !== scopeKey()) return;
      resetAlleyInventoryEditor();
      $('alleyInventoryStatus').textContent = editing ? 'Alley renamed. Past games keep their original alley name.' : 'Alley added to your alley list.';
      $('alleyInventoryAlleyName').focus();
    } catch (error) {
      if (scope === scopeKey()) $('alleyInventoryStatus').textContent = error.message;
    } finally { $('saveAlleyInventoryAlley').disabled = !app()?.ready; }
  }

  function renderAlleyInventory() {
    $('saveAlleyInventoryAlley').disabled = !app()?.ready;
    $('alleyInventorySyncNote').textContent = window.BowlingCloud?.isSignedIn?.()
      ? 'Syncs with your account when online.'
      : 'Saved on this device. Sign in to sync.';
    const rows = (app()?.getAlleyInventory?.() || []).filter(row => !row.removed);
    const signature = JSON.stringify([scopeKey(), rows]);
    if (alleyInventorySignature === signature) return;
    alleyInventorySignature = signature;
    $('alleyInventoryEmpty').hidden = rows.length > 0;
    const list = $('alleyInventoryList');
    list.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('li');
      const name = document.createElement('strong'); name.textContent = row.name; item.appendChild(name);
      const actions = document.createElement('div'); actions.className = 'inventory-actions'; item.appendChild(actions);
      const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'text-btn'; rename.textContent = 'Rename';
      rename.setAttribute('aria-label', `Rename ${row.name}`);
      rename.addEventListener('click', () => {
        alleyInventoryEditName = row.name; $('alleyInventoryAlleyName').value = row.name;
        $('saveAlleyInventoryAlley').textContent = 'Save name'; $('cancelAlleyInventoryEdit').hidden = false;
        $('alleyInventoryStatus').textContent = ''; $('alleyInventoryAlleyName').focus();
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-btn danger-text'; remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${row.name}`);
      remove.addEventListener('click', async () => {
        const scope = scopeKey(); remove.disabled = true;
        try {
          await app().editAlleyInventory(row.name, '', true);
          if (scope !== scopeKey()) return;
          if (alleyInventoryEditName === row.name) resetAlleyInventoryEditor();
          $('alleyInventoryStatus').textContent = 'Alley removed from your alley list. Past games are unchanged.';
        } catch (error) { if (scope === scopeKey()) $('alleyInventoryStatus').textContent = error.message; }
        finally { remove.disabled = false; }
      });
      actions.append(rename, remove); list.appendChild(item);
    }
  }

  function renderGameBenchmarks() {
    const list = $('sessionsList');
    if (!list || !app()?.getGames) return;
    const allGames = app().getGames();
    const byId = new Map(allGames.map(game => [Number(game.id), game]));
    const standard = allGames.filter(game => game?.noTap !== true && Number.isFinite(Number(game?.score)));
    const average = standard.length ? standard.reduce((sum, game) => sum + Number(game.score), 0) / standard.length : null;
    const goal = readGoal();
    const benchmark = goal ?? average;

    list.querySelectorAll('.game-row').forEach(row => {
      const id = Number(row.querySelector('.game-actions-toggle')?.dataset.id);
      const game = byId.get(id);
      const info = row.querySelector('.game-row-info');
      if (!game || !info) return;
      let status = info.querySelector('.game-average-status');

      if (game.noTap === true || benchmark === null) {
        status?.remove();
        return;
      }
      if (!status) {
        status = document.createElement('span');
        info.appendChild(status);
      }

      const score = Number(game.score);
      if (goal !== null) {
        if (score >= goal) {
          status.className = 'game-average-status above';
          status.textContent = score === goal ? 'At goal' : 'Above goal';
        } else {
          status.className = 'game-average-status below';
          status.textContent = 'Below goal';
        }
        status.title = `Goal average: ${goal.toFixed(1)}${average === null ? '' : ` · Current average: ${average.toFixed(1)}`}`;
      } else if (score > average) {
        status.className = 'game-average-status above';
        status.textContent = 'Above average';
        status.title = `Current standard-game average: ${average.toFixed(1)}`;
      } else if (score < average) {
        status.className = 'game-average-status below';
        status.textContent = 'Below average';
        status.title = `Current standard-game average: ${average.toFixed(1)}`;
      } else {
        status.className = 'game-average-status at-average';
        status.textContent = 'At average';
        status.title = `Current standard-game average: ${average.toFixed(1)}`;
      }
    });
  }

  function renderHomeGoal() {
    const recap = $('homeRecap');
    if (!recap) return;
    recap.querySelector('[data-goal-recap]')?.remove();
    const goal = readGoal();
    if (goal === null) return;
    const average = currentAverage();
    const item = document.createElement('div');
    item.dataset.goalRecap = 'true';
    item.innerHTML = `<strong>${goal.toFixed(1)}</strong><span>${average === null ? 'Goal average' : average >= goal ? 'Goal reached' : `${(goal - average).toFixed(1)} pins to goal`}</span>`;
    recap.appendChild(item);
  }

  function refresh() {
    if (!ensureProfileUI()) return;
    renderProfile();
    renderHomeGoal();
    setTimeout(renderGameBenchmarks, 0);
  }

  window.addEventListener('bowling:ready', refresh);
  window.addEventListener('bowling:rendered', refresh);
  window.addEventListener('bowling:local-account-changed', () => {
    goalInputDirty = false;
    setGoalStatus('');
    refresh();
  });
  window.addEventListener('bowling:profile-options-changed', refresh);
  window.addEventListener('bowling:inventory-changed', refresh);
  window.addEventListener('bowling:alley-inventory-changed', refresh);
  window.addEventListener('bowling:local-account-changed', () => {
    resetInventoryEditor();
    resetAlleyInventoryEditor();
    $('alleyInventoryStatus').textContent = '';
    $('inventoryStatus').textContent = '';
    renderInventory();
    renderAlleyInventory();
  });
  window.addEventListener('storage', event => {
    if (event.key === goalStorageKey()) {
      goalInputDirty = false;
      refresh();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
})();
