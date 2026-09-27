export const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
export const key = value => clean(value).toLowerCase();


export function mergeInventory(...sources) {
  const records = new Map();
  for (const source of sources) for (const row of Array.isArray(source) ? source : []) {
    if (!row || typeof row.name !== 'string' || !clean(row.name) || clean(row.name).length > 100 ||
        !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) continue;
    const next = {name: clean(row.name), updatedAt: row.updatedAt, removed: row.removed === true};
    const previous = records.get(key(next.name));
    if (!previous || next.updatedAt > previous.updatedAt || (next.updatedAt === previous.updatedAt &&
        (Number(next.removed) > Number(previous.removed) || (next.removed === previous.removed && next.name > previous.name)))) records.set(key(next.name), next);
  }
  return [...records.values()].sort((a, b) => key(a.name).localeCompare(key(b.name)));
}

// One account-scoped lifecycle for balls and alleys. A read/merge/write is one
// transaction, so a delayed cloud response cannot overwrite an in-flight edit.
export function createNamedInventory({setting, label, getDatabase, getUid, seeds, ready, onChange, onEdit}) {
  let database, records = [];
  function scope() {
    const next = getDatabase();
    if (database !== next) { database = next; records = []; }
    return next;
  }
  function get() { scope(); return mergeInventory(seeds().map(name => ({name, updatedAt: 0})), records); }
  async function load() { await merge([]); }
  function merge(incoming, expectedUid = getUid()) {
    if (expectedUid !== getUid()) return Promise.resolve(false);
    const target = scope(), initial = get();
    return new Promise((resolve, reject) => {
      const tx = target.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const request = store.get(setting);
      let merged;
      request.onsuccess = () => {
        merged = mergeInventory(initial, request.result?.value, incoming);
        if (JSON.stringify(request.result?.value) !== JSON.stringify(merged)) store.put({key: setting, value: merged});
      };
      tx.oncomplete = () => {
        if (getDatabase() !== target || getUid() !== expectedUid) { resolve(false); return; }
        const changed = JSON.stringify(records) !== JSON.stringify(merged);
        records = merged;
        if (changed) onChange();
        resolve(true);
      };
      tx.onabort = tx.onerror = () => reject(tx.error || new Error(`Could not save ${label} inventory.`));
    });
  }
  async function edit(name, previousName = '', remove = false) {
    if (!ready()) throw new Error('Your profile is still loading. Try again in a moment.');
    name = clean(name);
    const current = get();
    if (!name || name.length > 100) throw new Error(`Enter ${label === 'alley' ? 'an' : 'a'} ${label} name from 1 to 100 characters.`);
    if (!remove && current.some(row => !row.removed && key(row.name) === key(name) && key(row.name) !== key(previousName))) throw new Error(`That ${label} is already in your inventory.`);
    const updatedAt = current.reduce((time, row) => Math.max(time, row.updatedAt + 1), Date.now());
    const changes = [{name, updatedAt, removed: remove}];
    if (previousName && key(previousName) !== key(name)) changes.push({name: previousName, updatedAt, removed: true});
    if (!await merge(changes)) throw new Error('The profile changed. Please try again.');
    onEdit();
  }
  return {get, load, merge, edit};
}
