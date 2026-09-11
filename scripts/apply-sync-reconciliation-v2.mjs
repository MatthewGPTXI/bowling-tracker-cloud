import fs from 'node:fs';

const cloudPath = 'cloud.js';
const workerPath = 'service-worker.js';
let source = fs.readFileSync(cloudPath, 'utf8');

function replaceOnce(label, oldText, newText) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  source = source.replace(oldText, newText);
}

function replaceBlock(label, startMarker, endMarker, newBlock) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label}: end marker not found`);
  source = source.slice(0, start) + newBlock + source.slice(end);
}

replaceOnce(
  'cloud game identifiers',
  `      id: Number(game.id),\n      bowler: String(game.bowler),\n      date: String(game.date),\n      sessionName: String(game.sessionName || ''),`,
  `      id: Number(game.id),\n      recordId: String(game.recordId || game.id),\n      bowler: String(game.bowler),\n      date: String(game.date),\n      sessionName: String(game.sessionName || ''),\n      sessionId: String(game.sessionId || game.sessionName || ''),`
);
replaceOnce('game schema version', '      schemaVersion: 3\n', '      schemaVersion: 4\n');
replaceOnce(
  'soft delete payload',
  `      id: Number(tombstone.id),\n      updatedAt: Number(tombstone.updatedAt || Date.now()),\n      deleted: true,\n      schemaVersion: 2`,
  `      id: Number(tombstone.id),\n      recordId: String(tombstone.recordId || tombstone.id),\n      updatedAt: Number(tombstone.updatedAt || Date.now()),\n      deletedAt: Number(tombstone.deletedAt || tombstone.updatedAt || Date.now()),\n      deleted: true,\n      schemaVersion: 4`
);

replaceBlock(
  'conflict detection policy',
  '  function detectSyncIssues(localGameMap, tombstoneMap, remoteMap) {',
  '\n\n  function renderSyncReview',
`  function detectSyncIssues(localGameMap, tombstoneMap, remoteMap, outbox = {}) {
    const issues = [];

    // A visible conflict now means one narrow thing: this device changed a
    // specific record from a known base version, and the cloud independently
    // changed that same record before the local change could be uploaded.
    // Normal stale copies and same-looking games with different IDs reconcile
    // automatically and never interrupt the user.
    for (const [rawId, item] of Object.entries(outbox || {})) {
      const id = Number(rawId);
      if (!Number.isSafeInteger(id) || id <= 0 || !item?.data) continue;

      const local = localGameMap.get(id) || null;
      const tombstone = tombstoneMap.get(id) || null;
      const localVersion = local || (tombstone ? { ...tombstone, deleted: true } : null);
      const remote = remoteMap.get(id) || null;

      // If the local record has changed again since this outbox item was made,
      // this entry is stale and should not manufacture a conflict.
      if (!sameCloudVersion(localVersion, item.data)) continue;

      // Already uploaded, or the cloud is still exactly the version we edited.
      // In either case there is no competing edit to ask the user about.
      if (sameCloudVersion(remote, item.data) || sameCloudVersion(remote, item.base)) continue;

      const localDeleted = item.data.deleted === true;
      const remoteDeleted = !remote || remote.deleted === true;

      // Two independently recorded deletions have the same outcome. Reconcile
      // their timestamps automatically rather than calling this a conflict.
      if (localDeleted && remoteDeleted) continue;

      if (localDeleted || remoteDeleted) {
        issues.push({
          key: `delete:${id}:${localDeleted ? 'local' : 'cloud'}`,
          type: 'delete-conflict',
          id,
          liveSide: localDeleted ? 'cloud' : 'local',
          local,
          tombstone,
          remote
        });
        continue;
      }

      issues.push({
        key: `version:${id}`,
        type: 'version-conflict',
        id,
        local,
        remote
      });
    }

    return issues;
  }`
);

replaceOnce(
  'version conflict explanation',
  'This game has the same internal ID on both sides, but at least one bowling value or note differs. Choose which copy is correct.',
  'This exact saved game was edited on this device and in the cloud before either edit could see the other. Choose which version is correct.'
);
replaceOnce(
  'delete conflict explanation',
  'A copy of this game exists, but it was deleted on ${escapeHtml(deletedWhere)}. Nothing will be erased until you choose.',
  'This exact saved game was changed on one device while the other device deleted it. Nothing will be erased until you choose.'
);

replaceOnce(
  'outbox-aware issue detection',
  `      const issues = detectSyncIssues(localGameMap, tombstoneMap, remoteMap);`,
  `      const syncOutbox = readOutbox(uid);\n      const issues = detectSyncIssues(localGameMap, tombstoneMap, remoteMap, syncOutbox);`
);
replaceOnce(
  'successful outbox cleanup',
  `      // Explicit review choices supersede the saved retry versions.\n      const remaining = readOutbox(uid);\n      handledIds.forEach(id => delete remaining[id]); saveOutbox(uid,remaining);`,
  `      // Reaching this point means every currently queued local change has\n      // either been written, downloaded, or explicitly resolved. Because the\n      // sync is revision-guarded, clearing the outbox here cannot erase a newer\n      // local edit that arrived during this pass.\n      saveOutbox(uid, {});`
);
replaceOnce(
  'automatic race retry',
  `    } catch (error) {\n      console.error(error);\n      if (!isCurrentAccount()) return;\n      setSyncBadge('Needs sync', 'error');\n      setStatus(\`Sync paused: \${friendlyError(error)}\`, 'error');\n    } finally {\n      syncing = false;\n    }`,
  `    } catch (error) {\n      console.error(error);\n      if (!isCurrentAccount()) return;\n      if (error?.code === 'bowling/conflict') {\n        setSyncBadge('Refreshing cloud…', 'working');\n        setStatus('Cloud history changed during sync. Refreshing automatically…');\n        setTimeout(() => {\n          if (currentUser?.uid === uid && navigator.onLine) syncAll('Automatic retry');\n        }, 0);\n        return;\n      }\n      setSyncBadge('Saved on this device · needs sync', 'error');\n      setStatus(\`Sync paused: \${friendlyError(error)}\`, 'error');\n    } finally {\n      syncing = false;\n    }`
);
replaceOnce(
  'sync status language',
  '    setStatus(`${reason}: comparing local and cloud bowling history…`);',
  '    setStatus(`${reason}: reconciling local changes with your cloud history…`);'
);

fs.writeFileSync(cloudPath, source);

let worker = fs.readFileSync(workerPath, 'utf8');
const oldCache = "const CACHE_NAME = `${CACHE_PREFIX}v27-average-series`;";
const newCache = "const CACHE_NAME = `${CACHE_PREFIX}v28-sync-reconciliation`;";
if (!worker.includes(oldCache)) throw new Error('service worker cache marker not found');
worker = worker.replace(oldCache, newCache);
fs.writeFileSync(workerPath, worker);

console.log('Applied sync reconciliation v2 patch.');
