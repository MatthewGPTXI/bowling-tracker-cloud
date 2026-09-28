export const DB_VERSION = 2;
export const GAME_STORE = 'games';
export const SETTINGS_STORE = 'settings';
export const TOMBSTONE_STORE = 'tombstones';
import {DATA_SCHEMA_VERSION, normalizeGame, normalizeTombstone} from './games.js';

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
export function commitGames(database, upserts = [], deletions = []) {
  return new Promise((resolve, reject) => {
    const normalized = upserts.map(normalizeGame), tombstones = deletions.map(normalizeTombstone);
    if ([...normalized, ...tombstones].some(row => row.id === null)) { reject(new Error('Invalid game ID')); return; }
    const tx = database.transaction([GAME_STORE, TOMBSTONE_STORE], 'readwrite');
    const saved = tx.objectStore(GAME_STORE), removed = tx.objectStore(TOMBSTONE_STORE);
    try {
      for (const game of normalized) { saved.put(game); removed.delete(game.id); }
      for (const tombstone of tombstones) { removed.put(tombstone); saved.delete(tombstone.id); }
    } catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Save cancelled'));
  });
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
