import * as Balls from './ball-data.js';
import {clean as cleanAlley} from './inventory.js';
import {isNoTap, hasFrameStats, sessionType} from './sessions.js';
import {standardGames, avg} from './statistics.js';
import {escapeHtml, fmtDate} from './format.js';

const rendered = new WeakMap();
export function patchSessions(container, rows) {
  const previous = rendered.get(container) || new Map(), next = new Map();
  const document = container.ownerDocument;
  for (const [index, row] of rows.entries()) {
    const old = previous.get(row.key);
    let node = old?.node;
    if (!node || old.html !== row.html) {
      const template = document.createElement('template');
      template.innerHTML = row.html.trim();
      const replacement = template.content.firstElementChild;
      if (node?.isConnected) node.replaceWith(replacement);
      node = replacement;
    }
    if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null);
    next.set(row.key, {node, html: row.html});
  }
  for (const [key, {node}] of previous) if (!next.has(key)) node.remove();
  rendered.set(container, next);
}
function historySummary(session) {
    const standard = standardGames(session.games), noTapCount = session.games.length - standard.length;
    const source = standard.length ? standard : session.games;
    const prefix = noTapCount ? (standard.length ? 'Standard ' : 'No-tap ') : '';
    return { average: avg(source.map(game => game.score)), total: source.reduce((sum, game) => sum + game.score, 0), prefix, noTapCount };
  }
export function historyRows(sessions, fullSessions, expandedSessions) {
  return sessions.map(session => {
      const fullSession = fullSessions.get(session.key) || session;
      const positions = new Map(fullSession.games.map((game, position) => [game.id, position]));
      const summary = historySummary(session);
      const sessionDate = new Date(`${session.date}T12:00:00`);
      const alleys = [...new Set(session.games.map(game => cleanAlley(game.alley)).filter(Boolean))];
      const html = `
        <div class="session-item">
        <details class="session-card" data-session-key="${escapeHtml(session.key)}" ${expandedSessions.has(session.key) ? (expandedSessions.get(session.key) ? 'open' : '') : ''}>
          <summary class="session-header">
            <time class="session-date" datetime="${session.date}"><span>${escapeHtml(sessionDate.toLocaleDateString('en-US', {month:'short'}))}</span><strong>${sessionDate.getDate()}</strong><small>${sessionDate.getFullYear()}</small></time>
            <div class="session-summary">
              <span class="session-type ${sessionType(session.games[0]).toLowerCase()}">${escapeHtml(session.name)}</span>
              <p class="session-scores" aria-label="Game scores">${session.games.map(game => `${game.score}${isNoTap(game) ? '<small> NT</small>' : ''}`).join(' · ')}</p>
              <div class="session-totals" aria-label="${summary.prefix}Total ${summary.total} · ${summary.prefix}Avg ${summary.average.toFixed(1)}"><span><strong>${summary.total}</strong>${summary.prefix}Total</span><span><strong>${summary.average.toFixed(1)}</strong>${summary.prefix}Avg</span></div>
              ${alleys.length ? `<p class="session-alley">${escapeHtml(alleys.join(' · '))}</p>` : ''}
              <div class="session-badges">${summary.noTapCount ? `<span class="badge no-tap-badge">${summary.noTapCount} no-tap</span>` : ''}</div>
            </div>
            <span class="session-chevron" aria-hidden="true">›</span>
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
                    <p class="game-ball">${escapeHtml(Balls.summary(g))}</p>${g.alley ? `<p class="game-ball">Alley: ${escapeHtml(g.alley)}</p>` : ''}
                    ${isNoTap(g) ? '<span class="badge no-tap-badge">No-tap</span>' : ''}
                    <p class="game-stats">${hasFrameStats(g) ? `${g.strikes} strikes · ${g.openFrames === 0 ? '✓ Clean game' : g.openFrames + ' open frames'}` : 'Score only'}</p>
                  </div>
                  <button id="gameActionsToggle-${g.id}" class="text-btn game-actions-toggle" data-id="${g.id}" type="button" aria-expanded="false" aria-controls="gameActions-${g.id}" aria-label="Actions for game ${positions.get(g.id) + 1}">Actions</button>
                </div>
                ${g.notes ? `<p class="game-notes">${escapeHtml(g.notes)}</p>` : ''}
                <div id="gameActions-${g.id}" class="game-detail-panel" hidden>
                  <p class="game-stats">${hasFrameStats(g) ? `${g.strikes} / ${g.strikeOpportunities} strike opportunities · ${g.strikeOpportunities ? ((g.strikes / g.strikeOpportunities) * 100).toFixed(1) : '0.0'}% strike rate` : 'Frame details not recorded'}</p>
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
        <button class="text-btn share-session session-share-button" data-key="${escapeHtml(session.key)}" type="button" aria-label="Share session from ${escapeHtml(fmtDate(session.date))}" aria-haspopup="dialog" aria-controls="scoreCardDialog"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 15V2m-4 4 4-4 4 4M7 9H4v12h16V9h-3"/></svg></button>
        </div>
      `;

    return {key: session.key, html};
  });
}
