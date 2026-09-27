import {clean, key} from './inventory.js';
const limit = 10;
export {clean, key};

export function list(game) {
  const rows = Array.isArray(game?.balls) ? game.balls : clean(game?.ball) ? [{name: game.ball}] : [];
  return rows.map(row => ({name: clean(row?.name), frames: row?.frames ?? null}));
}

export function error(rows) {
  if (!Array.isArray(rows) || rows.length > limit) return 'Record up to 10 balls per game.';
  const names = new Set();
  let frames = 0;
  for (const row of rows) {
    if (!row || typeof row.name !== 'string' || !clean(row.name)) return 'Enter a ball name for each frame count.';
    if (clean(row.name).length > 100) return 'Ball names must be 100 characters or fewer.';
    if (names.has(key(row.name))) return 'Use one row per ball; combine its frames in that row.';
    names.add(key(row.name));
    if (row.frames !== null && row.frames !== undefined) {
      if (!Number.isInteger(row.frames) || row.frames < 1 || row.frames > 10) return 'Frames per ball must be a whole number from 1 to 10, or blank.';
      frames += row.frames;
    }
  }
  return frames > 10 ? 'Ball frame counts cannot total more than 10 for one game.' : '';
}

export function summary(game) {
  return list(game).map(row => row.name + (row.frames == null ? '' : ` · ${row.frames} frame${row.frames === 1 ? '' : 's'}`)).join(' / ') || 'No ball recorded';
}

export function comparable(game) {
  return list(game).map(row => ({name: key(row.name), frames: row.frames})).sort((a, b) => a.name.localeCompare(b.name));
}

export function fromDraft(rows, canonical = clean) {
  return rows.filter(row => clean(row.name) || String(row.frames ?? '').trim() !== '')
    .map(row => ({name: canonical(row.name), frames: String(row.frames ?? '').trim() === '' ? null : Number(row.frames)}));
}
