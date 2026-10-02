import assert from 'node:assert/strict';
import {newGameId, recordId} from '../modules/ids.js';
import {normalizeGame, isValidGame, DATA_SCHEMA_VERSION} from '../modules/games.js';
import {sessionKey, buildSessions, chronologicalGames} from '../modules/sessions.js';
import {calculateStats, progressStats} from '../modules/statistics.js';
import {planSync, cloudGamePayload, cloudDeletePayload} from '../modules/reconciliation.js';
import {mergeInventory} from '../modules/inventory.js';
import {csvEscape} from '../modules/backup.js';

const game = (id, score = 180) => ({id,date:'2026-09-27',bowler:'Matthew',sessionName:'League',score,
  strikes:4,openFrames:3,strikeOpportunities:10,createdAt:1,updatedAt:1});
const uuid = newGameId();
assert.equal(recordId(uuid), uuid);
assert.equal(recordId('123'), 123);
for (const invalid of ['', 'NaN', '1e3', '001', 0, -1, 'bad-id']) assert.equal(recordId(invalid), null);
assert(isValidGame(game(uuid)));
const old = game(123), migrated = normalizeGame(old);
const zero = normalizeGame({...old,createdAt:0,updatedAt:0});
assert.equal(cloudGamePayload(zero).createdAt,0);
assert.equal(cloudGamePayload(zero).updatedAt,0,'Migration and sync must not invent edit timestamps');
assert.equal(cloudDeletePayload({id:'123',updatedAt:0}).updatedAt,0);
assert.equal(cloudDeletePayload({id:'123',updatedAt:0}).recordId,'123');
assert.equal(migrated.id, 123); assert.equal(migrated.updatedAt, old.updatedAt);
assert.equal(migrated.schemaVersion, DATA_SCHEMA_VERSION);
assert.deepEqual(normalizeGame(migrated), migrated, 'Migration is idempotent');
assert.equal(sessionKey({...migrated,date:'2027-01-01',sessionName:'Renamed'}), sessionKey(migrated));
assert.equal(buildSessions([migrated,normalizeGame(game(uuid))]).length, 1);
const only = normalizeGame({...game(uuid,200),scoreOnly:true,openFrames:null,strikes:null,strikeOpportunities:null});
const stats = calculateStats([migrated,only,{...game(456,300),noTap:true}]);
assert.equal(stats.average,190); assert.equal(stats.frameCount,1); assert.equal(stats.strikePct,40);
const local = {...migrated,score:190,updatedAt:2}, remote = {...migrated,score:210,updatedAt:3};
const params = {localGameMap:new Map([[123,local],[uuid,only]]),tombstoneMap:new Map(),remoteMap:new Map([[123,remote]]),
  syncOutbox:{123:{data:cloudGamePayload(local),base:cloudGamePayload(migrated)}},now:4};
const frozen = structuredClone(params);
const plan = planSync(params);
assert.equal(plan.unresolved.length,1); assert(plan.cloudWrites.some(write=>write.id===uuid));
assert.deepEqual(params,frozen,'Planner does not mutate inputs');
const resolved = planSync({...params,reviewChoices:{'version:123':'local'}});
assert.equal(resolved.unresolved.length,0);assert.equal(resolved.cloudWrites.find(write=>write.id===123).data.score,190);
const removed = mergeInventory([{name:' Ball ',updatedAt:1}], [{name:'ball',updatedAt:2,removed:true}]);
assert.equal(removed.length,1); assert(removed[0].removed);
assert.deepEqual(mergeInventory(removed,[{name:'Ball',updatedAt:1}]),removed,'Stale inventory cannot resurrect removals');
assert.equal(csvEscape('=SUM(A1)'),"'=SUM(A1)");
const chronology=[{...game(1,100),sessionId:'A',gameOrder:1,createdAt:10},
  {...game(2,200),sessionId:'A',gameOrder:2,createdAt:11},
  {...game(3,250),sessionId:'B',gameOrder:1,createdAt:20},
  {...game(4,150),sessionId:'B',gameOrder:2,createdAt:21},
  {...game(5,300),sessionId:'A',gameOrder:3,createdAt:30,noTap:true}];
// Full history establishes the session order even when a later no-tap game is
// omitted from standard statistics. Explicit order applies inside the session.
const selected=chronology.filter(g=>!g.noTap);
assert.deepEqual(chronologicalGames(selected,chronology).map(g=>g.id),[3,4,1,2]);
assert.equal(calculateStats(selected,chronology).recent200.id,2);
const reordered=chronology.map(g=>g.id===1?{...g,gameOrder:2}:g.id===2?{...g,gameOrder:1}:g);
assert.deepEqual(chronologicalGames(reordered).map(g=>g.id),[3,4,2,1,5]);
assert.equal(progressStats(selected,'recent',chronology).points.at(-1).average,175);
assert.equal(progressStats([{...game(99),date:'2026-01-01'}],'running',chronology).last10.count,1,'Standalone inputs remain supported');
console.log('PASS direct domain imports: UUID/legacy IDs, stable sessions, idempotent schema normalization, statistics, conflict plans, inventory tombstones and safe CSV.');
