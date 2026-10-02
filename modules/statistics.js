import {buildSessions, chronologicalGames, isNoTap, hasFrameStats} from './sessions.js';
export const standardGames = source => source.filter(game => !isNoTap(game));

export function avg(values) {
  return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
}

export function bestThreeGameSeries(sessions, allGames) {
  let best = null;
  const fullSessions = new Map(buildSessions(allGames).map(session => [session.key,session]));
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

export function completedSeriesTotals(source, allGames) {
  const selected = new Set(source.map(game => game.id));
  const totals = [];
  // Count non-overlapping triples, preserving gaps from every excluded game.
  for (const session of buildSessions(allGames)) {
    let count = 0, total = 0;
    for (const game of session.games) {
      if (isNoTap(game) || !selected.has(game.id)) { count = 0; total = 0; continue; }
      total += game.score;
      if (++count === 3) { totals.push(total); count = 0; total = 0; }
    }
  }
  return totals;
}

export function calculateStats(sourceGames, allGames = sourceGames) {
  sourceGames = standardGames(sourceGames);
  const count = sourceGames.length;
  const sessions = buildSessions(sourceGames);
  const scores = sourceGames.map((g) => g.score);
  const detailed = sourceGames.filter(hasFrameStats);
  const frameCount = detailed.length;
  const totalStrikes = detailed.reduce((sum, g) => sum + g.strikes, 0);
  const strikeOpps = detailed.reduce((sum, g) => sum + g.strikeOpportunities, 0);
  const totalOpen = detailed.reduce((sum, g) => sum + g.openFrames, 0);
  // Tenth-frame fill shots do not add frames to a ten-frame game.
  const totalFrames = frameCount * 10;
  const totalClosed = totalFrames - totalOpen;
  const cleanGames = detailed.filter((g) => g.openFrames === 0).length;
  const sortedRecent = chronologicalGames(sourceGames, allGames).reverse();
  const bestSession = sessions.length ? sessions.reduce((best, s) => s.average > best.average ? s : best) : null;
  const bestSeries = bestThreeGameSeries(sessions, allGames);
  const highGameObj = sourceGames.length ? sourceGames.reduce((best, g) => g.score > best.score ? g : best) : null;
  const mostStrikesGame = detailed.length ? detailed.reduce((best, g) => {
    if (g.strikes > best.strikes) return g;
    if (g.strikes === best.strikes && Number(g.createdAt || 0) > Number(best.createdAt || 0)) return g;
    return best;
  }) : null;
  const bestStrikePctGame = detailed.length ? detailed.reduce((best, g) => {
    const pct = g.strikeOpportunities ? g.strikes / g.strikeOpportunities : 0;
    const bestPct = best.strikeOpportunities ? best.strikes / best.strikeOpportunities : 0;
    if (pct > bestPct) return g;
    if (pct === bestPct && g.strikes > best.strikes) return g;
    if (pct === bestPct && g.strikes === best.strikes && Number(g.createdAt || 0) > Number(best.createdAt || 0)) return g;
    return best;
  }) : null;
  const recent200 = sortedRecent.find(game => game.score >= 200) || null;

  return {
    count,
    frameCount,
    sessions,
    average: count ? avg(scores) : 0,
    highGameObj,
    bestSeries,
    totalStrikes,
    strikePct: strikeOpps ? (totalStrikes / strikeOpps) * 100 : null,
    openAvg: frameCount ? totalOpen / frameCount : null,
    openRate: totalFrames ? totalOpen / totalFrames * 100 : null,
    totalFrames,
    totalClosed,
    closedFramePct: totalFrames ? (totalClosed / totalFrames) * 100 : null,
    cleanGames,
    cleanRate: frameCount ? cleanGames / frameCount * 100 : null,
    strikesPerGame: frameCount ? totalStrikes / frameCount : null,
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

export function progressStats(source, mode = 'running', allGames = source) {
  source = standardGames(source);
  const ordered = chronologicalGames(source, allGames);
  const recent = (count) => {
    const slice = ordered.slice(-count);
    return { count: slice.length, average: slice.length ? slice.reduce((sum, g) => sum + g.score, 0) / slice.length : null };
  };
  let sum = 0;
  const points = [];
  ordered.forEach((game, i) => {
    sum += game.score;
    const windowGames = mode === 'recent' ? ordered.slice(Math.max(0, i - 9), i + 1) : null;
    const point = { date: game.date, average: windowGames ? avg(windowGames.map(g => g.score)) : sum / (i + 1), count: windowGames ? windowGames.length : i + 1 };
    if (points.at(-1)?.date === game.date) points[points.length - 1] = point;
    else points.push(point);
  });
  return { last10: recent(10), last30: recent(30), points };
}

export function chartScale(points) {
  const values = points.map(point => point.average);
  let low = Math.max(0, Math.floor((Math.min(...values) - 10) / 10) * 10);
  let high = Math.min(300, Math.ceil((Math.max(...values) + 10) / 10) * 10);
  if (high - low < 40) {
    low = Math.max(0, Math.min(260, Math.floor(((low + high) / 2 - 20) / 10) * 10));
    high = low + 40;
  }
  return { low, high, ticks: [low, (low + high) / 2, high] };
}
