(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const dialog = $('friendStatsDialog');
  let members = new Map();
  let context = null;
  let selectedUid = '';
  let comparing = false;
  let opener = null;

  const metrics = [
    { key: 'average', label: 'Average', digits: 1, better: 'higher' },
    { key: 'highGame', label: 'High game', better: 'higher' },
    { key: 'highSeries', label: 'High 3-game series', better: 'higher' },
    { key: 'strikePct', label: 'Strike %', digits: 1, suffix: '%', better: 'higher' },
    { key: 'games', label: 'Games', count: true },
    { key: 'sessions', label: 'Sessions', details: true, count: true },
    { key: 'last5', label: 'Last 5 average', details: true, digits: 1, better: 'higher' },
    { key: 'last10', label: 'Last 10 average', details: true, digits: 1, better: 'higher' },
    { key: 'last30', label: 'Last 30 average', details: true, digits: 1, better: 'higher' },
    { key: 'openAvg', label: 'Open frames / game', details: true, digits: 2, better: 'lower' },
    { key: 'cleanGames', label: 'Clean games', count: true },
    { key: 'cleanRate', label: 'Clean-game rate', digits: 1, suffix: '%', better: 'higher' },
    { key: 'totalStrikes', label: 'Total strikes', count: true },
    { key: 'strikesPerGame', label: 'Strikes / game', digits: 2, better: 'higher' },
    { key: 'games200', label: '200+ games', details: true, count: true },
    { key: 'games250', label: '250+ games', details: true, count: true },
    { key: 'games300', label: 'Perfect games', details: true, count: true },
    { key: 'bestSessionAvg', label: 'Best session average', digits: 1, better: 'higher' },
    { key: 'mostStrikes', label: 'Most strikes in a game', details: true, better: 'higher' },
    { key: 'bestStrikePct', label: 'Best strike % game', details: true, digits: 1, suffix: '%', better: 'higher' },
    { key: 'recent200', label: 'Most recent 200+ score', details: true }
  ];

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const currentDetails = member => member?.details && finite(member.updatedAt) !== null
    && member.details.updatedAt === member.updatedAt ? member.details : null;
  const hasCurrentAccount = () => context && window.BowlingApp?.ready
    && window.BowlingApp.getLocalScopeInfo().uid === context.uid;
  const needsStandardRefresh = member => Number(member?.noTapGames || 0) > 0
    && member.standardStatsUpdatedAt !== member.updatedAt;

  function metricValue(member, metric) {
    if (!member || needsStandardRefresh(member)) return null;
    const games = finite(member.games);
    if (!metric.count && !games) return null;
    const details = currentDetails(member);
    if (metric.key === 'highSeries' && (games < 3 || details?.hasSeries === false
      || (!details?.hasSeries && !member.highSeries))) return null;
    if (metric.key === 'cleanRate') return finite(member.cleanGames) === null ? null : member.cleanGames / games * 100;
    if (metric.key === 'strikesPerGame') return finite(member.totalStrikes) === null ? null : member.totalStrikes / games;
    return finite(metric.details ? details?.[metric.key] : member[metric.key]);
  }

  function formatValue(value, metric) {
    return value === null ? '—' : value.toFixed(metric.digits || 0) + (metric.suffix || '');
  }

  function comparisonDifference(mine, theirs, metric) {
    if (mine === null || theirs === null) return '';
    const delta = Number((mine - theirs).toFixed(metric.digits || 0));
    const label = delta === 0 ? 'Same' : (delta > 0 ? '+' : '') + delta.toFixed(metric.digits || 0) + (metric.suffix === '%' ? ' pp' : '');
    const favorable = metric.better && delta !== 0 && (metric.better === 'lower' ? delta < 0 : delta > 0);
    return `<span class="comparison-gap${favorable ? ' favorable' : ''}">${label}<span class="visually-hidden"> compared with this bowler</span></span>`;
  }

  function close() {
    if (dialog.open) dialog.close();
    selectedUid = '';
    comparing = false;
  }

  function clear() {
    close();
    members = new Map();
    context = null;
    opener = null;
    $('friendStatsContent').innerHTML = '';
    $('friendStatsName').textContent = '';
    $('friendStatsUpdated').textContent = '';
    $('friendStatsStatus').textContent = '';
    $('friendStatsNote').textContent = '';
  }

  function setMembers(rows, nextContext) {
    if (!nextContext?.uid || !nextContext.groupId) { clear(); return; }
    if (!context || context.uid !== nextContext.uid || context.groupId !== nextContext.groupId
      || context.revision !== nextContext.revision) clear();
    context = { ...nextContext };
    if (!hasCurrentAccount()) { clear(); return; }
    members = new Map(rows.filter(row => typeof row.uid === 'string' && row.uid).map(row => [row.uid, { ...row }]));
    if (selectedUid && !members.has(selectedUid)) close();
    if (dialog.open) render();
  }

  function open(uid, trigger = document.activeElement) {
    if (!hasCurrentAccount() || !members.has(uid)) return;
    selectedUid = uid;
    comparing = false;
    opener = trigger;
    render();
    if (selectedUid && !dialog.open) dialog.showModal();
  }

  function render() {
    if (!hasCurrentAccount() || !members.has(selectedUid)) { clear(); return; }
    const own = window.BowlingApp.getLeaderboardSummary();
    const self = selectedUid === context.uid;
    const member = self ? { ...members.get(selectedUid), ...own } : members.get(selectedUid);
    const name = String(member.displayName || 'Bowler');
    const needsRefresh = needsStandardRefresh(member);
    const count = needsRefresh ? null : finite(member.games);
    if (self) comparing = false;

    $('friendStatsName').textContent = self ? name + ' · You' : name;
    const updated = finite(member.updatedAt) === null ? null : new Date(member.updatedAt);
    $('friendStatsUpdated').textContent = self ? 'Your latest saved games' : updated && Number.isFinite(updated.getTime())
      ? 'Last shared ' + updated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Last shared time unavailable';
    $('friendStatsOnly').textContent = self ? 'Your stats' : 'Their stats';
    $('friendStatsOnly').setAttribute('aria-pressed', String(!comparing));
    $('friendStatsCompare').setAttribute('aria-pressed', String(comparing));
    $('friendStatsCompare').hidden = self;
    const sample = needsRefresh ? 'This bowler must open the updated app and sync to refresh standard-only stats.'
      : count === null ? 'Game count unavailable.' : count === 0 ? 'No standard games shared yet.' : `${count} standard game${count === 1 ? '' : 's'} shared.`;
    $('friendStatsStatus').textContent = (comparing ? 'Comparing overall stats. ' : '') + sample
      + (count !== null && count > 0 && count < 10 ? ' Fewer than 10 games: averages are provisional.' : '')
      + (comparing && own.games > 0 && own.games < 10 ? ' Your average is provisional: fewer than 10 games.' : '')
      + (!needsRefresh && Number(member.noTapGames || 0) > 0 ? ` ${Number(member.noTapGames)} no-tap games excluded.` : '')
      + (!navigator.onLine ? ' Offline · using the last loaded summary.' : '');

    if (comparing) {
      $('friendStatsContent').innerHTML = `<div class="friend-comparison-wrap"><table class="friend-comparison"><caption class="visually-hidden">All-time standard-game stats: you compared with ${escapeHtml(name)}</caption><thead><tr><th scope="col">Metric</th><th scope="col">You</th><th scope="col">${escapeHtml(name)}</th></tr></thead><tbody>${metrics.map(metric => {
        const mine = metricValue(own, metric), theirs = metricValue(member, metric);
        return `<tr><th scope="row">${metric.label}</th><td>${formatValue(mine, metric)}${comparisonDifference(mine, theirs, metric)}</td><td>${formatValue(theirs, metric)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    } else {
      $('friendStatsContent').innerHTML = `<div class="stats-grid friend-overview">${metrics.slice(0, 4).map(metric => `<article class="stat-card"><span class="stat-label">${metric.label}</span><strong class="stat-value">${formatValue(metricValue(member, metric), metric)}</strong></article>`).join('')}</div>
        <dl class="friend-metric-list">${metrics.slice(4).map(metric => `<div><dt>${metric.label}</dt><dd>${formatValue(metricValue(member, metric), metric)}</dd></div>`).join('')}</dl>`;
    }
    const missing = !currentDetails(member);
    const recentCount = comparing ? 'Recent averages use up to 5, 10, or 30 games per bowler; compare the game counts above. ' : 'Recent averages use up to 5, 10, or 30 saved games. ';
    $('friendStatsNote').textContent = (comparing ? 'Your column uses your latest saved games. Differences are yours minus theirs; pp means percentage points. ' : '')
      + recentCount + (missing ? 'Additional stats will appear after this bowler opens the updated app and syncs. ' : '') + '— means no result is available.';
  }

  $('leaderboardBody').addEventListener('click', event => {
    const button = event.target.closest('button[data-member-uid]');
    if (button) open(button.dataset.memberUid, button);
  });
  $('closeFriendStats').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    selectedUid = '';
    comparing = false;
    if (opener?.isConnected) opener.focus();
    opener = null;
  });
  $('friendStatsOnly').addEventListener('click', () => { comparing = false; render(); });
  $('friendStatsCompare').addEventListener('click', () => { comparing = true; render(); });
  window.addEventListener('bowling:local-account-changed', clear);
  window.addEventListener('bowling:rendered', () => { if (dialog.open) render(); });
  window.addEventListener('offline', () => { if (dialog.open) render(); });
  window.addEventListener('online', () => { if (dialog.open) render(); });

  window.BowlingFriends = { setMembers, clear, open };
})();

