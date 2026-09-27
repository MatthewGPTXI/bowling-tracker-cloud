import * as Balls from './ball-data.js';
import {clean as cleanBall} from './inventory.js';
import {sessionKey, sessionType, isNoTap, hasFrameStats, SESSION_TYPES} from './sessions.js';
import {recordId} from './ids.js';
const cleanAlley = cleanBall;
export const DATA_SCHEMA_VERSION = 6;
export const BACKUP_SCHEMA_VERSION = 9;

export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidGame(game) {
  const integerIn = (value, low, high) => value !== null && value !== undefined
    && String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= low && Number(value) <= high;
  if (!game || typeof game !== 'object'
    || recordId(game.id) === null
    || typeof game.bowler !== 'string' || !game.bowler.trim()
    || !isValidDate(game.date)
    || !integerIn(game.score, 0, 300)) return false;
  if (game.schemaVersion !== undefined && !integerIn(game.schemaVersion, 1, DATA_SCHEMA_VERSION)) return false;
  if (['sessionId', 'sessionName'].some(key => game[key] !== undefined && (typeof game[key] !== 'string' || game[key].length > 2048))) return false;
  if (game.scoreOnly !== undefined && typeof game.scoreOnly !== 'boolean') return false;
  if (game.scoreOnly === true) {
    if (['openFrames', 'strikes', 'strikeOpportunities'].some(key => game[key] != null)) return false;
  } else {
    if (!integerIn(game.openFrames, 0, 10) || !integerIn(game.strikes, 0, 12)) return false;
    if (game.strikeOpportunities !== undefined && (!integerIn(game.strikeOpportunities, 10, 12)
      || Number(game.strikeOpportunities) < Number(game.strikes))) return false;
    if (Number(game.score) === 300 && Number(game.strikes) !== 12) return false;
  }
  if (game.alley !== undefined && (typeof game.alley !== 'string' || cleanAlley(game.alley).length > 100)) return false;
  if (game.ball !== undefined && (typeof game.ball !== 'string' || cleanBall(game.ball).length > 100)) return false;
  if (game.balls !== undefined && Balls.error(game.balls)) return false;
  if (game.noTap !== undefined && typeof game.noTap !== 'boolean') return false;
  if (game.sessionType !== undefined && !SESSION_TYPES.includes(game.sessionType)) return false;
  if (game.gameOrder !== undefined && !integerIn(game.gameOrder, 0, Number.MAX_SAFE_INTEGER)) return false;
  return ['createdAt', 'updatedAt'].every((key) => game[key] === undefined || integerIn(game[key], 0, Number.MAX_SAFE_INTEGER));
}

export function normalizeGame(game) {
  const strikes = Number(game.strikes);
  return {
    id: recordId(game.id),
    schemaVersion: DATA_SCHEMA_VERSION,
    sessionId: game.schemaVersion >= DATA_SCHEMA_VERSION && game.sessionId ? game.sessionId : sessionKey({...game,sessionId:null}),
    bowler: String(game.bowler).trim(),
    date: String(game.date),
    sessionName: String(game.sessionName || ''),
    sessionType: sessionType(game),
    ball: Balls.list(game)[0]?.name || '',
    balls: Balls.list(game),
    alley: cleanAlley(game.alley),
    noTap: isNoTap(game),
    ...(game.gameOrder !== undefined ? {gameOrder: Number(game.gameOrder)} : {}),
    score: Number(game.score),
    scoreOnly: game.scoreOnly === true,
    openFrames: hasFrameStats(game) ? Number(game.openFrames) : null,
    strikes: hasFrameStats(game) ? strikes : null,
    strikeOpportunities: hasFrameStats(game) ? Math.min(12, Math.max(Number(game.strikeOpportunities || 10), strikes, 10)) : null,
    notes: String(game.notes || ''),
    createdAt: Number(game.createdAt ?? 0),
    updatedAt: Number(game.updatedAt ?? game.createdAt ?? 0)
  };
}
