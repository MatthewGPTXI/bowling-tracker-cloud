import {normalizeGame} from './games.js';

export function csvEscape(value) {
  const raw = String(value ?? '');
  const text = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function importFingerprint(game) {
  if (!game) return '';
  if (game.deleted) return `deleted:${game.id}`;
  const normalized = normalizeGame(game); delete normalized.updatedAt; delete normalized.createdAt;
  return JSON.stringify(normalized);
}

export function buildImportPlan(imported, deleted, current, tombstones) {
  const saved = new Map(current.map(g => [g.id,g])), removed = new Map(tombstones.map(t => [t.id,t]));
  const rows = [];
  for (const game of imported) {
    const local = saved.get(game.id), tombstone = removed.get(game.id);
    const kind = local ? (importFingerprint(local) === importFingerprint(game) ? 'duplicate' : 'conflict') : tombstone ? 'conflict' : 'addition';
    rows.push({kind,id:game.id,game,local,tombstone});
  }
  for (const deletion of deleted) {
    const local = saved.get(deletion.id);
    rows.push({kind:local ? 'conflict' : 'duplicate',id:deletion.id,deletion,local});
  }
  return rows;
}
