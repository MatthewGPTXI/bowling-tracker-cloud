

export function seriesHasInput(draft) {
  const hasText = value => value !== null && value !== undefined && String(value).trim() !== '';
  return hasText(draft?.ball) || hasText(draft?.alley) || (draft?.rows || []).some(row =>
    ['score', 'openFrames', 'strikes', 'notes', 'ball'].some(field => hasText(row[field]))
    || (hasText(row.strikeOpp) && Number(row.strikeOpp) !== 10)
    || (row.balls || []).some(ball => hasText(ball.name) || hasText(ball.frames)));
}

export const draftKey = (scope, kind) => `bowling-draft:${scope.dbName || scope.uid || 'guest'}:${kind}`;

export function readDraft(scope, kind, storage) {
  try {
    const draft = JSON.parse(storage.getItem(draftKey(scope, kind)) || 'null');
    if (kind === 'series' && draft && !seriesHasInput(draft)) {
      storage.removeItem(draftKey(scope, kind)); return null;
    }
    return draft;
  } catch (_) { return null; }
}
export function saveDraft(scope, kind, value, storage) {
  // Failure propagates so the UI can tell the user to keep the unsaved entry open.
  storage.setItem(draftKey(scope, kind), JSON.stringify(value));
}
export function clearDraft(scope, kind, storage) {
  try { storage.removeItem(draftKey(scope, kind)); } catch (_) {}
}
