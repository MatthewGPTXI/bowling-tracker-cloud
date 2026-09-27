export function recordId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  if (/^[1-9]\d*$/.test(value)) return recordId(Number(value));
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}
export const newGameId = () => crypto.randomUUID();
export const newSessionId = () => 'session-' + crypto.randomUUID();
export const orderValue = game => Number(game.gameOrder ?? game.createdAt ?? (typeof game.id === 'number' ? game.id : 0));
