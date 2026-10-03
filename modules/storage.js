export const DB_VERSION = 2;
export const GAME_STORE = 'games';
export const SETTINGS_STORE = 'settings';
export const TOMBSTONE_STORE = 'tombstones';
import {DATA_SCHEMA_VERSION, normalizeGame, normalizeTombstone} from './games.js';
import {cloudGamePayload, cloudDeletePayload, sameCloudVersion} from './reconciliation.js';

const OUTBOX_KEY = 'syncOutbox';
const REVISION_KEY = 'historyRevision';
const signature = rows => JSON.stringify(rows.map(normalizeGame).sort((a,b) => String(a.id).localeCompare(String(b.id))));
export function historyChangedError() {
  const error = new Error('Saved history changed in another window or during sync. Your entry is kept; review the current history before saving again.');
  error.code = 'bowling/local-conflict';
  return error;
}

// Games, deletions and retry bases are read from the same database snapshot.
export function getHistorySnapshot(database) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction([GAME_STORE, TOMBSTONE_STORE, SETTINGS_STORE], 'readonly');
    const saved = tx.objectStore(GAME_STORE).getAll();
    const removed = tx.objectStore(TOMBSTONE_STORE).getAll();
    const settings = tx.objectStore(SETTINGS_STORE);
    const outbox = settings.get(OUTBOX_KEY), revision = settings.get(REVISION_KEY);
    tx.oncomplete = () => resolve({games: saved.result, tombstones: removed.result,
      outbox: outbox.result?.value || {}, revision: Number(revision.result?.value || 0)});
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not read saved history'));
  });
}

// Normalize legacy records and mark the migration in the same transaction.
// IDs, timestamps and tombstones are preserved, so migration is not a user edit.
const migrated = new WeakSet();
export function migrateGames(database) {
  if (migrated.has(database)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([GAME_STORE, SETTINGS_STORE], 'readwrite');
    const settings = tx.objectStore(SETTINGS_STORE), games = tx.objectStore(GAME_STORE);
    const version = settings.get('dataSchemaVersion');
    version.onsuccess = () => {
      if (Number(version.result?.value || 0) >= DATA_SCHEMA_VERSION) return;
      const request = games.getAll();
      request.onsuccess = () => {
        try {
          for (const game of request.result) games.put({...game, ...normalizeGame(game)});
          settings.put({key: 'dataSchemaVersion', value: DATA_SCHEMA_VERSION});
        } catch (error) { tx.abort(); reject(error); }
      };
    };
    tx.oncomplete = () => { migrated.add(database); resolve(); };
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Data migration failed'));
  });
}
export function commitGames(database, upserts = [], deletions = [], options = {}) {
  return new Promise((resolve, reject) => {
    const normalized = upserts.map(normalizeGame), tombstones = deletions.map(normalizeTombstone);
    if ([...normalized, ...tombstones].some(row => row.id === null)) { reject(new Error('Invalid game ID')); return; }
    const tx = database.transaction([GAME_STORE, TOMBSTONE_STORE, SETTINGS_STORE], 'readwrite');
    const saved = tx.objectStore(GAME_STORE), removed = tx.objectStore(TOMBSTONE_STORE);
    const settings = tx.objectStore(SETTINGS_STORE);
    const requests = [saved.getAll(), removed.getAll(), settings.get(OUTBOX_KEY), settings.get(REVISION_KEY)];
    let remaining = requests.length, revision, failure;
    for (const request of requests) request.onsuccess = () => {
      if (--remaining) return;
      try {
        const [current, deleted, pending, storedRevision] = requests.map(request => request.result);
        revision = Number(storedRevision?.value || 0);
        if ((options.expectedRevision !== undefined && options.expectedRevision !== revision)
            || (options.expectedGames && signature(current) !== signature(options.expectedGames))
            || (options.expectedTombstones && JSON.stringify(deleted) !== JSON.stringify(options.expectedTombstones))) throw historyChangedError();
        const local = new Map(current.map(game => [game.id,game]));
        const deletedMap = new Map(deleted.map(row => [row.id,{...row,deleted:true}]));
        for (const {id,version} of options.expectedVersions || []) {
          if (!sameCloudVersion(local.get(id) || deletedMap.get(id) || null,version)) throw historyChangedError();
        }
        const outbox = {...pending?.value};
        if (options.queue) for (const data of [...normalized.map(cloudGamePayload), ...tombstones.map(cloudDeletePayload)]) {
          outbox[data.id] = {data, base: outbox[data.id] ? outbox[data.id].base : (local.get(data.id) || deletedMap.get(data.id) || null)};
        }
        for (const game of normalized) { saved.put(game); removed.delete(game.id); }
        for (const tombstone of tombstones) { removed.put(tombstone); saved.delete(tombstone.id); }
        if (normalized.length || tombstones.length) {
          settings.put({key: REVISION_KEY, value: ++revision});
          if (options.queue) settings.put({key: OUTBOX_KEY, value: outbox});
        }
      } catch (error) { failure = error; tx.abort?.(); reject(error); }
    };
    tx.oncomplete = () => { if (!failure) resolve(revision); };
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Save cancelled'));
  });
}

