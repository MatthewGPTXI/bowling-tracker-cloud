(() => {
  'use strict';

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
    window.BowlingApp?.setSyncStatus?.(text, state === 'success' ? 'on' : state === 'working' || state === 'pending' ? 'working' : state === 'error' ? 'error' : 'off');
  }

  function setCloudButton(state, label) {
    if (dom.cloudButtonLabel) dom.cloudButtonLabel.textContent = label;
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
      'permission-denied': 'Firebase blocked this request. Check that the provided Firestore rules are published.'
    };
    return map[code] || error?.message || 'Something went wrong with cloud sync.';
  }

  function waitForBowlingApp() {
    const app = window.BowlingApp;
    if (app?.ready) return Promise.resolve(app);
    if (app?.startupError) return Promise.reject(new Error(`App startup failed: ${app.startupError}`));
    return new Promise((resolve, reject) => {
      window.addEventListener('bowling:ready', (event) => {
        if (event.detail?.ok && window.BowlingApp?.ready) resolve(window.BowlingApp);
        else reject(new Error(window.BowlingApp?.startupError || 'Local storage is unavailable. Reopen the app to retry.'));
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
    if (firebaseApp) return true;
    if (!navigator.onLine) {
      renderConnectionState();
      return false;
    }
    if (initializing) return initializing;

    initializing = (async () => {
      try {
        setCloudButton('working', 'Cloud…');
        const fb = await loadFirebaseModules();
        firebaseApp = fb.initializeApp(config);
        auth = fb.getAuth(firebaseApp);
        firestore = fb.getFirestore(firebaseApp);
        await fb.setPersistence(auth, fb.browserLocalPersistence);
        fb.onAuthStateChanged(auth, handleAuthStateChanged);
        return true;
      } catch (error) {
        console.error(error);
        setCloudButton('error', 'Cloud error');
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
      window.BowlingApp?.setSyncStatus?.('Local only', 'off');
      dom.signedOut?.classList.add('hidden');
      dom.signedIn?.classList.add('hidden');
      dom.leaderboardSignedOut?.classList.remove('hidden');
      dom.leaderboardNoGroup?.classList.add('hidden');
      dom.leaderboardContent?.classList.add('hidden');
      return;
    }

    if (!navigator.onLine && !currentUser) {
      setCloudButton('off', 'Cloud offline');
      window.BowlingApp?.setSyncStatus?.('Offline — saved on device', 'working');
    } else if (currentUser) {
      setCloudButton('on', 'Cloud ✓');
    } else {
      setCloudButton('off', 'Cloud');
      window.BowlingApp?.setSyncStatus?.('Local only', 'off');
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
    const app = await waitForBowlingApp();
    const ref = await userProfileRef();
    const snap = await modules.getDoc(ref);
    if (snap.exists()) {
      profile = snap.data();
    } else {
      const defaultBowler = (await app.getDefaultBowler()) || app.getBowlerNames()[0] || currentUser.displayName || '';
      profile = {
        email: currentUser.email || '',
        displayName: currentUser.displayName || defaultBowler || 'Bowler',
        statsBowler: defaultBowler || currentUser.displayName || 'Bowler',
        groupIds: [],
        activeGroupId: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await modules.setDoc(ref, profile, { merge: true });
    }
    profile.groupIds = Array.isArray(profile.groupIds) ? profile.groupIds : [];
    return profile;
  }

  function updateProfileBowlerOptions() {
    if (!window.BowlingApp || !profile) return;
    profile.statsBowler = profile.displayName || currentUser?.displayName || window.BowlingApp.getProfileName?.() || 'Bowler';
  }

  async function renderAccount() {
    renderConnectionState();
    if (!currentUser || !profile) return;
    dom.accountEmail.textContent = currentUser.email || 'Signed in';
    dom.profileDisplayName.value = profile.displayName || currentUser.displayName || '';
    await window.BowlingApp?.setProfileName?.(profile.displayName || currentUser.displayName || 'Bowler');
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
      setCloudButton('on', 'Cloud');
    } catch (error) {
      console.error(error);
      setStatus(friendlyError(error), 'error');
      setCloudButton('error', 'Cloud error');
    }
  }

  function cloudGameRef(id) {
    return modules.doc(firestore, 'users', currentUser.uid, 'games', String(id));
  }

  function cloudGamePayload(game) {
    return {
      id: Number(game.id),
      bowler: String(game.bowler),
      date: String(game.date),
      sessionName: String(game.sessionName || ''),
      ball: String(game.ball || '').trim().replace(/\s+/g,' '),
      sessionType: ['League','Practice','Tournament'].includes(game.sessionType) ? game.sessionType : 'League',
      ...(game.gameOrder !== undefined ? {gameOrder:Number(game.gameOrder)} : {}),
      score: Number(game.score),
      openFrames: Number(game.openFrames),
      strikes: Number(game.strikes),
      strikeOpportunities: Number(game.strikeOpportunities || 10),
      notes: String(game.notes || ''),
      createdAt: Number(game.createdAt || Date.now()),
      updatedAt: Number(game.updatedAt || Date.now()),
      deleted: false,
      schemaVersion: 2
    };
  }

  function cloudDeletePayload(tombstone) {
    return {
      id: Number(tombstone.id),
      updatedAt: Number(tombstone.updatedAt || Date.now()),
      deleted: true,
      schemaVersion: 2
    };
  }

  function normalizedSessionName(game) {
    return String(game?.sessionName || '').trim().toLowerCase();
  }

  function comparableGame(game) {
    return {
      date: String(game?.date || ''),
      sessionName: normalizedSessionName(game),
      ball: String(game?.ball || '').trim().replace(/\s+/g,' ').toLowerCase(),
      sessionType: game?.sessionType || 'League',
      gameOrder: Number(game?.gameOrder ?? game?.createdAt ?? game?.id ?? 0),
      score: Number(game?.score || 0),
      openFrames: Number(game?.openFrames || 0),
      strikes: Number(game?.strikes || 0),
      strikeOpportunities: Number(game?.strikeOpportunities || 10),
      notes: String(game?.notes || '').trim()
    };
  }

  function sameGameContent(a, b) {
    return JSON.stringify(comparableGame(a)) === JSON.stringify(comparableGame(b));
  }

  function duplicateSignature(game) {
    const value = comparableGame(game);
    // Notes are intentionally excluded. Two independently entered copies of the
    // same game often have different notes, while the bowling result is identical.
    return [
      value.date,
      value.sessionName,
      value.score,
      value.openFrames,
      value.strikes,
      value.strikeOpportunities
    ].join('|');
  }

  function gameReviewHtml(label, game) {
    if (!game) return `<div class="sync-review-game"><strong>${escapeHtml(label)}</strong>Deleted</div>`;
    return `<div class="sync-review-game">
      <strong>${escapeHtml(label)}</strong>
      ${game.gameOrder !== undefined ? `Game order: ${escapeHtml(game.gameOrder)}<br>` : ''}${game.ball ? `Ball: ${escapeHtml(game.ball)}<br>` : ''}${escapeHtml(game.date)} · ${escapeHtml(game.sessionType || 'League')}<br>
      Score ${Number(game.score)} · ${Number(game.openFrames)} open · ${Number(game.strikes)}/${Number(game.strikeOpportunities || 10)} strikes
      ${game.notes ? `<br>${escapeHtml(game.notes)}` : ''}
    </div>`;
  }

  function detectSyncIssues(localGameMap, tombstoneMap, remoteMap) {
    const issues = [];

    for (const [id, remote] of remoteMap.entries()) {
      const local = localGameMap.get(id);
      const tombstone = tombstoneMap.get(id);

      if (remote.deleted && local) {
        issues.push({
          key: `delete:${id}:cloud`,
          type: 'delete-conflict',
          id,
          liveSide: 'local',
          local,
          remote
        });
        continue;
      }

      if (!remote.deleted && tombstone) {
        issues.push({
          key: `delete:${id}:local`,
          type: 'delete-conflict',
          id,
          liveSide: 'cloud',
          tombstone,
          remote
        });
        continue;
      }

      if (!remote.deleted && local && !sameGameContent(local, remote)) {
        issues.push({
          key: `version:${id}`,
          type: 'version-conflict',
          id,
          local,
          remote
        });
      }
    }

    // Duplicate protection only compares records that exist exclusively on one
    // side. After a user chooses "keep both" and the records sync, they will no
    // longer be flagged every time.
    const localOnly = [...localGameMap.entries()]
      .filter(([id]) => !remoteMap.has(id) && !tombstoneMap.has(id))
      .map(([, game]) => game);
    const remoteOnly = [...remoteMap.entries()]
      .filter(([id, game]) => !game.deleted && !localGameMap.has(id) && !tombstoneMap.has(id))
      .map(([, game]) => game);

    const remoteBySignature = new Map();
    for (const game of remoteOnly) {
      const sig = duplicateSignature(game);
      if (!remoteBySignature.has(sig)) remoteBySignature.set(sig, []);
      remoteBySignature.get(sig).push(game);
    }

    const usedRemoteIds = new Set();
    for (const local of localOnly) {
      const matches = remoteBySignature.get(duplicateSignature(local)) || [];
      const remote = matches.find((candidate) => !usedRemoteIds.has(Number(candidate.id)));
      if (!remote) continue;
      usedRemoteIds.add(Number(remote.id));
      const localId = Number(local.id);
      const remoteId = Number(remote.id);
      issues.push({
        key: `duplicate:${Math.min(localId, remoteId)}:${Math.max(localId, remoteId)}`,
        type: 'duplicate',
        localId,
        remoteId,
        local,
        remote
      });
    }

    return issues;
  }

  function renderSyncReview(issues, localCount, cloudCount) {
    pendingSyncReview = { issues };
    if (!dom.syncReviewSection || !dom.syncReviewList) return;

    dom.syncReviewSection.classList.remove('hidden');
    dom.syncReviewSummary.textContent = `${localCount} game${localCount === 1 ? '' : 's'} on this device · ${cloudCount} live game${cloudCount === 1 ? '' : 's'} in the cloud · ${issues.length} item${issues.length === 1 ? '' : 's'} need review.`;

    dom.syncReviewList.innerHTML = issues.map((issue) => {
      if (issue.type === 'version-conflict') {
        return `<div class="sync-review-item" data-sync-issue="${escapeHtml(issue.key)}">
          <div class="sync-review-title">Same saved game has different details</div>
          <div class="sync-review-copy">This game has the same internal ID on both sides, but at least one bowling value or note differs. Choose which copy is correct.</div>
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
          <div class="sync-review-copy">A copy of this game exists, but it was deleted on ${escapeHtml(deletedWhere)}. Nothing will be erased until you choose.</div>
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

      return `<div class="sync-review-item" data-sync-issue="${escapeHtml(issue.key)}">
        <div class="sync-review-title">Possible duplicate game</div>
        <div class="sync-review-copy">These have different internal IDs but the same date, session, score, open frames and strike totals. They may be two copies of the same real game.</div>
        <div class="sync-review-compare">
          ${gameReviewHtml('This device', issue.local)}
          ${gameReviewHtml('Cloud', issue.remote)}
        </div>
        <label>Keep
          <select data-sync-choice>
            <option value="">Choose…</option>
            <option value="local">This device copy only</option>
            <option value="cloud">Cloud copy only</option>
            <option value="both">Both games are real — keep both</option>
          </select>
        </label>
      </div>`;
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

  function outboxKey(uid) { return `bowling-sync-outbox:${uid}`; }
  function readOutbox(uid) {
    try { const value = JSON.parse(localStorage.getItem(outboxKey(uid)) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch (_) { return {}; }
  }
  function saveOutbox(uid, items) {
    try { localStorage.setItem(outboxKey(uid), JSON.stringify(items)); }
    catch (_) { setStatus('Could not save sync retry information. Games remain saved locally; use Sync Now when connected.', 'error'); }
  }
  function queueLocalChange(detail, uid) {
    let values;
    if (detail.type === 'batch-upsert') values = (detail.games || []).map(cloudGamePayload);
    else if (detail.type === 'upsert' && detail.game) values = [cloudGamePayload(detail.game)];
    else if (detail.type === 'delete' && detail.tombstone) values = [cloudDeletePayload(detail.tombstone)];
    else return;
    if (!Array.isArray(detail.bases)) return;
    const items = readOutbox(uid);
    values.forEach((data,i) => {
      const previous = items[data.id];
      items[data.id] = {data,base:previous ? previous.base : (detail.bases[i] || null)};
    });
    saveOutbox(uid,items);
  }
  async function flushOutbox(uid, isCurrent, localGameMap, tombstoneMap) {
    const items = readOutbox(uid), entries = Object.entries(items);
    for (let i=0;i<entries.length;i+=100) {
      const chunk = entries.slice(i,i+100);
      const acknowledged = await modules.runTransaction(firestore, async tx => {
        if (!isCurrent()) throw new Error('Account or local history changed. Sync again.');
        const refs = chunk.map(([id])=>modules.doc(firestore,'users',uid,'games',id));
        const snapshots = await Promise.all(refs.map(ref=>tx.get(ref)));
        if (!isCurrent()) throw new Error('Account or local history changed. Sync again.');
        const done = [];
        chunk.forEach(([id,item],j) => {
          const local = localGameMap.get(Number(id)) || (tombstoneMap.has(Number(id)) ? {...tombstoneMap.get(Number(id)),deleted:true} : null);
          // A later import or another tab may have changed the local record.
          if (!sameCloudVersion(local,item.data)) { done.push(id); return; }
          const remote = snapshots[j].exists() ? snapshots[j].data() : null;
          if (sameCloudVersion(remote,item.data)) {done.push(id);return;}
          if (sameCloudVersion(remote,item.base)) {tx.set(refs[j],item.data);done.push(id);}
        });
        return done;
      });
      if (!isCurrent()) return;
      const latest = readOutbox(uid);
      acknowledged.forEach(id => {if (JSON.stringify(latest[id]) === JSON.stringify(items[id])) delete latest[id];});
      saveOutbox(uid,latest);
    }
  }

  function sameCloudVersion(a, b) {
    if (!a || !b) return !a && !b;
    return !!a.deleted === !!b.deleted && Number(a.updatedAt || 0) === Number(b.updatedAt || 0)
      && (a.deleted || sameGameContent(a,b));
  }
  async function guardedWrites(operations, expected, isCurrent) {
    if (!operations.length) return;
    // Bound each transaction to stay below Firestore's request limits.
    for (let i=0; i<operations.length; i+=100) {
      const chunk = operations.slice(i,i+100);
      await modules.runTransaction(firestore, async transaction => {
        if (!isCurrent()) throw new Error('Account or local history changed. Sync again.');
        const snapshots = await Promise.all(chunk.map(op => transaction.get(op.ref)));
        if (!isCurrent()) throw new Error('Account or local history changed. Sync again.');
        snapshots.forEach((snap,j) => {
          const id = Number(chunk[j].data.id), remote = snap.exists() ? snap.data() : null;
          if (!sameCloudVersion(remote,expected.get(id) || null)) {
            const error = new Error('Cloud history changed during sync. Sync again to review the latest versions.'); error.code='bowling/conflict'; throw error;
          }
        });
        chunk.forEach(op => transaction.set(op.ref,op.data));
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
    setStatus(`${reason}: comparing local and cloud bowling history…`);

    try {
      const app = await waitForBowlingApp();
      if (!isCurrentAccount()) return;
      if (app.getLocalScopeInfo && app.getLocalScopeInfo().uid !== uid) return;
      const localGames = app.getGames();
      const localTombstones = await app.getTombstones();
      if (!isCurrentAccount()) return;
      const localGameMap = new Map(localGames.map((game) => [Number(game.id), game]));
      const tombstoneMap = new Map(localTombstones.map((t) => [Number(t.id), t]));
      await flushOutbox(uid, () => isCurrentAccount() && revision === localChangeRevision,localGameMap,tombstoneMap);
      if (!isCurrentAccount() || revision !== localChangeRevision) return;
      const remoteSnap = await modules.getDocs(modules.collection(firestore, 'users', uid, 'games'));
      if (!isCurrentAccount() || revision !== localChangeRevision) return;
      const remoteMap = new Map();
      remoteSnap.forEach((item) => remoteMap.set(Number(item.id), item.data()));

      const issues = detectSyncIssues(localGameMap, tombstoneMap, remoteMap);
      if (reviewChoices && pendingSyncReview?.issues && JSON.stringify(issues) !== JSON.stringify(pendingSyncReview.issues)) reviewChoices = null;
      const unresolved = issues.filter((issue) => !reviewChoices?.[issue.key]);
      const cloudWrites = [];
      const localUpserts = [];
      const localDeletes = [];
      const handledIds = new Set(unresolved.flatMap(issue => issue.type === 'duplicate' ? [issue.localId,issue.remoteId] : [issue.id]));
      const resolutionTime = Date.now();

      // Apply explicit user choices first. Standard reconciliation below skips
      // these IDs so the choices cannot be overwritten by timestamp rules.
      for (const issue of issues) {
        const choice = reviewChoices?.[issue.key];
        if (!choice) continue;

        if (issue.type === 'version-conflict') {
          handledIds.add(issue.id);
          if (choice === 'local') {
            localUpserts.push({...issue.local,updatedAt:resolutionTime});
            cloudWrites.push({ ref: cloudGameRef(issue.id), data: cloudGamePayload({ ...issue.local, updatedAt: resolutionTime }) });
          } else {
            localUpserts.push({ ...issue.remote, updatedAt: resolutionTime });
            cloudWrites.push({ ref: cloudGameRef(issue.id), data: cloudGamePayload({ ...issue.remote, updatedAt: resolutionTime }) });
          }
          continue;
        }

        if (issue.type === 'delete-conflict') {
          handledIds.add(issue.id);
          if (choice === 'keep-game') {
            const live = issue.liveSide === 'local' ? issue.local : issue.remote;
            const resolved = { ...live, updatedAt: resolutionTime };
            localUpserts.push(resolved);
            cloudWrites.push({ ref: cloudGameRef(issue.id), data: cloudGamePayload(resolved) });
          } else {
            const deletion = { id: issue.id, updatedAt: resolutionTime };
            localDeletes.push(deletion);
            cloudWrites.push({ ref: cloudGameRef(issue.id), data: cloudDeletePayload(deletion) });
          }
          continue;
        }

        if (issue.type === 'duplicate') {
          handledIds.add(issue.localId);
          handledIds.add(issue.remoteId);
          if (choice === 'local') {
            const resolvedLocal = { ...issue.local, updatedAt: resolutionTime };
            const deleteRemote = { id: issue.remoteId, updatedAt: resolutionTime };
            cloudWrites.push({ ref: cloudGameRef(issue.localId), data: cloudGamePayload(resolvedLocal) });
            cloudWrites.push({ ref: cloudGameRef(issue.remoteId), data: cloudDeletePayload(deleteRemote) });
            localDeletes.push(deleteRemote);
          } else if (choice === 'cloud') {
            const deleteLocal = { id: issue.localId, updatedAt: resolutionTime };
            const resolvedRemote = { ...issue.remote, updatedAt: resolutionTime };
            localDeletes.push(deleteLocal);
            localUpserts.push(resolvedRemote);
            cloudWrites.push({ ref: cloudGameRef(issue.localId), data: cloudDeletePayload(deleteLocal) });
            cloudWrites.push({ ref: cloudGameRef(issue.remoteId), data: cloudGamePayload(resolvedRemote) });
          } else {
            const resolvedLocal = { ...issue.local, updatedAt: resolutionTime };
            const resolvedRemote = { ...issue.remote, updatedAt: resolutionTime };
            localUpserts.push(resolvedRemote);
            cloudWrites.push({ ref: cloudGameRef(issue.localId), data: cloudGamePayload(resolvedLocal) });
            cloudWrites.push({ ref: cloudGameRef(issue.remoteId), data: cloudGamePayload(resolvedRemote) });
          }
        }
      }

      for (const [id, remote] of remoteMap.entries()) {
        if (handledIds.has(id)) continue;
        const local = localGameMap.get(id);
        const tombstone = tombstoneMap.get(id);
        const remoteAt = Number(remote.updatedAt || 0);
        const localAt = Number(local?.updatedAt || 0);
        const deleteAt = Number(tombstone?.updatedAt || 0);

        if (remote.deleted) {
          if (local && localAt > remoteAt && localAt > deleteAt) {
            cloudWrites.push({ ref: cloudGameRef(id), data: cloudGamePayload(local) });
          } else if (tombstone && deleteAt > remoteAt) {
            cloudWrites.push({ ref: cloudGameRef(id), data: cloudDeletePayload(tombstone) });
          } else if (local || !tombstone || remoteAt > deleteAt) {
            localDeletes.push({ id, updatedAt: remoteAt });
          }
          continue;
        }

        if (tombstone && deleteAt >= remoteAt && deleteAt >= localAt) {
          cloudWrites.push({ ref: cloudGameRef(id), data: cloudDeletePayload(tombstone) });
        } else if (local && localAt >= remoteAt) {
          if (localAt > remoteAt) cloudWrites.push({ ref: cloudGameRef(id), data: cloudGamePayload(local) });
        } else {
          localUpserts.push(remote);
        }
      }

      for (const [id, local] of localGameMap.entries()) {
        if (handledIds.has(id)) continue;
        if (!remoteMap.has(id)) cloudWrites.push({ ref: cloudGameRef(id), data: cloudGamePayload(local) });
      }
      for (const [id, tombstone] of tombstoneMap.entries()) {
        if (handledIds.has(id)) continue;
        if (!remoteMap.has(id)) cloudWrites.push({ ref: cloudGameRef(id), data: cloudDeletePayload(tombstone) });
      }

      if (!isCurrentAccount() || revision !== localChangeRevision) return;
      if (cloudWrites.length) await guardedWrites(cloudWrites,remoteMap,() => isCurrentAccount() && revision === localChangeRevision);
      if (!isCurrentAccount() || revision !== localChangeRevision) return;
      if (localUpserts.length || localDeletes.length) {
        await app.applyRemoteChanges({ upserts: localUpserts, deletes: localDeletes, expectedUid: uid });
      }
      if (!isCurrentAccount()) return;

      if (!isCurrentAccount()) return;
      await publishAllSummaries();
      if (!isCurrentAccount() || revision !== localChangeRevision) return;
      if (unresolved.length) {
        renderSyncReview(issues,app.getGames().length,[...remoteMap.values()].filter(g=>!g.deleted).length);
        setSyncBadge('Review needed','pending');
        setStatus(`Other games synced. ${unresolved.length} conflicting item${unresolved.length===1?'':'s'} still need review in Account & settings.`);
        return;
      }
      hideSyncReview();
      // Explicit review choices supersede the saved retry versions.
      const remaining = readOutbox(uid);
      handledIds.forEach(id => delete remaining[id]); saveOutbox(uid,remaining);
      pendingLocalChanges = 0;
      lastSyncAt = Date.now();
      setSyncBadge('Synced just now', 'success');
      setStatus(`Synced ${app.getGames().length} local game${app.getGames().length === 1 ? '' : 's'} with Firebase.`, 'success');
      await loadLeaderboard();
    } catch (error) {
      console.error(error);
      if (!isCurrentAccount()) return;
      setSyncBadge('Needs sync', 'error');
      setStatus(`Sync paused: ${friendlyError(error)}`, 'error');
    } finally {
      syncing = false;
    }
  }

  function randomGroupCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint32Array(8);
    crypto.getRandomValues(bytes);
    return [...bytes].map((n) => alphabet[n % alphabet.length]).join('');
  }

  async function setProfileGroupIds(groupIds, activeGroupId = selectedGroupId) {
    const unique = [...new Set(groupIds)];
    profile.groupIds = unique;
    profile.activeGroupId = activeGroupId && unique.includes(activeGroupId) ? activeGroupId : (unique[0] || '');
    profile.updatedAt = Date.now();
    await modules.setDoc(await userProfileRef(), {
      groupIds: unique,
      activeGroupId: profile.activeGroupId,
      updatedAt: profile.updatedAt
    }, { merge: true });
  }

  async function memberPayload() {
    const app = await waitForBowlingApp();
    const displayName = profile.displayName || currentUser.displayName || app.getProfileName?.() || 'Bowler';
    const summary = app.getLeaderboardSummary(displayName);
    return {
      uid: currentUser.uid,
      displayName,
      statsBowler: displayName,
      ...summary,
      updatedAt: Date.now()
    };
  }

  async function publishSummaryToGroup(groupId) {
    if (!currentUser || !groupId) return;
    const payload = await memberPayload();
    const ref = modules.doc(firestore, 'groups', groupId, 'members', currentUser.uid);
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
            ownerUid: currentUser.uid,
            createdAt: Date.now(),
            updatedAt: Date.now()
          });
          createdCode = code;
        } catch (error) {
          if (error.code !== 'permission-denied') throw error;
        }
      }
      if (!createdCode) throw new Error('Could not create a unique group code. Try again.');

      await setProfileGroupIds([...profile.groupIds, createdCode], createdCode);
      selectedGroupId = createdCode;
      await publishSummaryToGroup(createdCode);
      dom.newGroupName.value = '';
      await loadGroups();
      setStatus(`Group created. Share invite code ${createdCode}.`, 'success');
    } catch (error) {
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

    try {
      setStatus('Checking invite code…');
      const ref = modules.doc(firestore, 'groups', code);
      const snap = await modules.getDoc(ref);
      if (!snap.exists()) throw new Error('No group was found with that invite code.');
      await publishSummaryToGroup(code);
      await setProfileGroupIds([...profile.groupIds, code], code);
      selectedGroupId = code;
      dom.joinGroupCode.value = '';
      await loadGroups();
      setStatus(`Joined ${snap.data().name || code}.`, 'success');
    } catch (error) {
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
      const groupRef = modules.doc(firestore, 'groups', groupId);
      const memberRef = modules.doc(firestore, 'groups', groupId, 'members', currentUser.uid);
      const snap = await modules.getDoc(groupRef);
      if (snap.exists() && snap.data().ownerUid === currentUser.uid) {
        await modules.updateDoc(groupRef, {
          ownerUid: '',
          ownerLeftAt: Date.now(),
          updatedAt: Date.now()
        });
      }
      await modules.deleteDoc(memberRef);
      const remaining = (profile.groupIds || []).filter((id) => id !== groupId);
      await setProfileGroupIds(remaining, remaining.includes(selectedGroupId) ? selectedGroupId : (remaining[0] || ''));
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

    const loaded = [];
    const validIds = [];
    for (const groupId of profile.groupIds || []) {
      try {
        const snap = await modules.getDoc(modules.doc(firestore, 'groups', groupId));
        if (snap.exists()) {
          loaded.push({ id: groupId, ...snap.data() });
          validIds.push(groupId);
        }
      } catch (error) {
        console.warn('Could not load group', groupId, error);
      }
    }
    groups = loaded;
    if (validIds.length !== (profile.groupIds || []).length) {
      await setProfileGroupIds(validIds, profile.activeGroupId);
    }
    selectedGroupId = validIds.includes(profile.activeGroupId) ? profile.activeGroupId : (validIds[0] || '');
    profile.activeGroupId = selectedGroupId;
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
    if (!groupId || !groups.some((g) => g.id === groupId)) return;
    selectedGroupId = groupId;
    profile.activeGroupId = groupId;
    await modules.setDoc(await userProfileRef(), { activeGroupId: groupId, updatedAt: Date.now() }, { merge: true });
    renderGroups();
    renderLeaderboardShell();
    await loadLeaderboard();
  }

  function renderLeaderboardShell() {
    if (!currentUser) {
      dom.leaderboardSignedOut.classList.remove('hidden');
      dom.leaderboardNoGroup.classList.add('hidden');
      dom.leaderboardContent.classList.add('hidden');
      return;
    }
    if (!groups.length || !selectedGroupId) {
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
      snap.forEach((item) => members.push(item.data()));
      renderLeaderboardRows(members);
      setLeaderboardStatus(`Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`, 'success');
    } catch (error) {
      console.error(error);
      if (current()) setLeaderboardStatus(friendlyError(error), 'error');
    }
  }

  function renderLeaderboardRows(members) {
    const metric = dom.metricSelect.value || 'average';
    const info = metricInfo[metric] || metricInfo.average;
    dom.leaderboardMetricHeading.textContent = info.label;
    const sorted = [...members].sort((a, b) => Number(b[metric] || 0) - Number(a[metric] || 0)
      || String(a.displayName || '').localeCompare(String(b.displayName || '')));

    if (!sorted.length) {
      dom.leaderboardBody.innerHTML = '<tr><td colspan="4" class="empty-table-cell">No leaderboard entries yet.</td></tr>';
      return;
    }

    dom.leaderboardBody.innerHTML = sorted.map((member, index) => {
      const provisional = info.provisional && Number(member.games || 0) < 10;
      const you = member.uid === currentUser?.uid;
      return `
        <tr class="${you ? 'you-row' : ''}">
          <td><span class="rank-badge">${index + 1}</span></td>
          <td><strong>${escapeHtml(member.displayName || 'Bowler')}${you ? ' · You' : ''}</strong>${provisional ? '<span class="provisional">Provisional</span>' : ''}</td>
          <td class="leader-value">${escapeHtml(info.format(member[metric]))}</td>
          <td>${Number(member.games || 0)}</td>
        </tr>`;
    }).join('');
  }

  async function saveProfile() {
    if (!currentUser || !profile) return;
    const displayName = dom.profileDisplayName.value.trim();
    if (!displayName) {
      setStatus('Enter a leaderboard display name.', 'error');
      return;
    }
    try {
      profile.displayName = displayName;
      profile.statsBowler = displayName;
      profile.updatedAt = Date.now();
      await modules.updateProfile(currentUser, { displayName });
      await modules.setDoc(await userProfileRef(), {
        displayName,
        statsBowler: displayName,
        email: currentUser.email || '',
        updatedAt: profile.updatedAt
      }, { merge: true });
      const app = await waitForBowlingApp();
      await app.setProfileName?.(displayName);
      await publishAllSummaries();
      await loadLeaderboard();
      setStatus('Cloud profile saved.', 'success');
    } catch (error) {
      console.error(error);
      setStatus(friendlyError(error), 'error');
    }
  }

  async function createAccount() {
    const displayName = dom.displayName.value.trim();
    const email = dom.email.value.trim();
    const password = dom.password.value;
    if (!displayName || !email || !password) {
      setStatus('Enter a leaderboard name, email, and password.', 'error');
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

    try {
      dom.downloadCloudBackupBtn.disabled = true;
      setStatus('Reading your Firebase bowling history…');

      const gameSnap = await modules.getDocs(modules.collection(firestore, 'users', currentUser.uid, 'games'));
      const games = [];
      const tombstones = [];
      gameSnap.forEach((item) => {
        const value = item.data();
        if (value.deleted) {
          tombstones.push({
            id: Number(value.id ?? item.id),
            updatedAt: Number(value.updatedAt || 0)
          });
        } else {
          games.push(value);
        }
      });

      const memberships = [];
      for (const groupId of [...new Set(profile?.groupIds || [])]) {
        try {
          const groupRef = modules.doc(firestore, 'groups', groupId);
          const memberRef = modules.doc(firestore, 'groups', groupId, 'members', currentUser.uid);
          const [groupSnap, memberSnap] = await Promise.all([
            modules.getDoc(groupRef),
            modules.getDoc(memberRef)
          ]);
          if (groupSnap.exists() || memberSnap.exists()) {
            const groupData = groupSnap.exists() ? groupSnap.data() : {};
            memberships.push({
              id: groupId,
              name: groupData.name || groupId,
              code: groupData.code || groupId,
              ownedByAccount: groupData.ownerUid === currentUser.uid,
              member: memberSnap.exists() ? memberSnap.data() : null
            });
          }
        } catch (error) {
          console.warn('Could not include group in cloud backup', groupId, error);
        }
      }

      const payload = {
        app: 'Bowling Tracker',
        version: window.BowlingApp?.version || 'unknown',
        backupType: 'firebase-cloud',
        exportedAt: new Date().toISOString(),
        profileName: profile?.displayName || currentUser.displayName || 'Bowler',
        account: {
          email: currentUser.email || '',
          displayName: profile?.displayName || currentUser.displayName || ''
        },
        profile: profile ? { ...profile } : null,
        games: games.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)),
        tombstones: tombstones.sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0)),
        groupMemberships: memberships
      };

      downloadJson(`bowling-cloud-backup-${localDateStamp()}.json`, payload);
      setStatus(`Cloud backup downloaded: ${games.length} live game${games.length === 1 ? '' : 's'} plus ${tombstones.length} deletion record${tombstones.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      console.error(error);
      setStatus(`Cloud backup failed. ${friendlyError(error)}`, 'error');
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
    const groupIds = [...new Set(profile?.groupIds || [])];
    const now = Date.now();

    for (const groupId of groupIds) {
      const groupRef = modules.doc(firestore, 'groups', groupId);
      const memberRef = modules.doc(firestore, 'groups', groupId, 'members', uid);
      const groupSnap = await modules.getDoc(groupRef);

      if (groupSnap.exists() && groupSnap.data().ownerUid === uid) {
        // A shared group belongs to everyone using it, so account deletion does
        // not erase other bowlers' rows. Remove the deleted UID from ownership
        // and leave the group usable as an ownerless shared leaderboard.
        await modules.updateDoc(groupRef, {
          ownerUid: '',
          ownerDeletedAt: now,
          updatedAt: now
        });
      }

      // Security rules allow every signed-in user to remove their own member row.
      await modules.deleteDoc(memberRef);
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
      'Permanently delete your Firebase account and cloud bowling data? Your local games on this device will remain. This cannot be undone unless you downloaded a backup.'
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

      setStatus('Deleting Firebase login…');
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
      setStatus("Signed out. This account's offline history stays isolated on this device.", 'success');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    }
  }

  // Preserve local edit order, particularly a deletion immediately followed by Undo.
  let localChangeQueue = Promise.resolve();
  let localChangeRevision = 0;
  function handleLocalDataChanged(event) {
    const detail = event.detail || {};
    const uid = currentUser?.uid;
    if (!uid || (detail.scope !== undefined && detail.scope !== uid)) return;
    queueLocalChange(detail,uid);
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
      dom.cloudDialog.showModal();
      renderConnectionState();
      if (configReady() && navigator.onLine) await initFirebase();
    });
    dom.closeCloudBtn?.addEventListener('click', () => dom.cloudDialog.close());
    dom.cloudDialog?.addEventListener('click', (event) => {
      if (event.target === dom.cloudDialog) dom.cloudDialog.close();
    });
    dom.leaderboardConnectBtn?.addEventListener('click', async () => {
      dom.cloudDialog.showModal();
      if (configReady() && navigator.onLine) await initFirebase();
    });
    dom.leaderboardManageGroupsBtn?.addEventListener('click', () => dom.cloudDialog.showModal());
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
    window.addEventListener('focus', () => {
      if (!currentUser || !navigator.onLine) return;
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

  window.BowlingCloud = {
    isSignedIn: () => Boolean(currentUser),
    syncNow: () => syncAll('Manual sync')
  };

  init();
})();
