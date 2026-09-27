import * as Balls from './ball-data.js';
import {recordId, orderValue} from './ids.js';
import {DATA_SCHEMA_VERSION, normalizeGame} from './games.js';

export function cloudGamePayload(game) {
  const balls = Balls.list(game);
  return {
    id: recordId(game.id),
    recordId: String(recordId(game.id)),
    bowler: String(game.bowler),
    date: String(game.date),
    sessionName: String(game.sessionName || ''),
    sessionId: normalizeGame(game).sessionId,
    ball: balls[0]?.name || '',
    balls,
    alley: Balls.clean(game.alley),
    noTap: game.noTap === true,
    sessionType: ['League','Practice','Tournament'].includes(game.sessionType) ? game.sessionType : 'League',
    ...(game.gameOrder !== undefined ? {gameOrder:Number(game.gameOrder)} : {}),
    score: Number(game.score),
    scoreOnly: game.scoreOnly === true,
    openFrames: game.scoreOnly === true ? null : Number(game.openFrames),
    strikes: game.scoreOnly === true ? null : Number(game.strikes),
    strikeOpportunities: game.scoreOnly === true ? null : Number(game.strikeOpportunities || 10),
    notes: String(game.notes || ''),
    createdAt: Number(game.createdAt ?? 0),
    updatedAt: Number(game.updatedAt ?? game.createdAt ?? 0),
    deleted: false,
    schemaVersion: DATA_SCHEMA_VERSION
  };
}

export function cloudDeletePayload(tombstone) {
  return {
    id: recordId(tombstone.id),
    recordId: String(recordId(tombstone.id)),
    updatedAt: Number(tombstone.updatedAt ?? 0),
    deletedAt: Number(tombstone.deletedAt ?? tombstone.updatedAt ?? 0),
    deleted: true,
    schemaVersion: DATA_SCHEMA_VERSION
  };
}

export function normalizedSessionName(game) {
  return String(game?.sessionName || '').trim().toLowerCase();
}

export function comparableGame(game) {
  return {
    date: String(game?.date || ''),
    sessionName: normalizedSessionName(game),
    sessionId: game ? normalizeGame(game).sessionId : '',
    balls: Balls.comparable(game),
    alley: Balls.clean(game?.alley),
    noTap: game?.noTap === true,
    sessionType: game?.sessionType || 'League',
    gameOrder: game ? orderValue(game) : 0,
    score: Number(game?.score || 0),
    scoreOnly: game?.scoreOnly === true,
    openFrames: game?.scoreOnly === true ? null : Number(game?.openFrames || 0),
    strikes: game?.scoreOnly === true ? null : Number(game?.strikes || 0),
    strikeOpportunities: game?.scoreOnly === true ? null : Number(game?.strikeOpportunities || 10),
    notes: String(game?.notes || '').trim()
  };
}

export function sameGameContent(a, b) {
  return JSON.stringify(comparableGame(a)) === JSON.stringify(comparableGame(b));
}

export function sameCloudVersion(a, b) {
  if (!a || !b) return !a && !b;
  return !!a.deleted === !!b.deleted && Number(a.updatedAt || 0) === Number(b.updatedAt || 0)
    && (a.deleted || sameGameContent(a,b));
}

export function detectSyncIssues(localGameMap, tombstoneMap, remoteMap, outbox = {}) {
  const issues = [];

  // A visible conflict now means one narrow thing: this device changed a
  // specific record from a known base version, and the cloud independently
  // changed that same record before the local change could be uploaded.
  // Normal stale copies and same-looking games with different IDs reconcile
  // automatically and never interrupt the user.
  for (const [rawId, item] of Object.entries(outbox || {})) {
    const id = recordId(rawId);
    if (id === null || !item?.data) continue;

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
        key: `delete:${id}:${localDeleted ? 'local' : 'cloud'}` ,
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
      key: `version:${id}` ,
      type: 'version-conflict',
      id,
      local,
      remote
    });
  }

  return issues;
}

export function planSync({localGameMap, tombstoneMap, remoteMap, syncOutbox = {}, reviewChoices = null, reviewedIssues = null, now = Date.now()}) {
      const issues = detectSyncIssues(localGameMap, tombstoneMap, remoteMap, syncOutbox);
      if (reviewChoices && reviewedIssues && JSON.stringify(issues) !== JSON.stringify(reviewedIssues)) reviewChoices = null;
      const unresolved = issues.filter((issue) => !reviewChoices?.[issue.key]);
      const cloudWrites = [];
      const localUpserts = [];
      const localDeletes = [];
      const handledIds = new Set(unresolved.map(issue => issue.id));
      const resolutionTime = issues.reduce((time, issue) => Math.max(time, Number(issue.local?.updatedAt || 0) + 1, Number(issue.remote?.updatedAt || 0) + 1, Number(issue.tombstone?.updatedAt || 0) + 1), now);

      // Apply explicit user choices first. Standard reconciliation below skips
      // these IDs so the choices cannot be overwritten by timestamp rules.
      for (const issue of issues) {
        const choice = reviewChoices?.[issue.key];
        if (!choice) continue;

        if (issue.type === 'version-conflict') {
          handledIds.add(issue.id);
          if (choice === 'local') {
            localUpserts.push({...issue.local,updatedAt:resolutionTime});
            cloudWrites.push({ id: issue.id, data: cloudGamePayload({ ...issue.local, updatedAt: resolutionTime }) });
          } else {
            localUpserts.push({ ...issue.remote, updatedAt: resolutionTime });
            cloudWrites.push({ id: issue.id, data: cloudGamePayload({ ...issue.remote, updatedAt: resolutionTime }) });
          }
          continue;
        }

        if (issue.type === 'delete-conflict') {
          handledIds.add(issue.id);
          if (choice === 'keep-game') {
            const live = issue.liveSide === 'local' ? issue.local : issue.remote;
            const resolved = { ...live, updatedAt: resolutionTime };
            localUpserts.push(resolved);
            cloudWrites.push({ id: issue.id, data: cloudGamePayload(resolved) });
          } else {
            const deletion = { id: issue.id, updatedAt: resolutionTime };
            localDeletes.push(deletion);
            cloudWrites.push({ id: issue.id, data: cloudDeletePayload(deletion) });
          }
          continue;
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
            cloudWrites.push({ id: id, data: cloudGamePayload(local) });
          } else if (tombstone && deleteAt > remoteAt) {
            cloudWrites.push({ id: id, data: cloudDeletePayload(tombstone) });
          } else if (local || !tombstone || remoteAt > deleteAt) {
            localDeletes.push({ id, updatedAt: remoteAt });
          }
          continue;
        }

        if (tombstone && deleteAt >= remoteAt && deleteAt >= localAt) {
          cloudWrites.push({ id: id, data: cloudDeletePayload(tombstone) });
        } else if (local && localAt >= remoteAt) {
          if (localAt > remoteAt) cloudWrites.push({ id: id, data: cloudGamePayload(local) });
        } else {
          localUpserts.push(remote);
        }
      }

      for (const [id, local] of localGameMap.entries()) {
        if (handledIds.has(id)) continue;
        if (!remoteMap.has(id)) cloudWrites.push({ id: id, data: cloudGamePayload(local) });
      }
      for (const [id, tombstone] of tombstoneMap.entries()) {
        if (handledIds.has(id)) continue;
        if (!remoteMap.has(id)) cloudWrites.push({ id: id, data: cloudDeletePayload(tombstone) });
      }


  return {issues, unresolved, cloudWrites, localUpserts, localDeletes};
}
