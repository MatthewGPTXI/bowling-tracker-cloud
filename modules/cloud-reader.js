import {recordId} from './ids.js';

export const SYNC_PROTOCOL_VERSION = 1;
export const READ_PAGE_SIZE = 250;
const stamp = value => value && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)
  ? {seconds: value.seconds, nanoseconds: value.nanoseconds} : null;

// Incremental mode is enabled only after server rules enforce a server timestamp
// on EVERY write. Older clients otherwise make timestamp cursors unsafe.
export async function readRemoteHistory({sdk, firestore, uid, isCurrent, protocol, baseline}) {
  const assertCurrent = () => { if (!isCurrent()) throw new Error('Account or local history changed. Sync again.'); };
  const collection = sdk.collection(firestore, 'users', uid, 'games');
  const getDocs = sdk.getDocsFromServer || sdk.getDocs;
  const enabled = protocol === SYNC_PROTOCOL_VERSION;
  let cutoff = null;
  if (enabled) {
    assertCurrent();
    const ref = sdk.doc(firestore, 'users', uid);
    await sdk.setDoc(ref, {syncReadAt: sdk.serverTimestamp()}, {merge: true});
    assertCurrent();
    const profile = await sdk.getDocFromServer(ref);
    cutoff = stamp(profile.data()?.syncReadAt);
    if (!cutoff) throw new Error('Could not establish a safe cloud sync cursor.');
  }
  const incremental = enabled && baseline?.version === SYNC_PROTOCOL_VERSION && stamp(baseline.cursor)
    && Array.isArray(baseline.records);
  const records = new Map(incremental ? baseline.records.map(row => [recordId(row.id), row]) : []);
  let after = null;
  do {
    assertCurrent();
    const constraints = [];
    if (incremental) {
      // Inclusive boundary also handles equal commit timestamps safely.
      constraints.push(sdk.where('serverUpdatedAt', '>=', new sdk.Timestamp(baseline.cursor.seconds, baseline.cursor.nanoseconds)));
      constraints.push(sdk.where('serverUpdatedAt', '<=', new sdk.Timestamp(cutoff.seconds, cutoff.nanoseconds)));
      constraints.push(sdk.orderBy('serverUpdatedAt'));
    }
    if (sdk.query) {
      constraints.push(sdk.orderBy(sdk.documentId()), sdk.limit(READ_PAGE_SIZE));
      if (after) constraints.push(sdk.startAfter(after));
    }
    const snapshot = await getDocs(sdk.query ? sdk.query(collection, ...constraints) : collection);
    assertCurrent();
    const docs = [];
    snapshot.forEach(doc => docs.push(doc));
    for (const doc of docs) {
      const id = recordId(doc.id), data = doc.data();
      if (id === null || recordId(data.id) !== id) throw new Error('Cloud history contains an invalid game ID.');
      records.set(id, {...data, id, ...(data.serverUpdatedAt ? {serverUpdatedAt: stamp(data.serverUpdatedAt)} : {})});
    }
    after = sdk.query && docs.length === READ_PAGE_SIZE ? docs.at(-1) : null;
  } while (after);
  return {records, snapshot: enabled ? {version: SYNC_PROTOCOL_VERSION, cursor: cutoff, records: [...records.values()]} : null};
}
