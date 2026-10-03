import * as CloudReader from './modules/cloud-reader.js';
import * as Groups from './modules/groups.js';
import {app as App} from './app.js';
import * as Balls from './balls.js';
import * as UI from './ui.js';
import {friends as Friends} from './friend-stats.js';
import * as Reconciliation from './modules/reconciliation.js';
import * as IDs from './modules/ids.js';
export const cloud = (() => {
  'use strict';
  const {openDialog, closeDialog} = UI;

  const FIREBASE_SDK_VERSION = '12.17.1';
  const config = window.BOWLING_FIREBASE_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const dom = {
    openCloudBtn: $('openCloudBtn'),
    cloudButtonDot: $('cloudButtonDot'),
    cloudButtonLabel: $('cloudButtonLabel'),
    cloudDialog: $('cloudDialog'),
    closeCloudBtn: $('closeCloudBtn'),
    configMissing: $('cloudConfigMissing'),
    offlineNotice: $('cloudOfflineNotice'),
    signedOut: $('cloudSignedOut'),
    signedIn: $('cloudSignedIn'),
    cloudStatus: $('cloudStatus'),
    displayName: $('cloudDisplayNameInput'),
    email: $('cloudEmailInput'),
    password: $('cloudPasswordInput'),
    signInBtn: $('cloudSignInBtn'),
    createAccountBtn: $('cloudCreateAccountBtn'),
    resetPasswordBtn: $('cloudResetPasswordBtn'),
    accountEmail: $('cloudAccountEmail'),
    syncBadge: $('cloudSyncBadge'),
    profileDisplayName: $('profileDisplayNameInput'),
    saveProfileBtn: $('saveCloudProfileBtn'),
    syncNowBtn: $('syncNowBtn'),
    downloadCloudBackupBtn: $('downloadCloudBackupBtn'),
    deleteAccountPassword: $('deleteAccountPasswordInput'),
    deleteCloudAccountBtn: $('deleteCloudAccountBtn'),
    syncReviewSection: $('syncReviewSection'),
    syncReviewSummary: $('syncReviewSummary'),
    syncReviewList: $('syncReviewList'),
    applySyncReviewBtn: $('applySyncReviewBtn'),
    cancelSyncReviewBtn: $('cancelSyncReviewBtn'),
    signOutBtn: $('cloudSignOutBtn'),
    newGroupName: $('newGroupNameInput'),
    createGroupBtn: $('createGroupBtn'),
    joinGroupCode: $('joinGroupCodeInput'),
    joinGroupBtn: $('joinGroupBtn'),
    myGroupsList: $('myGroupsList'),
    leaderboardConnectBtn: $('leaderboardConnectBtn'),
    leaderboardManageGroupsBtn: $('leaderboardManageGroupsBtn'),
    groupSelect: $('leaderboardGroupSelect'),
    metricSelect: $('leaderboardMetricSelect'),
    leaderboardSignedOut: $('leaderboardSignedOut'),
    leaderboardNoGroup: $('leaderboardNoGroup'),
    leaderboardContent: $('leaderboardContent'),
    leaderboardGroupName: $('leaderboardGroupName'),
    leaderboardGroupCode: $('leaderboardGroupCode'),
    leaderboardMetricHeading: $('leaderboardMetricHeading'),
    leaderboardBody: $('leaderboardBody'),
    leaderboardStatus: $('leaderboardStatus'),
    refreshLeaderboardBtn: $('refreshLeaderboardBtn')
  };

  let modules = null;
  let firebaseApp = null;
  let auth = null;
  let firestore = null;
  let currentUser = null;
  let profile = null;
  let groups = [];
  let selectedGroupId = '';
  let initializing = null;
  let firebaseReady = false;
  let firebaseStartupError = null;
  let syncing = false;
  let lastSyncAt = 0;
  let pendingSyncReview = null;
  let authRevision = 0;
  let pendingLocalChanges = 0;

  const metricInfo = {
    average: { label: 'Average', format: (v) => Number(v || 0).toFixed(1), provisional: true },
    highGame: { label: 'High game', format: (v) => String(Number(v || 0)) },
    highSeries: { label: 'High series', format: (v) => String(Number(v || 0)) },
    strikePct: { label: 'Strike %', format: (v) => `${Number(v || 0).toFixed(1)}%`, provisional: true },
    cleanGames: { label: 'Clean games', format: (v) => String(Number(v || 0)) },
    totalStrikes: { label: 'Total strikes', format: (v) => String(Number(v || 0)) },
    bestSessionAvg: { label: 'Best session avg', format: (v) => Number(v || 0).toFixed(1) }
  };

  function configReady() {
    const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
    return required.every((key) => {
      const value = String(config[key] || '');
      return value && !value.includes('PASTE_');
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function setStatus(message, type = '') {
    if (!dom.cloudStatus) return;
    dom.cloudStatus.textContent = message;
    dom.cloudStatus.classList.remove('success', 'error');
    if (type) dom.cloudStatus.classList.add(type);
  }

  function setLeaderboardStatus(message, type = '') {
    if (!dom.leaderboardStatus) return;
    dom.leaderboardStatus.textContent = message;
    dom.leaderboardStatus.classList.remove('success', 'error');
    if (type) dom.leaderboardStatus.classList.add(type);
  }

  function setSyncBadge(text, state = '') {
    if (dom.syncBadge) {
      dom.syncBadge.textContent = text;
      dom.syncBadge.className = `sync-badge ${state}`.trim();
    }
    App?.setSyncStatus?.(text, state === 'success' ? 'on' : state === 'working' || state === 'pending' ? 'working' : state === 'error' ? 'error' : 'off');
    if (currentUser) {
      setCloudButton(!navigator.onLine ? 'off' : state === 'success' ? 'on' : state === 'error' ? 'error' : 'working',
        !navigator.onLine ? 'Cloud offline' : state === 'success' ? 'Cloud ✓' : state === 'error' ? 'Cloud error' : 'Cloud…');
    }
  }

  function setCloudButton(state, label) {
    if (dom.cloudButtonLabel) dom.cloudButtonLabel.textContent = 'Account & sync';
    if (dom.openCloudBtn) dom.openCloudBtn.title = label;
    if (dom.cloudButtonDot) dom.cloudButtonDot.className = `status-dot ${state}`.trim();
  }

  function friendlyError(error) {
    const code = error?.code || '';
    const map = {
      'auth/invalid-credential': 'Email or password was not accepted.',
      'auth/email-already-in-use': 'That email already has an account. Try Sign in.',
      'auth/weak-password': 'Choose a stronger password.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/too-many-requests': 'Too many attempts. Try again later.',
      'auth/network-request-failed': 'Network unavailable. Your local bowling data is still safe.',
      'auth/requires-recent-login': 'For security, sign in again and retry this account change.',
      'auth/wrong-password': 'The current password was not accepted.',
      'permission-denied': 'Cloud access was denied. Try signing in again; contact the app owner if this continues.'
    };
    return map[code] || error?.message || 'Something went wrong with cloud sync.';
  }

  function waitForBowlingApp() {
    const app = App;
    if (app?.ready) return Promise.resolve(app);
    if (app?.startupError) return Promise.reject(new Error(`App startup failed: ${app.startupError}`));
    return new Promise((resolve, reject) => {
      window.addEventListener('bowling:ready', (event) => {
        if (event.detail?.ok && App?.ready) resolve(App);
        else reject(new Error(App?.startupError || 'Local storage is unavailable. Reopen the app to retry.'));
      }, { once: true });
    });
  }

  async function loadFirebaseModules() {
    if (modules) return modules;
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`)
    ]);
    modules = { ...appModule, ...authModule, ...firestoreModule };
    return modules;
  }

  async function initFirebase() {
    if (!configReady()) {
      renderConnectionState();
      return false;
    }
    if (firebaseReady) return true;
    if (!navigator.onLine) {
      renderConnectionState();
      return false;
    }
    if (initializing) return initializing;

    initializing = (async () => {
      try {
        setCloudButton('working', 'Cloud…');
        firebaseStartupError = null;
        const fb = await loadFirebaseModules();
        firebaseApp = firebaseApp || fb.initializeApp(config);
        auth = fb.getAuth(firebaseApp);
        firestore = fb.getFirestore(firebaseApp);
        await fb.setPersistence(auth, fb.browserLocalPersistence);
        fb.onAuthStateChanged(auth, handleAuthStateChanged);
        firebaseReady = true;
        return true;
      } catch (error) {
        firebaseStartupError = error;
        console.error(error);
        setCloudButton('error', 'Cloud error');
        App?.setSyncStatus?.('Cloud unavailable · saved on device', 'error');
        setStatus(friendlyError(error), 'error');
        return false;
      } finally {
        initializing = null;
      }
    })();

    return initializing;
  }

  function renderConnectionState() {
    const configured = configReady();
    dom.configMissing?.classList.toggle('hidden', configured);
    dom.offlineNotice?.classList.toggle('hidden', navigator.onLine);

    if (!configured) {
      setCloudButton('off', 'Cloud setup');
      App?.setSyncStatus?.('Local only', 'off');
      dom.signedOut?.classList.add('hidden');
      dom.signedIn?.classList.add('hidden');
      dom.leaderboardSignedOut?.classList.remove('hidden');
      dom.leaderboardNoGroup?.classList.add('hidden');
      dom.leaderboardContent?.classList.add('hidden');
      return;
    }

    if (!navigator.onLine) {
      setCloudButton('off', 'Cloud offline');
      App?.setSyncStatus?.('Offline — saved on device', 'working');
    } else if (firebaseStartupError) {
      setCloudButton('error', 'Cloud error');
      App?.setSyncStatus?.('Cloud unavailable · saved on device', 'error');
    } else if (currentUser) {
      setCloudButton('off', 'Cloud');
    } else {
      setCloudButton('off', 'Cloud');
      App?.setSyncStatus?.('Local only', 'off');
    }

    dom.signedOut?.classList.toggle('hidden', Boolean(currentUser));
    dom.signedIn?.classList.toggle('hidden', !currentUser);
    dom.leaderboardSignedOut?.classList.toggle('hidden', Boolean(currentUser));
    if (!currentUser) {
      dom.leaderboardNoGroup?.classList.add('hidden');
      dom.leaderboardContent?.classList.add('hidden');
    }
  }

  async function userProfileRef() {
    return modules.doc(firestore, 'users', currentUser.uid);
  }

  async function loadOrCreateProfile() {
    const user = currentUser, revision = authRevision;
    const isCurrent = () => currentUser?.uid === user?.uid && revision === authRevision;
    const app = await waitForBowlingApp();
    if (!user || !isCurrent()) return null;
    const ref = modules.doc(firestore,'users',user.uid);
    const snap = await modules.getDoc(ref);
    if (!isCurrent()) return null;
    let loaded;
    if (snap.exists()) {
      loaded = snap.data();
    } else {
      const defaultBowler = (await app.getDefaultBowler()) || app.getBowlerNames()[0] || user.displayName || '';
      if (!isCurrent()) return null;
      loaded = {
        email: user.email || '',
        displayName: user.displayName || defaultBowler || 'Bowler',
        statsBowler: defaultBowler || user.displayName || 'Bowler',
        groupIds: [],
        activeGroupId: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await modules.setDoc(ref, loaded, { merge: true });
      if (!isCurrent()) return null;
    }
    loaded.groupIds = Array.isArray(loaded.groupIds) ? loaded.groupIds : [];
    profile = loaded;
    return profile;
  }

  function updateProfileBowlerOptions() {
    if (!App || !profile) return;
    profile.statsBowler = profile.displayName || currentUser?.displayName || App.getProfileName?.() || 'Bowler';
  }

  async function renderAccount() {
    renderConnectionState();
    if (!currentUser || !profile) return;
    const user = currentUser, revision = authRevision, loaded = profile;
    dom.accountEmail.textContent = user.email || 'Signed in';
    dom.profileDisplayName.value = loaded.displayName || user.displayName || '';
    await App?.setProfileName?.(loaded.displayName || user.displayName || 'Bowler', {expectedUid:user.uid});
    if (currentUser?.uid !== user.uid || authRevision !== revision || profile !== loaded) return;
    updateProfileBowlerOptions();
    await loadGroups();
  }

  async function handleAuthStateChanged(user) {
    authRevision += 1;
    const revision = authRevision;
    const stillCurrent = () => revision === authRevision;
    pendingLocalChanges = 0;
    lastSyncAt = 0;
    hideSyncReview();
    currentUser = user || null;
    resetLeaderboardView();
    profile = null;
    groups = [];
    selectedGroupId = '';
    renderConnectionState();

    let app;
    try { app = await waitForBowlingApp(); }
    catch (error) { if (stillCurrent()) { setSyncBadge('Startup failed','error'); setStatus(friendlyError(error),'error'); } return; }
    if (!stillCurrent()) return;

    if (!currentUser) {
      // A persisted Firebase session may expire in another tab. If this browser
      // was showing an account-specific local database, return to the isolated
      // signed-out/guest database instead of leaving another user's games visible.
      if (app.getLocalScopeInfo?.().kind === 'user') await app.activateGuest?.();
      if (!stillCurrent()) return;
      if (dom.deleteAccountPassword) dom.deleteAccountPassword.value = '';
      setSyncBadge('Local only');
      renderGroups();
      renderLeaderboardShell();
      return;
    }

    try {
      setCloudButton('working', 'Cloud…');

      const localScope = app.getLocalScopeInfo?.() || { kind: 'guest', gameCount: 0 };
      let importCurrent = false;
      if (localScope.kind === 'guest' && Number(localScope.gameCount || 0) > 0) {
        const accountLocalCount = await app.getAccountLocalGameCount?.(currentUser.uid) || 0;
        if (!stillCurrent()) return;
        if (accountLocalCount === 0) {
          importCurrent = window.confirm(
            `This browser has ${localScope.gameCount} game${localScope.gameCount === 1 ? '' : 's'} saved while signed out. Add ${localScope.gameCount === 1 ? 'it' : 'them'} to ${currentUser.email || 'this account'}?\n\nChoose Cancel to keep the signed-out history separate.`
          );
        }
      }

      await app.activateAccount?.(currentUser.uid, { importCurrent });
      if (!stillCurrent()) return;
      await loadOrCreateProfile();
      if (!stillCurrent()) return;
      await renderAccount();
      if (!stillCurrent()) return;
      await syncAll('Signed in');
      if (!stillCurrent()) return;
    } catch (error) {
      if (!stillCurrent()) return;
      console.error(error);
      setStatus(friendlyError(error), 'error');
      setCloudButton('error', 'Cloud error');
      setSyncBadge('Needs sync', 'error');
    }
  }

  function cloudGameRef(id) {
    return modules.doc(firestore, 'users', currentUser.uid, 'games', String(id));
  }

  function cloudGamePayload(...args) { return Reconciliation.cloudGamePayload(...args); }

  function cloudDeletePayload(...args) { return Reconciliation.cloudDeletePayload(...args); }

  function normalizedSessionName(...args) { return Reconciliation.normalizedSessionName(...args); }

  function comparableGame(...args) { return Reconciliation.comparableGame(...args); }

  function sameGameContent(...args) { return Reconciliation.sameGameContent(...args); }

  function gameReviewHtml(label, game) {
    if (!game) return `<div class="sync-review-game"><strong>${escapeHtml(label)}</strong>Deleted</div>`;
    return `<div class="sync-review-game">
      <strong>${escapeHtml(label)}</strong>
      ${game.gameOrder !== undefined ? `Game order: ${escapeHtml(game.gameOrder)}<br>` : ''}${escapeHtml(Balls.summary(game))}<br>${game.alley ? `Alley: ${escapeHtml(game.alley)}<br>` : ''}${escapeHtml(game.date)} · ${escapeHtml(game.sessionType || 'League')}<br>
      ${game.noTap === true ? 'No-tap · excluded from standard stats' : 'Standard scoring'}<br>
      Score ${Number(game.score)} · ${game.scoreOnly === true ? 'Score only' : `${Number(game.openFrames)} open · ${Number(game.strikes)}/${Number(game.strikeOpportunities || 10)} strikes`}
      ${game.notes ? `<br>${escapeHtml(game.notes)}` : ''}
    </div>`;
  }

  function detectSyncIssues(...args) { return Reconciliation.detectSyncIssues(...args); }

  function renderSyncReview(issues, localCount, cloudCount) {
    pendingSyncReview = { issues };
    if (!dom.syncReviewSection || !dom.syncReviewList) return;

    dom.syncReviewSection.classList.remove('hidden');
    dom.syncReviewSummary.textContent = `${localCount} game${localCount === 1 ? '' : 's'} on this device · ${cloudCount} live game${cloudCount === 1 ? '' : 's'} in the cloud · ${issues.length} item${issues.length === 1 ? '' : 's'} need review.`;

    dom.syncReviewList.innerHTML = issues.map((issue) => {
      if (issue.type === 'version-conflict') {
        return `<div class="sync-review-item" data-sync-issue="${escapeHtml(issue.key)}">
          <div class="sync-review-title">Same saved game has different details</div>
          <div class="sync-review-copy">This exact saved game was edited on this device and in the cloud before either edit could see the other. Choose which version is correct.</div>
          <div class="sync-review-compare">
            ${gameReviewHtml('This device', issue.local)}
            ${gameReviewHtml('Cloud', issue.remote)}
          </div>
          <label>Keep
            <select data-sync-choice>
              <option value="">Choose…</option>
              <option value="local">This device copy</option>
              <option value="cloud">Cloud copy</option>
            </select>
          </label>
        </div>`;
      }

      if (issue.type === 'delete-conflict') {
        const live = issue.liveSide === 'local' ? issue.local : issue.remote;
        const deletedWhere = issue.liveSide === 'local' ? 'cloud' : 'this device';
        return `<div class="sync-review-item" data-sync-issue="${escapeHtml(issue.key)}">
          <div class="sync-review-title">Edit vs. deletion conflict</div>
          <div class="sync-review-copy">This exact saved game was changed on one device while the other device deleted it. Nothing will be erased until you choose.</div>
          <div class="sync-review-compare">
            ${gameReviewHtml('Game copy', live)}
            ${gameReviewHtml(`Deleted on ${deletedWhere}`, null)}
          </div>
          <label>Resolve as
            <select data-sync-choice>
              <option value="">Choose…</option>
              <option value="keep-game">Keep the game</option>
              <option value="keep-deleted">Keep it deleted</option>
            </select>
          </label>
        </div>`;
      }

      return '';
    }).join('');
  }

  function hideSyncReview() {
    dom.syncReviewSection?.classList.add('hidden');
    if (dom.syncReviewList) dom.syncReviewList.innerHTML = '';
    pendingSyncReview = null;
  }

  function collectSyncReviewChoices() {
    if (!pendingSyncReview || !dom.syncReviewList) return null;
    const choices = {};
    for (const issue of pendingSyncReview.issues) {
      const item = [...dom.syncReviewList.querySelectorAll('[data-sync-issue]')]
        .find((node) => node.dataset.syncIssue === issue.key);
      const value = item?.querySelector('[data-sync-choice]')?.value || '';
      if (!value) return null;
      choices[issue.key] = value;
    }
    return choices;
  }

  function withServerTimestamp(data) { return modules.serverTimestamp ? {...data, serverUpdatedAt: modules.serverTimestamp()} : data; }
  function readOutbox(uid) { return App.getSyncOutbox(uid); }
  async function flushOutbox(uid, isCurrent, localGameMap, tombstoneMap) {
    const items = await readOutbox(uid), entries = Object.entries(items);
    for (let i=0;i<entries.length;i+=100) {
      const chunk = entries.slice(i,i+100);
      const acknowledged = await modules.runTransaction(firestore, async tx => {
        if (!await isCurrent()) throw reconciliationChangedError();
        const refs = chunk.map(([id])=>modules.doc(firestore,'users',uid,'games',id));
        const snapshots = await Promise.all(refs.map(ref=>tx.get(ref)));
        if (!await isCurrent()) throw reconciliationChangedError();
        const done = [];
        chunk.forEach(([id,item],j) => {
          const local = localGameMap.get(IDs.recordId(id)) || (tombstoneMap.has(IDs.recordId(id)) ? {...tombstoneMap.get(IDs.recordId(id)),deleted:true} : null);
          // A later import or another tab may have changed the local record.
          if (!sameCloudVersion(local,item.data)) { done.push(id); return; }
          const remote = snapshots[j].exists() ? snapshots[j].data() : null;
          if (sameCloudVersion(remote,item.data)) {done.push(id);return;}
          if (sameCloudVersion(remote,item.base)) {tx.set(refs[j],withServerTimestamp(item.data));done.push(id);}
        });
        return done;
      });
      await acknowledgeOutbox(uid,Object.fromEntries(acknowledged.map(id=>[id,items[id]])));
      if (!await isCurrent()) return;
    }
  }

  function acknowledgeOutbox(uid, items, acceptedVersions) { return App.acknowledgeSyncOutbox(items,uid,acceptedVersions); }

  function sameCloudVersion(...args) { return Reconciliation.sameCloudVersion(...args); }
  async function guardedWrites(operations, expected, isCurrent) {
    if (!operations.length) return;
    // Bound each transaction to stay below Firestore's request limits.
    for (let i=0; i<operations.length; i+=100) {
      const chunk = operations.slice(i,i+100);
      await modules.runTransaction(firestore, async transaction => {
        if (!await isCurrent()) throw reconciliationChangedError();
        const snapshots = await Promise.all(chunk.map(op => transaction.get(op.ref)));
        if (!await isCurrent()) throw reconciliationChangedError();
        snapshots.forEach((snap,j) => {
          const id = IDs.recordId(chunk[j].data.id), remote = snap.exists() ? snap.data() : null;
          if (!sameCloudVersion(remote,expected.get(id) || null)) {
            const error = new Error('Cloud history changed during sync. Sync again to review the latest versions.'); error.code='bowling/conflict'; throw error;
          }
        });
        chunk.forEach(op => transaction.set(op.ref,withServerTimestamp(op.data)));
      });
    }
  }

  function syncAll(reason = 'Sync', reviewChoices = null) {
    const uid = currentUser?.uid;
    const task = localChangeQueue.then(() => currentUser?.uid === uid ? performSyncAll(reason, reviewChoices) : undefined);
    localChangeQueue = task.catch(() => {});
    return task;
  }

  async function performSyncAll(reason = 'Sync', reviewChoices = null) {
    const revision = localChangeRevision;
    const authVersion = authRevision;
    const uid = currentUser?.uid;
    const isCurrentAccount = () => currentUser?.uid === uid && authVersion === authRevision;
    if (!currentUser || !firestore || syncing) return;
    if (!navigator.onLine) {
      const waiting = pendingLocalChanges ? `${pendingLocalChanges} change${pendingLocalChanges === 1 ? '' : 's'} waiting` : 'Offline — saved on device';
      setSyncBadge(waiting, 'pending');
      setStatus('Offline: changes are saved locally and will sync when you reconnect.');
      return;
    }

    syncing = true;
    setSyncBadge('Syncing…', 'working');
    setStatus(`${reason}: syncing your games…`);

    try {
      const app = await waitForBowlingApp();
      if (!isCurrentAccount()) return;
      if (app.isLocalScopeReady?.() === false) return;
      if (app.getLocalScopeInfo && app.getLocalScopeInfo().uid !== uid) return;
      const inventories = [
        ['ballInventory', app.getBallInventory, app.mergeBallInventory],
        ['alleyInventory', app.getAlleyInventory, app.mergeAlleyInventory]
      ].filter(([, get]) => get).map(([key, get, merge]) => ({key, local: get(), merge}));
      if (inventories.length) {
        const ref = modules.doc(firestore, 'users', uid);
        const merged = await modules.runTransaction(firestore, async transaction => {
          const snapshot = await transaction.get(ref);
          if (!isCurrentAccount()) return null;
          const remote = snapshot.exists() ? snapshot.data() : {};
          const result = {}, changed = {};
          for (const {key, local} of inventories) {
            result[key] = Balls.mergeInventory(remote[key], local);
            if (JSON.stringify(result[key]) !== JSON.stringify(remote[key] || [])) changed[key] = result[key];
          }
          if (Object.keys(changed).length) transaction.set(ref, changed, {merge: true});
          return result;
        });
        if (!isCurrentAccount()) return;
        if (merged) for (const {key, merge} of inventories) {
          await merge(merged[key], uid);
          if (!isCurrentAccount()) return;
          if (profile) profile[key] = merged[key];
        }
      }
      const snapshot = app.getSyncState ? await app.getSyncState(uid) : {games:app.getGames(),tombstones:await app.getTombstones(),outbox:await readOutbox(uid)};
      const localGames = snapshot.games, localTombstones = snapshot.tombstones;
      let savedRevision = snapshot.revision;
      const historyIsCurrent = async () => {
        const currentRevision = savedRevision === undefined ? undefined : await app.getHistoryRevision(uid);
        return isCurrentAccount() && revision === localChangeRevision && currentRevision === savedRevision;
      };
      if (!isCurrentAccount()) return;
      const localGameMap = new Map(localGames.map((game) => [IDs.recordId(game.id), game]));
      const tombstoneMap = new Map(localTombstones.map((t) => [IDs.recordId(t.id), t]));
      await flushOutbox(uid, historyIsCurrent,localGameMap,tombstoneMap);
      if (!await historyIsCurrent()) throw reconciliationChangedError();
      const remoteHistory = await CloudReader.readRemoteHistory({sdk: modules, firestore, uid,
        isCurrent: () => isCurrentAccount() && revision === localChangeRevision,
        protocol: profile?.syncProtocolVersion,
        baseline: app.getSyncBaseline ? await app.getSyncBaseline(uid) : null});
      const remoteMap = remoteHistory.records;
      if (!isCurrentAccount() || revision !== localChangeRevision) return;

      if (!await historyIsCurrent()) throw reconciliationChangedError();
      const pending = await readOutbox(uid);
      const plan = Reconciliation.planSync({localGameMap, tombstoneMap, remoteMap, syncOutbox: pending, reviewChoices, reviewedIssues: pendingSyncReview?.issues});
      const {issues, unresolved, localUpserts, localDeletes} = plan;
      const cloudWrites = plan.cloudWrites.map(({id, data}) => ({ref: cloudGameRef(id), data}));

      if (!isCurrentAccount() || revision !== localChangeRevision) return;
      if (cloudWrites.length) await guardedWrites(cloudWrites,remoteMap,historyIsCurrent);
      if (!await historyIsCurrent()) throw reconciliationChangedError();
      if (localUpserts.length || localDeletes.length) {
        const appliedRevision = await app.applyRemoteChanges({ upserts: localUpserts, deletes: localDeletes, expectedUid: uid, expectedRevision:savedRevision });
        if (savedRevision !== undefined) savedRevision = appliedRevision;
      }
      if (!isCurrentAccount()) return;
      await app.reloadSavedHistory?.();
      if (!await historyIsCurrent()) throw reconciliationChangedError();
      await publishAllSummaries();
      if (!await historyIsCurrent()) throw reconciliationChangedError();
      if (remoteHistory.snapshot && app.saveSyncBaseline) await app.saveSyncBaseline(remoteHistory.snapshot, uid);
      if (!isCurrentAccount() || revision !== localChangeRevision) return;
      if (unresolved.length) {
        renderSyncReview(issues,app.getGames().length,[...remoteMap.values()].filter(g=>!g.deleted).length);
        setSyncBadge('Review needed','pending');
        setStatus(`Other games synced. ${unresolved.length} conflicting item${unresolved.length===1?'':'s'} still need review in Profile → Account & sync.`);
        return;
      }
      hideSyncReview();
      // Reaching this point means every currently queued local change has
      // either been written, downloaded, or explicitly resolved. Because the
      // sync is revision-guarded, clearing the outbox here cannot erase a newer
      // local edit that arrived during this pass.
      const accepted = Object.fromEntries([...localGames,...localTombstones.map(t => ({...t,deleted:true})),
        ...localUpserts,...localDeletes.map(t => ({...t,deleted:true})),...cloudWrites.map(op => op.data)].map(version => [version.id,version]));
      await acknowledgeOutbox(uid,pending,accepted);
      if (!await historyIsCurrent()) throw reconciliationChangedError();
      pendingLocalChanges = 0;
      lastSyncAt = Date.now();
      setSyncBadge('Synced just now', 'success');
      setStatus(`Synced ${app.getGames().length} local game${app.getGames().length === 1 ? '' : 's'} with your account.`, 'success');
      await loadLeaderboard();
    } catch (error) {
      console.error(error);
      if (!isCurrentAccount()) return;
      if (error?.code === 'bowling/conflict' || error?.code === 'bowling/local-conflict') {
        setSyncBadge('Refreshing cloud…', 'working');
        setStatus('Cloud history changed during sync. Refreshing automatically…');
        setTimeout(() => {
          if (currentUser?.uid === uid && navigator.onLine) syncAll('Automatic retry');
        }, 0);
        return;
      }
      setSyncBadge('Saved on this device · needs sync', 'error');
      setStatus(`Sync paused: ${friendlyError(error)}`, 'error');
    } finally {
      syncing = false;
    }
  }

  function reconciliationChangedError() {
    const error = new Error('Saved history changed during sync. Retrying with the current history.');
    error.code = 'bowling/local-conflict';
    return error;
  }

  function randomGroupCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint32Array(8);
    crypto.getRandomValues(bytes);
    return [...bytes].map((n) => alphabet[n % alphabet.length]).join('');
  }

  async function setProfileGroupIds(groupIds, activeGroupId = selectedGroupId) {
    const user = currentUser, revision = authRevision, target = profile;
    if (!user || !target) return;
    const unique = [...new Set(groupIds)];
    const active = activeGroupId && unique.includes(activeGroupId) ? activeGroupId : (unique[0] || '');
    const updatedAt = Date.now();
    await modules.setDoc(modules.doc(firestore,'users',user.uid), {
      groupIds: unique,
      activeGroupId: active,
      updatedAt
    }, { merge: true });
    if (currentUser?.uid !== user.uid || authRevision !== revision || profile !== target) return;
    Object.assign(target,{groupIds:unique,activeGroupId:active,updatedAt});
  }

  async function memberPayload() {
    const uid = currentUser?.uid, revision = authRevision;
    const app = await waitForBowlingApp();
    if (!uid || currentUser?.uid !== uid || revision !== authRevision || app.getLocalScopeInfo().uid !== uid) throw new Error('Account changed while preparing leaderboard stats.');
    const displayName = profile.displayName || currentUser.displayName || app.getProfileName?.() || 'Bowler';
    const summary = app.getLeaderboardSummary(displayName);
    return {
      uid,
      displayName,
      statsBowler: displayName,
      ...summary
    };
  }

  async function publishSummaryToGroup(groupId) {
    if (!currentUser || !groupId) return;
    const uid = currentUser.uid, revision = authRevision;
    const payload = await memberPayload();
    if (currentUser?.uid !== uid || revision !== authRevision) return;
    const ref = modules.doc(firestore, 'groups', groupId, 'members', uid);
    await modules.setDoc(ref, payload, { merge: true });
  }

  async function publishAllSummaries() {
    if (!profile?.groupIds?.length || !navigator.onLine) return;
    for (const groupId of profile.groupIds) {
      try {
        await publishSummaryToGroup(groupId);
      } catch (error) {
        console.warn('Could not publish leaderboard summary for', groupId, error);
      }
    }
  }

  async function createGroup() {
    const name = dom.newGroupName.value.trim();
    if (!name) {
      setStatus('Enter a group name first.', 'error');
      return;
    }
    if (!await initFirebase() || !currentUser) return;
    const user = currentUser, revision = authRevision, target = profile;
    const isCurrent = () => currentUser?.uid === user.uid && authRevision === revision && profile === target;
    if (!target) return;

    try {
      setStatus('Creating private group…');
      let createdCode = '';
      for (let attempt = 0; attempt < 5 && !createdCode; attempt += 1) {
        const code = randomGroupCode();
        const ref = modules.doc(firestore, 'groups', code);
        try {
          await modules.setDoc(ref, {
            name,
            code,
            ownerUid: user.uid,
            createdAt: Date.now(),
            updatedAt: Date.now()
          });
          if (!isCurrent()) return;
          createdCode = code;
        } catch (error) {
          if (!isCurrent()) return;
          if (error.code !== 'permission-denied') throw error;
        }
      }
      if (!createdCode) throw new Error('Could not create a unique group code. Try again.');

      await setProfileGroupIds([...profile.groupIds, createdCode], createdCode);
      if (!isCurrent()) return;
      resetLeaderboardView();
      selectedGroupId = createdCode;
      await publishSummaryToGroup(createdCode);
      if (!isCurrent()) return;
      dom.newGroupName.value = '';
      await loadGroups();
      if (!isCurrent()) return;
      setStatus(`Group created. Share invite code ${createdCode}.`, 'success');
    } catch (error) {
      if (!isCurrent()) return;
      console.error(error);
      setStatus(friendlyError(error), 'error');
    }
  }

  async function joinGroup() {
    const code = dom.joinGroupCode.value.trim().toUpperCase().replace(/\s+/g, '');
    if (!code) {
      setStatus('Enter the invite code.', 'error');
      return;
    }
    if (!await initFirebase() || !currentUser) return;
    const user = currentUser, revision = authRevision, target = profile;
    const isCurrent = () => currentUser?.uid === user.uid && authRevision === revision && profile === target;
    if (!target) return;

    try {
      setStatus('Checking invite code…');
      const ref = modules.doc(firestore, 'groups', code);
      const snap = await modules.getDoc(ref);
      if (!isCurrent()) return;
      if (!snap.exists()) throw new Error('No group was found with that invite code.');
      await publishSummaryToGroup(code);
      if (!isCurrent()) return;
      await setProfileGroupIds([...profile.groupIds, code], code);
      if (!isCurrent()) return;
      resetLeaderboardView();
      selectedGroupId = code;
      dom.joinGroupCode.value = '';
      await loadGroups();
      if (!isCurrent()) return;
      setStatus(`Joined ${snap.data().name || code}.`, 'success');
    } catch (error) {
      if (!isCurrent()) return;
      console.error(error);
      setStatus(friendlyError(error), 'error');
    }
  }

  async function leaveGroup(groupId) {
    if (!currentUser || !profile || !groupId) return;
    const group = groups.find((item) => item.id === groupId);
    const label = group?.name || groupId;
    if (!window.confirm(`Leave ${label}? Your bowling account and private game history will not be deleted.`)) return;

    try {
      setStatus(`Leaving ${label}…`);
      const uid = currentUser.uid, revision = authRevision;
      await Groups.leaveMembership({sdk: modules, firestore, groupId, uid,
        isCurrent: () => currentUser?.uid === uid && authRevision === revision});
      if (currentUser?.uid !== uid || authRevision !== revision) return;
      const remaining = (profile.groupIds || []).filter((id) => id !== groupId);
      await setProfileGroupIds(remaining, remaining.includes(selectedGroupId) ? selectedGroupId : (remaining[0] || ''));
      if (currentUser?.uid !== uid || authRevision !== revision) return;
      if (selectedGroupId !== (profile.activeGroupId || '')) resetLeaderboardView();
      selectedGroupId = profile.activeGroupId || '';
      await loadGroups();
      setStatus(`Left ${label}.`, 'success');
    } catch (error) {
      console.error(error);
      setStatus(friendlyError(error), 'error');
    }
  }

  async function loadGroups() {
    if (!currentUser || !profile) {
      groups = [];
      selectedGroupId = '';
      renderGroups();
      renderLeaderboardShell();
      return;
    }

    const uid = currentUser.uid, revision = authRevision, targetProfile = profile;
    const isCurrent = () => currentUser?.uid === uid && authRevision === revision && profile === targetProfile;
    const loaded = [];
    for (const groupId of [...new Set(targetProfile.groupIds || [])]) {
      try {
        const snap = await modules.getDoc(modules.doc(firestore, 'groups', groupId));
        if (!isCurrent()) return;
        if (snap.exists()) loaded.push({ ...snap.data(), id: groupId });
      } catch (error) {
        if (!isCurrent()) return;
        // Retain an already loaded group during a transient read failure.
        const cached = groups.find(group => group.id === groupId);
        if (cached) loaded.push(cached);
        console.warn('Could not load group', groupId, error);
      }
    }
    if (!isCurrent()) return;
    groups = loaded;
    const nextGroupId = loaded.some(group => group.id === targetProfile.activeGroupId)
      ? targetProfile.activeGroupId : (loaded[0]?.id || '');
    if (nextGroupId !== selectedGroupId) resetLeaderboardView();
    selectedGroupId = nextGroupId;
    renderGroups();
    renderLeaderboardShell();
    if (selectedGroupId) await loadLeaderboard();
  }

  function renderGroups() {
    if (!dom.myGroupsList || !dom.groupSelect) return;
    dom.groupSelect.disabled = !currentUser || !groups.length;
    dom.groupSelect.innerHTML = groups.length
      ? groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name || g.id)}</option>`).join('')
      : '<option value="">No groups yet</option>';
    if (selectedGroupId && groups.some((g) => g.id === selectedGroupId)) dom.groupSelect.value = selectedGroupId;

    dom.myGroupsList.innerHTML = groups.length
      ? groups.map((g) => `
        <div class="my-group-row ${g.id === selectedGroupId ? 'active' : ''}">
          <div><strong>${escapeHtml(g.name || 'Bowling Group')}</strong><span>${escapeHtml(g.id)}</span></div>
          <div class="group-row-actions">
            <button class="text-btn choose-group" data-group="${escapeHtml(g.id)}" type="button">View</button>
            <button class="text-btn danger-text leave-group" data-group="${escapeHtml(g.id)}" type="button">Leave</button>
          </div>
        </div>`).join('')
      : '<p class="small-note">You have not joined any groups yet.</p>';

    dom.myGroupsList.querySelectorAll('.choose-group').forEach((button) => {
      button.addEventListener('click', async () => selectGroup(button.dataset.group));
    });
    dom.myGroupsList.querySelectorAll('.leave-group').forEach((button) => {
      button.addEventListener('click', async () => leaveGroup(button.dataset.group));
    });
  }

  async function selectGroup(groupId) {
    if (!currentUser || !profile || !groupId || !groups.some((g) => g.id === groupId)) return;
    if (groupId !== selectedGroupId) resetLeaderboardView();
    selectedGroupId = groupId;
    const user = currentUser, revision = authRevision, target = profile;
    await modules.setDoc(modules.doc(firestore,'users',user.uid), { activeGroupId: groupId, updatedAt: Date.now() }, { merge: true });
    if (currentUser?.uid !== user.uid || authRevision !== revision || profile !== target) return;
    target.activeGroupId = groupId;
    renderGroups();
    renderLeaderboardShell();
    await loadLeaderboard();
  }

  function resetLeaderboardView() {
    Friends?.clear();
    dom.leaderboardBody.innerHTML = '';
  }

  function renderLeaderboardShell() {
    if (!currentUser) {
      resetLeaderboardView();
      dom.leaderboardSignedOut.classList.remove('hidden');
      dom.leaderboardNoGroup.classList.add('hidden');
      dom.leaderboardContent.classList.add('hidden');
      return;
    }
    if (!groups.length || !selectedGroupId) {
      resetLeaderboardView();
      dom.leaderboardSignedOut.classList.add('hidden');
      dom.leaderboardNoGroup.classList.remove('hidden');
      dom.leaderboardContent.classList.add('hidden');
      return;
    }
    const group = groups.find((g) => g.id === selectedGroupId);
    dom.leaderboardSignedOut.classList.add('hidden');
    dom.leaderboardNoGroup.classList.add('hidden');
    dom.leaderboardContent.classList.remove('hidden');
    dom.leaderboardGroupName.textContent = group?.name || 'Bowling Group';
    dom.leaderboardGroupCode.textContent = `Invite code ${selectedGroupId}`;
  }

  let leaderboardRequest = 0;
  async function loadLeaderboard() {
    const request = ++leaderboardRequest, uid = currentUser?.uid, groupId = selectedGroupId, revision = authRevision;
    const current = () => request === leaderboardRequest && uid === currentUser?.uid && groupId === selectedGroupId && revision === authRevision;
    if (!currentUser || !selectedGroupId || !navigator.onLine) {
      if (currentUser && selectedGroupId) setLeaderboardStatus('Offline · showing the last loaded leaderboard');
      return;
    }
    try {
      setLeaderboardStatus('Refreshing…');
      const snap = await modules.getDocs(modules.collection(firestore, 'groups', selectedGroupId, 'members'));
      if (!current()) return;
      const members = [];
      snap.forEach((item) => { const data = item.data(); members.push({ ...data, uid: item.id || data.uid }); });
      renderLeaderboardRows(members);
      setLeaderboardStatus(`Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`, 'success');
    } catch (error) {
      console.error(error);
      if (current()) {
        if (error.code === 'permission-denied') renderLeaderboardRows([]);
        setLeaderboardStatus(friendlyError(error), 'error');
      }
    }
  }

  function renderLeaderboardRows(members) {
    Friends?.setMembers(members, { uid: currentUser?.uid, groupId: selectedGroupId, revision: authRevision });
    const metric = dom.metricSelect.value || 'average';
    const info = metricInfo[metric] || metricInfo.average;
    dom.leaderboardMetricHeading.textContent = info.label;
    const needsRefresh = member => (Number(member.noTapGames || 0) > 0 && member.standardStatsUpdatedAt !== member.updatedAt)
      || (Number(member.scoreOnlyGames || 0) > 0 && member.frameStatsUpdatedAt !== member.updatedAt);
    const frameMetric = ['strikePct', 'cleanGames', 'totalStrikes'].includes(metric);
    const eligible = member => !needsRefresh(member) && Number(member.games || 0) > 0
      && (!frameMetric || (member[metric] != null && member.frameStatsGames !== 0));
    const sorted = [...members].sort((a, b) => Number(eligible(b)) - Number(eligible(a))
      || (eligible(a) && eligible(b) ? Number(b[metric] || 0) - Number(a[metric] || 0) : 0)
      || String(a.displayName || '').localeCompare(String(b.displayName || '')));

    if (!sorted.length) {
      dom.leaderboardBody.innerHTML = '<tr><td colspan="4" class="empty-table-cell">No leaderboard entries yet.</td></tr>';
      return;
    }

    let rank = 0;
    dom.leaderboardBody.innerHTML = sorted.map((member) => {
      const stale = needsRefresh(member), ranked = eligible(member);
      const provisional = ranked && info.provisional && Number(member.games || 0) < 10;
      const you = member.uid === currentUser?.uid;
      return `
        <tr class="${you ? 'you-row' : ''}">
          <td><span class="rank-badge">${ranked ? ++rank : '—'}</span></td>
          <td><button class="leaderboard-bowler" type="button" data-member-uid="${escapeHtml(member.uid)}" aria-haspopup="dialog" aria-controls="friendStatsDialog"><span class="bowler-avatar" aria-hidden="true">${escapeHtml(String(member.displayName || 'Bowler').trim().split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase())}</span><strong>${escapeHtml(member.displayName || 'Bowler')}${you ? ' · You' : ''}</strong></button>${stale ? '<span class="provisional">Open the updated app and sync</span>' : !ranked ? `<span class="provisional">${frameMetric && Number(member.games || 0) > 0 ? 'No frame details' : 'No standard games'}</span>` : provisional ? '<span class="provisional">Provisional</span>' : ''}</td>
          <td class="leader-value">${ranked ? escapeHtml(info.format(member[metric])) : '—'}</td>
          <td>${stale ? '—' : Number(member.games || 0)}</td>
        </tr>`;
    }).join('');
  }

  async function saveProfile() {
    if (!currentUser || !profile) return;
    const displayName = dom.profileDisplayName.value.trim();
    if (!displayName) {
      setStatus('Enter a display name.', 'error');
      return;
    }
    const user = currentUser, revision = authRevision, target = profile;
    const isCurrent = () => currentUser?.uid === user.uid && revision === authRevision && profile === target;
    const updatedAt = Date.now();
    try {
      await modules.updateProfile(user, { displayName });
      if (!isCurrent()) return;
      await modules.setDoc(modules.doc(firestore,'users',user.uid), {
        displayName,
        statsBowler: displayName,
        email: user.email || '',
        updatedAt
      }, { merge: true });
      if (!isCurrent()) return;
      Object.assign(target,{displayName,statsBowler:displayName,updatedAt});
      const app = await waitForBowlingApp();
      if (!isCurrent()) return;
      await app.setProfileName?.(displayName,{expectedUid:user.uid});
      if (!isCurrent()) return;
      await publishAllSummaries();
      if (!isCurrent()) return;
      await loadLeaderboard();
      if (!isCurrent()) return;
      setStatus('Cloud profile saved.', 'success');
    } catch (error) {
      if (!isCurrent()) return;
      console.error(error);
      setStatus(friendlyError(error), 'error');
    }
  }

  async function createAccount() {
    const displayName = dom.displayName.value.trim();
    const email = dom.email.value.trim();
    const password = dom.password.value;
    if (!displayName || !email || !password) {
      setStatus('Enter a display name, email, and password.', 'error');
      return;
    }
    if (password.length < 6) {
      setStatus('Use a password with at least 6 characters.', 'error');
      return;
    }
    if (!await initFirebase()) return;
    try {
      setStatus('Creating account…');
      const credential = await modules.createUserWithEmailAndPassword(auth, email, password);
      await modules.updateProfile(credential.user, { displayName });
      await modules.setDoc(modules.doc(firestore, 'users', credential.user.uid), {
        email,
        displayName,
        statsBowler: displayName,
        groupIds: [],
        activeGroupId: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }, { merge: true });
      dom.password.value = '';
      setStatus('Account created. Your local games will sync automatically.', 'success');
    } catch (error) {
      console.error(error);
      setStatus(friendlyError(error), 'error');
    }
  }

  async function signIn() {
    const email = dom.email.value.trim();
    const password = dom.password.value;
    if (!email || !password) {
      setStatus('Enter your email and password.', 'error');
      return;
    }
    if (!await initFirebase()) return;
    try {
      setStatus('Signing in…');
      await modules.signInWithEmailAndPassword(auth, email, password);
      dom.password.value = '';
    } catch (error) {
      console.error(error);
      setStatus(friendlyError(error), 'error');
    }
  }

  async function resetPassword() {
    const email = dom.email.value.trim();
    if (!email) {
      setStatus('Enter your email first, then tap Reset password.', 'error');
      return;
    }
    if (!await initFirebase()) return;
    try {
      await modules.sendPasswordResetEmail(auth, email);
      setStatus('Password reset email sent.', 'success');
    } catch (error) {
      console.error(error);
      setStatus(friendlyError(error), 'error');
    }
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function localDateStamp() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  async function downloadCloudBackup() {
    if (!currentUser || !firestore) {
      setStatus('Sign in before downloading a cloud backup.', 'error');
      return;
    }
    if (!navigator.onLine) {
      setStatus('Cloud backup needs an internet connection. Your local Export backup still works offline.', 'error');
      return;
    }

    const user = currentUser, revision = authRevision;
    const isCurrent = () => currentUser?.uid === user.uid && authRevision === revision;
    const savedProfile = profile ? {...profile} : null;
    try {
      dom.downloadCloudBackupBtn.disabled = true;
      setStatus('Reading your cloud bowling history…');

      const [gameSnap, profileSnap] = await Promise.all([
        modules.getDocs(modules.collection(firestore, 'users', user.uid, 'games')),
        modules.getDoc(modules.doc(firestore, 'users', user.uid))
      ]);
      if (!isCurrent()) return;
      const cloudProfile = profileSnap.exists() ? profileSnap.data() : savedProfile;
      const games = [];
      const tombstones = [];
      gameSnap.forEach((item) => {
        const value = item.data();
        if (value.deleted) {
          tombstones.push({
            id: IDs.recordId(value.id ?? item.id),
            updatedAt: Number(value.updatedAt || 0)
          });
        } else {
          games.push(value);
        }
      });

      const memberships = [];
      for (const groupId of [...new Set(cloudProfile?.groupIds || [])]) {
        try {
          const groupRef = modules.doc(firestore, 'groups', groupId);
          const memberRef = modules.doc(firestore, 'groups', groupId, 'members', user.uid);
          const [groupSnap, memberSnap] = await Promise.all([
            modules.getDoc(groupRef),
            modules.getDoc(memberRef)
          ]);
          if (!isCurrent()) return;
          if (groupSnap.exists() || memberSnap.exists()) {
            const groupData = groupSnap.exists() ? groupSnap.data() : {};
            memberships.push({
              id: groupId,
              name: groupData.name || groupId,
              code: groupData.code || groupId,
              ownedByAccount: groupData.ownerUid === user.uid,
              member: memberSnap.exists() ? memberSnap.data() : null
            });
          }
        } catch (error) {
          console.warn('Could not include group in cloud backup', groupId, error);
        }
      }

      if (!isCurrent()) return;
      const payload = {
        app: 'Bowling Tracker',
        version: App?.version || 'unknown',
        backupType: 'firebase-cloud',
        exportedAt: new Date().toISOString(),
        profileName: cloudProfile?.displayName || user.displayName || 'Bowler',
        account: {
          email: user.email || '',
          displayName: cloudProfile?.displayName || user.displayName || ''
        },
        profile: cloudProfile,
        ballInventory: cloudProfile?.ballInventory || [],
        alleyInventory: cloudProfile?.alleyInventory || [],
        games: games.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)),
        tombstones: tombstones.sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0)),
        groupMemberships: memberships
      };

      downloadJson(`bowling-cloud-backup-${localDateStamp()}.json`, payload);
      setStatus(`Cloud backup downloaded: ${games.length} live game${games.length === 1 ? '' : 's'} plus ${tombstones.length} deletion record${tombstones.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      console.error(error);
      if (isCurrent()) setStatus(`Cloud backup failed. ${friendlyError(error)}`, 'error');
    } finally {
      if (dom.downloadCloudBackupBtn) dom.downloadCloudBackupBtn.disabled = false;
    }
  }

  async function deleteRefsInChunks(refs) {
    const chunkSize = 30;
    for (let i = 0; i < refs.length; i += chunkSize) {
      await Promise.all(refs.slice(i, i + chunkSize).map((ref) => modules.deleteDoc(ref)));
    }
  }

  async function detachAccountFromGroups(uid) {
    const revision = authRevision;
    for (const groupId of [...new Set(profile?.groupIds || [])]) {
      await Groups.leaveMembership({sdk: modules, firestore, groupId, uid,
        isCurrent: () => currentUser?.uid === uid && authRevision === revision});
    }
  }

  async function deleteCloudAccountAndData() {
    if (!currentUser || !firestore || !auth) {
      setStatus('Sign in before deleting a cloud account.', 'error');
      return;
    }
    if (!navigator.onLine) {
      setStatus('Account deletion requires an internet connection.', 'error');
      return;
    }

    const password = dom.deleteAccountPassword?.value || '';
    if (!password) {
      setStatus('Enter your current password to confirm account deletion.', 'error');
      dom.deleteAccountPassword?.focus();
      return;
    }

    const confirmed = window.confirm(
      'Permanently delete your account and cloud bowling data? Your local games on this device will remain. This cannot be undone unless you downloaded a backup.'
    );
    if (!confirmed) return;

    const user = currentUser;
    const uid = user.uid;

    try {
      dom.deleteCloudAccountBtn.disabled = true;
      if (dom.downloadCloudBackupBtn) dom.downloadCloudBackupBtn.disabled = true;
      setStatus('Verifying your password…');

      const credential = modules.EmailAuthProvider.credential(user.email || '', password);
      await modules.reauthenticateWithCredential(user, credential);

      setStatus('Deleting private cloud bowling history…');
      const gameSnap = await modules.getDocs(modules.collection(firestore, 'users', uid, 'games'));
      const gameRefs = [];
      gameSnap.forEach((item) => gameRefs.push(item.ref));
      await deleteRefsInChunks(gameRefs);

      setStatus('Removing your leaderboard entries…');
      await detachAccountFromGroups(uid);

      setStatus('Deleting your cloud profile…');
      await modules.deleteDoc(modules.doc(firestore, 'users', uid));

      // Keep the promised offline escape hatch even with account-isolated local
      // databases: copy this account's device history into the signed-out store
      // before the Firebase login itself disappears.
      const app = await waitForBowlingApp();
      await app.copyAccountDataToGuest?.(uid);

      setStatus('Deleting account…');
      await modules.deleteUser(user);

      if (dom.deleteAccountPassword) dom.deleteAccountPassword.value = '';
      hideSyncReview();
      setStatus('Cloud account and cloud data deleted. Your local bowling history is still on this device.', 'success');
    } catch (error) {
      console.error(error);
      setStatus(`Account deletion stopped. ${friendlyError(error)} Your local bowling history was not deleted.`, 'error');
    } finally {
      if (dom.deleteCloudAccountBtn) dom.deleteCloudAccountBtn.disabled = false;
      if (dom.downloadCloudBackupBtn) dom.downloadCloudBackupBtn.disabled = false;
    }
  }

  async function signOutCloud() {
    if (!auth) return;
    try {
      await modules.signOut(auth);
      const app = await waitForBowlingApp();
      await app.activateGuest?.();
      setStatus("Signed out. Your account’s saved games stay separate from guest games.", 'success');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    }
  }

  // Serialize sync requests; game edits and their retry bases commit in storage.
  let localChangeQueue = Promise.resolve();
  let localChangeRevision = 0;
  function handleLocalDataChanged(event) {
    const detail = event.detail || {};
    const uid = currentUser?.uid;
    if (!uid || (detail.scope !== undefined && detail.scope !== uid)) return;
    pendingLocalChanges += 1;
    localChangeRevision += 1;
    setSyncBadge(navigator.onLine ? 'Syncing…' : 'Saved on this device · waiting for connection', navigator.onLine ? 'working' : 'pending');
    localChangeQueue = localChangeQueue.then(() => syncLocalChange(detail, uid)).catch((error) => {
      console.error(error);
      if (currentUser?.uid === uid) setSyncBadge('Saved on this device · needs sync', 'error');
    });
  }

  async function syncLocalChange(detail, uid) {
    if (currentUser?.uid !== uid) return;
    await performSyncAll('Local changes');
  }

  function wireEvents() {
    dom.openCloudBtn?.addEventListener('click', async () => {
      openDialog(dom.cloudDialog);
      renderConnectionState();
      if (configReady() && navigator.onLine) await initFirebase();
    });
    dom.closeCloudBtn?.addEventListener('click', () => closeDialog(dom.cloudDialog));
    dom.cloudDialog?.addEventListener('click', (event) => {
      if (event.target === dom.cloudDialog) closeDialog(dom.cloudDialog);
    });
    dom.leaderboardConnectBtn?.addEventListener('click', async () => {
      openDialog(dom.cloudDialog);
      if (configReady() && navigator.onLine) await initFirebase();
    });
    dom.leaderboardManageGroupsBtn?.addEventListener('click', () => openDialog(dom.cloudDialog));
    dom.signInBtn?.addEventListener('click', signIn);
    dom.createAccountBtn?.addEventListener('click', createAccount);
    dom.resetPasswordBtn?.addEventListener('click', resetPassword);
    dom.downloadCloudBackupBtn?.addEventListener('click', downloadCloudBackup);
    dom.deleteCloudAccountBtn?.addEventListener('click', deleteCloudAccountAndData);
    dom.signOutBtn?.addEventListener('click', signOutCloud);
    dom.saveProfileBtn?.addEventListener('click', saveProfile);
    dom.syncNowBtn?.addEventListener('click', () => syncAll('Manual sync'));
    dom.applySyncReviewBtn?.addEventListener('click', () => {
      const choices = collectSyncReviewChoices();
      if (!choices) {
        setStatus('Choose a resolution for every sync item before applying.', 'error');
        return;
      }
      syncAll('Reviewed sync', choices);
    });
    dom.cancelSyncReviewBtn?.addEventListener('click', () => {
      hideSyncReview();
      setSyncBadge('Review needed', 'pending');
      setStatus('Sync review postponed. No conflicting games were changed.');
    });
    dom.createGroupBtn?.addEventListener('click', createGroup);
    dom.joinGroupBtn?.addEventListener('click', joinGroup);
    dom.groupSelect?.addEventListener('change', () => selectGroup(dom.groupSelect.value));
    dom.metricSelect?.addEventListener('change', loadLeaderboard);
    dom.refreshLeaderboardBtn?.addEventListener('click', loadLeaderboard);

    [dom.email, dom.password].forEach((input) => {
      input?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') signIn();
      });
    });
    dom.joinGroupCode?.addEventListener('input', () => {
      dom.joinGroupCode.value = dom.joinGroupCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    });

    window.addEventListener('bowling:data-changed', handleLocalDataChanged);
    window.addEventListener('bowling:external-history-changed', () => {
      localChangeRevision++;
      if (currentUser && navigator.onLine) syncAll('Updated in another window');
    });
    window.addEventListener('bowling:profile-options-changed', updateProfileBowlerOptions);
    window.addEventListener('bowling:rendered', updateProfileBowlerOptions);
    window.addEventListener('online', async () => {
      renderConnectionState();
      if (configReady()) {
        const ok = await initFirebase();
        if (ok && currentUser) await syncAll('Back online');
      }
    });
    window.addEventListener('offline', () => {
      renderConnectionState();
      if (currentUser) setSyncBadge(pendingLocalChanges ? `${pendingLocalChanges} change${pendingLocalChanges === 1 ? '' : 's'} waiting` : 'Offline — saved on device', 'pending');
    });
    window.addEventListener('focus', async () => {
      if (!navigator.onLine || !configReady()) return;
      if (!await initFirebase() || !currentUser) return;
      if (Date.now() - lastSyncAt > 15000) syncAll('App resumed');
      else if (selectedGroupId) loadLeaderboard();
    });
  }

  async function init() {
    wireEvents();
    renderConnectionState();
    try {
      await waitForBowlingApp();
      updateProfileBowlerOptions();
      if (configReady() && navigator.onLine) await initFirebase();
    } catch (error) { setSyncBadge('Startup failed','error'); setStatus(friendlyError(error),'error'); }
  }

  const api = {
    isBusy: () => syncing,
    isSignedIn: () => Boolean(currentUser),
    getAccount: () => currentUser ? { uid: currentUser.uid, email: currentUser.email || '' } : null,
    syncNow: () => syncAll('Manual sync')
  };

  return Object.assign(api, {init});
})();
