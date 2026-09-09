const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const source = fs.readFileSync(path.join(__dirname, '../cloud.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf('  ' + start), source.indexOf('  ' + end, source.indexOf('  ' + start)));

(async () => {
  let failPersistence = true, creates = 0, observers = 0, persistenceAttempts = 0;
  const statuses = [], buttons = [], app = {}, auth = {}, firestore = {};
  const fb = {
    initializeApp: () => { creates++; return app; },
    getAuth: () => auth, getFirestore: () => firestore,
    setPersistence: async () => { persistenceAttempts++; if (failPersistence) throw new Error('Storage temporarily unavailable'); },
    onAuthStateChanged: () => { observers++; }, browserLocalPersistence: {}
  };
  const c = {
    config: {}, firebaseApp: null, firebaseReady: false, firebaseStartupError: null,
    auth: null, firestore: null, initializing: null, currentUser: null,
    navigator: { onLine: true }, console: { error() {} }, dom: {},
    window: { BowlingApp: { setSyncStatus: (...args) => statuses.push(args) } },
    configReady: () => true, loadFirebaseModules: async () => fb,
    handleAuthStateChanged() {}, setCloudButton: (...args) => buttons.push(args),
    setStatus() {}, friendlyError: e => e.message
  };
  vm.createContext(c);
  vm.runInContext(section('async function initFirebase()', 'async function userProfileRef()'), c);
  assert.equal(await c.initFirebase(), false);
  assert.equal(c.firebaseReady, false);
  c.renderConnectionState();
  assert.equal(buttons.at(-1)[1], 'Cloud error', 'Opening the dialog must not hide a startup error');
  failPersistence = false;
  assert.deepEqual(await Promise.all([c.initFirebase(), c.initFirebase()]), [true, true]);
  assert.equal(persistenceAttempts, 2, 'Retry must finish setup after partial initialization');
  assert.equal(creates, 1, 'Retry reuses the existing Firebase app');
  assert.equal(observers, 1, 'Concurrent retries install only one auth observer');
  await c.initFirebase(); assert.equal(observers, 1);
  assert.equal(c.firebaseStartupError, null);
  c.currentUser = { uid: 'test' }; c.navigator.onLine = false;
  c.renderConnectionState(); assert.equal(buttons.at(-1)[1], 'Cloud offline');
  vm.runInContext(section('function setSyncBadge(', 'function setCloudButton('), c);
  c.setSyncBadge('Synced just now', 'success');
  assert.equal(buttons.at(-1)[1], 'Cloud offline', 'Offline always wins over a stale success');
  c.navigator.onLine = true;
  c.setSyncBadge('Needs sync', 'error'); assert.equal(buttons.at(-1)[1], 'Cloud error');
  c.setSyncBadge('Synced just now', 'success'); assert.equal(buttons.at(-1)[1], 'Cloud ✓');

  const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  let activate;
  const ready = new Promise(resolve => { activate = resolve; });
  const local = { navigator: { onLine: true, serviceWorker: { register: async () => ({}), ready } },
    dom: { offlineStatus: { textContent: 'Checking offline support…' } }, offlineCacheReady: false, console };
  vm.createContext(local);
  vm.runInContext(appSource.slice(appSource.indexOf('  async function registerServiceWorker()'), appSource.indexOf('  async function applyRemoteChanges(')), local);
  const installing = local.registerServiceWorker(); await Promise.resolve();
  assert.equal(local.offlineCacheReady, false, 'Registration alone does not mean assets are cached');
  activate(); await installing;
  assert.equal(local.offlineCacheReady, true);
  assert.equal(local.dom.offlineStatus.textContent, 'Online · offline cache ready');
  console.log('PASS: partial Firebase startup retries, concurrent initialization, offline/error indicators, and cache activation readiness.');
})().catch(error => { console.error(error); process.exitCode = 1; });
