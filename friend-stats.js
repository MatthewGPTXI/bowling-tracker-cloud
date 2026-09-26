(() => {
  'use strict';
  const openDialog = dialog => window.BowlingUI ? window.BowlingUI.openDialog(dialog) : dialog.showModal();

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
    { key: 'closedFramePct', label: 'Closed frame %', digits: 1, suffix: '%', better: 'higher' },
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
  const needsStandardRefresh = member => (Number(member?.noTapGames || 0) > 0
    && member.standardStatsUpdatedAt !== member.updatedAt) || (Number(member?.scoreOnlyGames || 0) > 0
    && member.frameStatsUpdatedAt !== member.updatedAt);

  function metricValue(member, metric) {
    if (!member || needsStandardRefresh(member)) return null;
    const games = finite(member.games);
    if (!metric.count && !games) return null;
    const details = currentDetails(member);
    if (metric.key === 'highSeries' && (games < 3 || details?.hasSeries === false
      || (!details?.hasSeries && !member.highSeries))) return null;
    const frameGames = finite(member.frameStatsGames) ?? games;
    if (['strikePct','closedFramePct','openAvg','cleanGames','cleanRate','totalStrikes','strikesPerGame','mostStrikes','bestStrikePct'].includes(metric.key) && !frameGames) return null;
    if (metric.key === 'closedFramePct') {
      const openAvg = finite(details?.openAvg);
      return openAvg === null || openAvg > 10 ? null : (10 - openAvg) * 10;
    }
    if (metric.key === 'cleanRate') return finite(member.cleanGames) === null ? null : member.cleanGames / frameGames * 100;
    if (metric.key === 'strikesPerGame') return finite(member.totalStrikes) === null ? null : member.totalStrikes / frameGames;
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
    window.BowlingScoreCards?.closeComparison?.();
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
    window.BowlingScoreCards?.closeComparison?.();
    selectedUid = uid;
    comparing = false;
    opener = trigger;
    render();
    if (selectedUid && !dialog.open) openDialog(dialog);
  }

  function canShareComparison(own, member) {
    return comparing && selectedUid !== context.uid && !needsStandardRefresh(member)
      && finite(own.games) > 0 && finite(member.games) > 0;
  }

  // Only public, display-ready fields leave the comparison view. Reuse the same
  // missing/stale/frame-stat rules as the table; never fetch or store new data.
  function getComparisonCardData() {
    if (!dialog.open || !hasCurrentAccount() || !members.has(selectedUid)) return null;
    const app = window.BowlingApp;
    const own = app.getLeaderboardSummary(), member = members.get(selectedUid);
    if (!canShareComparison(own, member)) return null;
    const bowler = (summary, name, self) => ({
      name: String(name || 'Bowler'),
      self,
      updatedAt: finite(summary.updatedAt),
      frameCount: finite(summary.frameStatsGames) ?? finite(summary.games),
      ...Object.fromEntries(metrics.filter(metric => ['average', 'highGame', 'highSeries', 'strikePct',
        'closedFramePct', 'games', 'cleanGames', 'totalStrikes'].includes(metric.key))
        .map(metric => [metric.key, metricValue(summary, metric)]))
    });
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return {
      kind: 'comparison', date, asOf: app.formatDate(date), scores: [],
      bowlers: [bowler(own, app.getProfileName(), true), bowler(member, member.displayName, false)]
    };
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
    $('shareFriendComparison').hidden = !comparing || self;
    $('shareFriendComparison').disabled = !canShareComparison(own, member);
    const sample = needsRefresh ? 'This bowler must open the updated app and sync to refresh standard-only stats.'
      : count === null ? 'Game count unavailable.' : count === 0 ? 'No games shared yet.' : `${count} game${count === 1 ? '' : 's'} shared.`;
    $('friendStatsStatus').textContent = (comparing ? 'Comparing overall stats. ' : '') + sample
      + (count !== null && count > 0 && count < 10 ? ' Fewer than 10 games: averages are provisional.' : '')
      + (comparing && own.games > 0 && own.games < 10 ? ' Your average is provisional: fewer than 10 games.' : '')
      + (!needsRefresh && Number(member.noTapGames || 0) > 0 ? ` ${Number(member.noTapGames)} no-tap games excluded.` : '')
      + (Number(member.scoreOnlyGames || 0) > 0 ? ' Score-only games excluded from frame stats.' : '')
      + (!navigator.onLine ? ' Offline · using the last loaded summary.' : '');

    if (comparing) {
      const table = (rows) => `<div class="friend-comparison-wrap"><table class="friend-comparison"><caption class="visually-hidden">All-time standard-game stats: you compared with ${escapeHtml(name)}</caption><thead><tr><th scope="col">Metric</th><th scope="col">You</th><th scope="col">${escapeHtml(name)}</th></tr></thead><tbody>${rows.map(metric => {
        const mine = metricValue(own, metric), theirs = metricValue(member, metric);
        return `<tr><th scope="row">${metric.label}</th><td>${formatValue(mine, metric)}${comparisonDifference(mine, theirs, metric)}</td><td>${formatValue(theirs, metric)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
      $('friendStatsContent').innerHTML = table(metrics.slice(0, 5)) + `<details class="filter-disclosure"><summary>More comparison stats</summary>${table(metrics.slice(5))}</details>`;
    } else {
      $('friendStatsContent').innerHTML = `<div class="stats-grid friend-overview">${metrics.slice(0, 5).map(metric => `<article class="stat-card"><span class="stat-label">${metric.label}</span><strong class="stat-value">${formatValue(metricValue(member, metric), metric)}</strong></article>`).join('')}</div>
        <details class="filter-disclosure"><summary>More bowling stats</summary><dl class="friend-metric-list">${metrics.slice(5).map(metric => `<div><dt>${metric.label}</dt><dd>${formatValue(metricValue(member, metric), metric)}</dd></div>`).join('')}</dl></details>`;
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
    window.BowlingScoreCards?.closeComparison?.();
    selectedUid = '';
    comparing = false;
    if (opener?.isConnected) opener.focus({preventScroll: true});
    opener = null;
  });
  $('friendStatsOnly').addEventListener('click', () => { comparing = false; render(); });
  $('friendStatsCompare').addEventListener('click', () => { comparing = true; render(); });
  window.addEventListener('bowling:local-account-changed', clear);
  window.addEventListener('bowling:rendered', () => { if (dialog.open) render(); });
  window.addEventListener('offline', () => { if (dialog.open) render(); });
  window.addEventListener('online', () => { if (dialog.open) render(); });

  window.BowlingFriends = { setMembers, clear, open, getComparisonCardData };
})();