(() => {
  'use strict';

  const OPPORTUNITIES = ['10', '11', '12'];
  const STYLE_ID = 'bowling-user-suggestions-style';

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .game-average-status { display: block; margin-top: 4px; font-size: .72rem; font-weight: 750; line-height: 1.2; }
      .game-average-status.above { color: var(--accent-2); }
      .game-average-status.below { color: var(--danger); }
      .game-average-status.at-average { color: var(--muted); }
    `;
    document.head.appendChild(style);
  }

  function syncOpportunitySelect(source) {
    if (!source) return;
    const select = source._strikeOpportunitySelect;
    if (!select) return;
    const value = OPPORTUNITIES.includes(String(source.value)) ? String(source.value) : '10';
    if (select.value !== value) select.value = value;
  }

  function enhanceOpportunityInput(source) {
    if (!source) return;
    if (source.dataset.opportunityDropdown === 'true') {
      syncOpportunitySelect(source);
      return;
    }

    const select = document.createElement('select');
    select.className = 'strike-opportunity-select';
    select.innerHTML = OPPORTUNITIES.map(value => `<option value="${value}">${value}</option>`).join('');
    if (source.id) select.id = `${source.id}Select`;

    source.dataset.opportunityDropdown = 'true';
    source._strikeOpportunitySelect = select;
    source.type = 'hidden';
    source.insertAdjacentElement('afterend', select);

    const rangeHint = source.closest('label')?.querySelector('span small');
    if (rangeHint?.textContent.trim() === '10–12') rangeHint.remove();

    select.addEventListener('change', () => {
      source.value = select.value;
      source.dispatchEvent(new Event('input', { bubbles: true }));
      source.dispatchEvent(new Event('change', { bubbles: true }));
    });
    syncOpportunitySelect(source);
  }

  function enhanceOpportunityInputs() {
    document.querySelectorAll('#strikeOppInput, [data-field="strikeOpp"]').forEach(enhanceOpportunityInput);
  }

  function syncOpportunitySelects() {
    document.querySelectorAll('[data-opportunity-dropdown="true"]').forEach(syncOpportunitySelect);
  }

  function renderAverageStatuses() {
    const app = window.BowlingApp;
    const list = document.getElementById('sessionsList');
    if (!app?.getGames || !list) return;

    const allGames = app.getGames();
    const standardGames = allGames.filter(game => game?.noTap !== true && Number.isFinite(Number(game?.score)));
    const average = standardGames.length
      ? standardGames.reduce((sum, game) => sum + Number(game.score), 0) / standardGames.length
      : null;
    const byId = new Map(allGames.map(game => [Number(game.id), game]));

    list.querySelectorAll('.game-row').forEach(row => {
      const id = Number(row.querySelector('.game-actions-toggle')?.dataset.id);
      const game = byId.get(id);
      const infoBlock = row.querySelector('.game-row-info');
      if (!game || !infoBlock) return;

      const existing = infoBlock.querySelector('.game-average-status');
      if (game.noTap === true || average === null) {
        existing?.remove();
        return;
      }

      let status = existing;
      if (!status) {
        status = document.createElement('span');
        status.className = 'game-average-status';
        infoBlock.appendChild(status);
      }

      const score = Number(game.score);
      let className = 'game-average-status';
      let text = 'At average';
      if (score > average) {
        className += ' above';
        text = 'Above average';
      } else if (score < average) {
        className += ' below';
        text = 'Below average';
      } else {
        className += ' at-average';
      }
      status.className = className;
      status.textContent = text;
      status.title = `Current standard-game average: ${average.toFixed(1)}`;
    });
  }

  function refreshSuggestions() {
    installStyles();
    enhanceOpportunityInputs();
    syncOpportunitySelects();
    renderAverageStatuses();
  }

  const observer = new MutationObserver(() => {
    enhanceOpportunityInputs();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('input', event => {
    if (event.target.matches('#scoreInput, #strikesInput, [data-field="score"], [data-field="strikes"]')) {
      queueMicrotask(syncOpportunitySelects);
    }
  });
  document.addEventListener('click', event => {
    if (event.target.closest('.edit-game, #recoverEntry, #recoverSeries, #cancelEditBtn, .add-to-session')) {
      queueMicrotask(syncOpportunitySelects);
    }
  });
  window.addEventListener('bowling:ready', refreshSuggestions);
  window.addEventListener('bowling:rendered', refreshSuggestions);
  refreshSuggestions();
})();