// Acknowledge observed retry items without erasing a newer edit from another
// tab. After a confirmed upload, that version becomes the newer edit's base.
export function acknowledgeOutbox(database, acknowledged, acceptedVersions = {}) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE), request = store.get(OUTBOX_KEY);
    let failure;
    request.onsuccess = () => {
      try {
        const latest = {...request.result?.value};
        for (const [id, item] of Object.entries(acknowledged)) {
          if (JSON.stringify(latest[id]) === JSON.stringify(item)) delete latest[id];
          else if (latest[id] && sameCloudVersion(latest[id].base,item.base)
              && Number(latest[id].data?.updatedAt) > Number(item.data?.updatedAt)) {
            // A confirmed upload becomes the base of a subsequent local edit.
            // Keep that edit; it no longer competes with our own earlier upload.
            latest[id] = {...latest[id],base:acceptedVersions[id] || item.data};
          }
        }
        store.put({key: OUTBOX_KEY, value: latest});
      } catch (error) { failure = error; tx.abort?.(); reject(error); }
    };
    tx.oncomplete = () => { if (!failure) resolve(); };
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not acknowledge sync'));
  });
}

export async function migrateLegacyOutbox(database, uid, storage) {
  if (!uid) return;
  const key = `bowling-sync-outbox:${uid}`;
  let legacy = {};
  try { const parsed = JSON.parse(storage.getItem(key) || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) legacy = parsed; } catch (_) {}
  await new Promise((resolve, reject) => {
    const tx = database.transaction([GAME_STORE, TOMBSTONE_STORE, SETTINGS_STORE], 'readwrite');
    const settings = tx.objectStore(SETTINGS_STORE);
    const requests = [settings.get('legacyOutboxImported'), settings.get(OUTBOX_KEY),
      tx.objectStore(GAME_STORE).getAll(), tx.objectStore(TOMBSTONE_STORE).getAll()];
    let remaining = requests.length, failure;
    for (const request of requests) request.onsuccess = () => {
      if (--remaining || requests[0].result?.value) return;
      try {
        const pending = {...requests[1].result?.value};
        const versions = new Map([...requests[2].result, ...requests[3].result.map(row => ({...row,deleted:true}))].map(row => [String(row.id),row]));
        for (const [id,item] of Object.entries(legacy)) {
          if (!pending[id] && item?.data && sameCloudVersion(versions.get(id),item.data)) pending[id] = item;
        }
        settings.put({key: OUTBOX_KEY, value: pending});
        settings.put({key:'legacyOutboxImported',value:true});
      } catch (error) { failure = error; tx.abort?.(); reject(error); }
    };
    tx.oncomplete = () => { if (!failure) resolve(); };
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not migrate sync retries'));
  });
  try { storage.removeItem(key); } catch (_) {}
}

export function openDatabase(dbName, indexedDB = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(GAME_STORE)) {
        const store = database.createObjectStore(GAME_STORE, { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('bowler', 'bowler', { unique: false });
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(TOMBSTONE_STORE)) {
        database.createObjectStore(TOMBSTONE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function idbRequestOn(database, storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = action(store);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllFromDb(database, storeName) {
  return idbRequestOn(database, storeName, 'readonly', (store) => store.getAll());
}

export async function getSettingFromDb(database, key) {
  const result = await idbRequestOn(database, SETTINGS_STORE, 'readonly', (store) => store.get(key));
  return result ? result.value : null;
}

export async function setSettingOnDb(database, key, value) {
  return idbRequestOn(database, SETTINGS_STORE, 'readwrite', (store) => store.put({ key, value }));
}
