(() => {
  'use strict';

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

  function profileIcon(kind) {
    const paths = {
      ball: '<circle cx="12" cy="12" r="9"/><circle cx="11" cy="7" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="10" cy="11" r="1"/>',
      alley: '<path d="M12 22S4 14 4 9a8 8 0 1 1 16 0c0 5-8 13-8 13Z"/><circle cx="12" cy="9" r="3"/>',
      groups: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6m2 4a7 7 0 0 1 3 7"/>',
      transfer: '<path d="M3 7h18m-5-5 5 5-5 5M21 17H3m5-5-5 5 5 5"/>',
      settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>'
    };
    return `<svg class="row-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[kind]}</svg>`;
  }

  function profileMarkup() {
    return `
      <div class="page-heading"><h2 id="profileHeading">Profile</h2></div>
      <section class="panel profile-hero" aria-labelledby="profileNameSummary">
        <div class="profile-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M3 23v-3a9 9 0 0 1 18 0v3z"/></svg></div>
        <div class="profile-person"><strong id="profileNameSummary">Bowler</strong><small id="profileScopeSummary">Saved on this device</small><div id="profileIdentitySlot"></div></div>
      </section>
      <section class="panel profile-group"><h3 class="eyebrow">BOWLING SETUP</h3>
      <details class="profile-row"><summary>${profileIcon('ball')}<span id="ballInventoryHeading">Ball inventory</span></summary><div class="profile-row-content">
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
      </div></details>


      <details class="profile-row"><summary>${profileIcon('alley')}<span id="alleyInventoryHeading">Alleys</span></summary><div class="profile-row-content">
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
      </div></details>


      </section>
      <section class="panel profile-group" aria-labelledby="profileSettingsHeading"><h3 id="profileSettingsHeading" class="eyebrow">ACCOUNT</h3><div id="profileActionButtons" class="profile-actions"></div><button id="profileGroupsBtn" class="profile-link" type="button">${profileIcon('groups')}Bowling groups<span aria-hidden="true">›</span></button></section>
      <section class="panel profile-group"><h3 class="eyebrow">DATA</h3><div id="profileDataActions" class="profile-actions"></div><button id="profileImportExportBtn" class="profile-link" type="button">${profileIcon('transfer')}Import / Export<span aria-hidden="true">›</span></button></section>
      <section class="panel profile-group"><h3 class="eyebrow">APP</h3>
        <details class="profile-row"><summary>${profileIcon('settings')}Settings</summary><div class="profile-row-content">
          <div class="profile-summary-grid"><div class="profile-summary-card"><span>Average</span><strong id="profileAverageSummary">—</strong><small id="profileAverageDetail"></small></div><div class="profile-summary-card"><span>Goal average</span><strong id="profileGoalSummary">Not set</strong><small id="profileGoalProgress"></small></div></div>
      <div aria-labelledby="goalAverageHeading">
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
      </div>

        </div></details>
        <details class="profile-row"><summary>${profileIcon('info')}About / Version</summary><div id="profileAbout" class="profile-row-content"><p class="section-copy">Bowling Tracker · Your games, wherever you bowl.</p></div></details>
        <div id="profileInstallAction"></div>
      </section>
    `;
  }

  function ensureProfileUI() {
    const nav = document.querySelector('.topbar');
    const main = $('mainContent');
    if (!nav || !main) return false;

    if (!$(NAV_ID)) {
      const button = document.createElement('button');
      button.id = NAV_ID;
      button.type = 'button';
      button.dataset.goView = 'profile';
      button.setAttribute('aria-controls', VIEW_ID);
      button.className = 'profile-trigger';
      button.setAttribute('aria-label', 'Open profile and settings');
      button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span id="headerProfileName">Profile</span><span id="headerSyncNotice" class="sync-attention" aria-label="Sync needs attention" hidden>!</span><span aria-hidden="true">⌄</span>';
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
      const identity = $('profileIdentity');
      if (identity) { identity.hidden = false; $('profileIdentitySlot').appendChild(identity); }
      const footer = document.querySelector('footer');
      if (footer) $('profileAbout').appendChild(footer);
      $('profileGroupsBtn').addEventListener('click', () => {
        $('openCloudBtn').click();
        const target = window.BowlingCloud?.isSignedIn?.() ? $('bowlingGroupSettings') : $('cloudEmailInput');
        if (target?.getClientRects().length) { target.scrollIntoView({block:'center'}); target.focus({preventScroll:true}); }
      });
      $('profileImportExportBtn').addEventListener('click', () => {
        $('openSettingsBtn').click();
        $('backupSettings')?.scrollIntoView({block:'center'}); $('backupSettings')?.focus({preventScroll:true});
      });
    }

    moveSettingsButtons();
    ensureHistoryHelp();
    const menu = $('profileMenu');
    if (menu) menu.hidden = true;
    return true;
  }

  function moveSettingsButtons() {
    for (const [id, target] of [['openCloudBtn','profileActionButtons'], ['openSettingsBtn','profileDataActions'], ['installBtn','profileInstallAction']]) {
      const button = $(id), container = $(target);
      if (!button || !container) continue;
      if (id === 'openSettingsBtn') button.textContent = 'Data & backups';
      if (button.parentElement !== container) container.appendChild(button);
    }
  }

  function showProfile() {
    ensureProfileUI();
    document.querySelectorAll('.app-view').forEach(panel => { panel.hidden = panel.id !== VIEW_ID; });
    document.querySelectorAll('.app-nav [data-go-view]').forEach(button => {
      if (button.dataset.goView === 'profile') button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $(NAV_ID)?.setAttribute('aria-current', 'page');
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
    const slot = $('historyHelpSlot');
    if (slot) slot.appendChild(details); else anchor.before(details);
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
    const games = standardGames();
    const average = games.length ? games.reduce((sum, game) => sum + Number(game.score), 0) / games.length : null;
    const goal = readGoal();
    const name = app()?.getProfileName?.() || 'Bowler';
    const scope = app()?.getLocalScopeInfo?.();

    $('profileNameSummary').textContent = name;
    const account = window.BowlingCloud?.getAccount?.();
    $('profileScopeSummary').textContent = scope?.kind === 'user'
      ? (account?.uid === scope.uid ? account.email || 'Signed in' : 'Saved account profile') : 'Local profile';
    if ($('headerProfileName')) $('headerProfileName').textContent = name;
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

    list.querySelectorAll('.session-card').forEach(card => {
      const badges = card.querySelector('.session-badges');
      if (!badges) return;
      const visible = [...card.querySelectorAll('.game-row')]
        .map(row => byId.get(Number(row.querySelector('.game-actions-toggle')?.dataset.id)))
        .filter(game => game && game.noTap !== true);
      let status = badges.querySelector('.session-average-status');
      if (average === null || visible.length < 2) { status?.remove(); return; }
      const sessionAverage = visible.reduce((sum, game) => sum + Number(game.score), 0) / visible.length;
      if (!status) { status = document.createElement('span'); badges.appendChild(status); }
      const direction = sessionAverage > average ? 'above' : sessionAverage < average ? 'below' : 'at-average';
      status.className = `badge session-average-status ${direction}`;
      status.textContent = direction === 'above' ? 'Above average' : direction === 'below' ? 'Below average' : 'At average';
      status.title = `Session average: ${sessionAverage.toFixed(1)} · Current average: ${average.toFixed(1)}`;
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
    item.className = 'home-goal';
    item.dataset.goalRecap = 'true';
    item.innerHTML = `<strong>${goal.toFixed(1)}</strong><span>${average === null ? 'Goal average' : average >= goal ? 'Goal reached' : `${(goal - average).toFixed(1)} pins to goal`}</span>`;
    recap.appendChild(item);
  }

  function refresh() {
    if (!ensureProfileUI()) return;
    renderProfile();
    renderHomeGoal();
    renderGameBenchmarks();
  }

  window.addEventListener('bowling:history-rendered', renderGameBenchmarks);
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
