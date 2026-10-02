import {orderValue} from './ids.js';
export const SESSION_TYPES = ['League', 'Practice', 'Tournament'];

export function sessionLabel(game) {
  return sessionType(game);
}

export function sessionKey(game) {
  return game.sessionId || `${game.date}|||${String(game.sessionName || '').trim().toLowerCase() || 'bowling session'}`;
}

export function sessionType(game) { return SESSION_TYPES.includes(game?.sessionType) ? game.sessionType : 'League'; }

export function hasFrameStats(game) { return game?.scoreOnly !== true; }

export function isNoTap(game) { return game?.noTap === true; }

export function scoringLabel(game) { return isNoTap(game) ? 'No-tap' : 'Standard'; }

export function gameOrder(a, b) { return orderValue(a) - orderValue(b) || (typeof a.id === 'number' && typeof b.id === 'number' ? a.id - b.id : String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0); }

export function latestSessionOrder(a, b) { return b.date.localeCompare(a.date) || Math.max(...b.games.map(g => g.createdAt || (typeof g.id === 'number' ? g.id : 0))) - Math.max(...a.games.map(g => g.createdAt || (typeof g.id === 'number' ? g.id : 0))); }

// gameOrder is local to a session. Use the same session order as history, then
// preserve each session's explicit game order. Full history keeps filtered
// statistics from changing a session's position when its newest game is hidden.
export function chronologicalGames(source, allGames = source) {
  const selected = new Map(source.map(game => [game.id,game]));
  const full = new Map(allGames.map(game => [game.id,game]));
  for (const game of source) if (!full.has(game.id)) full.set(game.id,game);
  return buildSessions([...full.values()]).sort((a,b) => latestSessionOrder(b,a) || String(a.key).localeCompare(String(b.key)))
    .flatMap(session => session.games.map(game => selected.get(game.id)).filter(Boolean));
}

export function buildSessions(sourceGames) {
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
