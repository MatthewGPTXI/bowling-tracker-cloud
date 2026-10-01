import fs from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, setDoc, getDoc, deleteDoc, updateDoc, serverTimestamp, writeBatch} from 'firebase/firestore';
import {cloudGamePayload, cloudDeletePayload} from '../modules/reconciliation.js';
import * as sdk from 'firebase/firestore';
import assert from 'node:assert/strict';
import {readRemoteHistory} from '../modules/cloud-reader.js';
import {leaveMembership} from '../modules/groups.js';
const env = await initializeTestEnvironment({projectId:'demo-bowling-tracker',firestore:{rules:await fs.readFile('firestore.rules','utf8')}});
try {
  const a = env.authenticatedContext('a').firestore(), b = env.authenticatedContext('b').firestore();
  const record = cloudGamePayload({id:1,date:'2026-09-27',bowler:'Matthew',score:180,openFrames:3,strikes:4,strikeOpportunities:10,createdAt:1,updatedAt:1});
  const ref = doc(a,'users/a/games/1');
  await assertSucceeds(setDoc(doc(a,'users/a'),{displayName:'Matthew',groupIds:[]}));
  await assertSucceeds(setDoc(ref,record));
  await assertSucceeds(setDoc(ref,{...record,serverUpdatedAt:serverTimestamp()}));
  await assertFails(getDoc(doc(b,'users/a/games/1')));
  await assertFails(setDoc(doc(b,'users/a/games/1'),record));
  for (const change of [{score:301},{id:2},{strikes:13},{openFrames:-1},{uid:'b'},{balls:[{name:'x',frames:11}]},{noTap:'yes'},{serverUpdatedAt:0}]) {
    await assertFails(setDoc(ref,{...record,...change}));
  }
  const uuid = crypto.randomUUID();
  await assertSucceeds(setDoc(doc(a,'users/a/games/'+uuid),cloudGamePayload({...record,id:uuid,recordId:uuid,scoreOnly:true,strikes:null,openFrames:null,strikeOpportunities:null})));
  await assertSucceeds(setDoc(ref,cloudDeletePayload({id:1,updatedAt:2})));
  // Keep the rollout compatible with the last numeric-ID client. v38 writes
  // schema 5 records without server timestamps and replaces whole documents.
  // Its edits must remain permitted until an admin opts the account in.
  const legacy = {...record, id:3, recordId:'3', schemaVersion:5, sessionId:'League',
    sessionName:'League', sessionType:'Practice', noTap:true, alley:'Bowlero',
    ball:'Phaze II', balls:[{name:'Phaze II',frames:6},{name:'Spare',frames:4}],
    createdAt:0, updatedAt:0};
  const legacyRef = doc(a,'users/a/games/3');
  await assertSucceeds(setDoc(legacyRef,legacy));
  await assertSucceeds(setDoc(legacyRef,{...legacy,scoreOnly:true,score:199,
    openFrames:null,strikes:null,strikeOpportunities:null,updatedAt:1}));
  await assertSucceeds(setDoc(legacyRef,{id:3,recordId:'3',schemaVersion:5,
    deleted:true,updatedAt:2,deletedAt:2}));
  await assertSucceeds(deleteDoc(legacyRef));

  // Independent device connections to the same account must see each other's
  // UUID edits and tombstones. The fallback also sees an older device's edit
  // after it replaces a timestamped numeric record with a schema-5 payload.
  const secondDevice = env.authenticatedContext('a').firestore();
  const sharedId = crypto.randomUUID(), sharedRef = doc(a,'users/a/games/'+sharedId);
  await assertSucceeds(setDoc(sharedRef,{...cloudGamePayload({...record,id:sharedId}),
    serverUpdatedAt:serverTimestamp()}));
  const reader = firestore => readRemoteHistory({sdk,firestore,uid:'a',isCurrent:()=>true});
  assert.equal((await reader(secondDevice)).records.get(sharedId).score,180);
  await assertSucceeds(setDoc(doc(secondDevice,'users/a/games/'+sharedId),
    {...cloudGamePayload({...record,id:sharedId,score:211,updatedAt:2}),serverUpdatedAt:serverTimestamp()}));
  assert.equal((await reader(a)).records.get(sharedId).score,211);
  await assertSucceeds(setDoc(sharedRef,{...cloudDeletePayload({id:sharedId,updatedAt:3}),
    serverUpdatedAt:serverTimestamp()}));
  assert.equal((await reader(secondDevice)).records.get(sharedId).deleted,true);
  await assertSucceeds(deleteDoc(sharedRef));
  await assertSucceeds(setDoc(legacyRef,{...legacy,serverUpdatedAt:serverTimestamp()}));
  await assertSucceeds(setDoc(doc(secondDevice,'users/a/games/3'),{...legacy,score:201,updatedAt:4}));
  const fallback = await reader(a);
  assert.equal(fallback.records.get(3).score,201);
  assert.equal(fallback.snapshot,null,'Unenrolled accounts retain full-history sync');
  await assertSucceeds(deleteDoc(legacyRef));
  await assertFails(updateDoc(doc(a,'users/a'),{syncProtocolVersion:1}));
  await env.withSecurityRulesDisabled(async admin => setDoc(doc(admin.firestore(),'users/a'),{syncProtocolVersion:1},{merge:true}));
  await assertFails(setDoc(ref,record));
  await assertFails(setDoc(legacyRef,legacy));
  await assertFails(updateDoc(doc(a,'users/a'),{syncProtocolVersion:0}));
  await assertSucceeds(setDoc(ref,{...record,serverUpdatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(a,'users/a'),{syncReadAt:0}));
  await assertSucceeds(updateDoc(doc(a,'users/a'),{syncReadAt:serverTimestamp()}));
  // Exercise the actual cursor query and the same write chunk size as sync.
  for (let start=10; start<270; start+=100) {
    const batch = writeBatch(a);
    for (let id=start; id<Math.min(start+100,270); id++) batch.set(doc(a,'users/a/games/'+id),{...cloudGamePayload({...record,id}),serverUpdatedAt:serverTimestamp()});
    await assertSucceeds(batch.commit());
  }
  const history = await readRemoteHistory({sdk,firestore:a,uid:'a',isCurrent:()=>true,protocol:1});
  assert.equal(history.records.size,262);
  await assertSucceeds(setDoc(doc(a,'users/a/games/10'),{...cloudDeletePayload({id:10,updatedAt:2}),serverUpdatedAt:serverTimestamp()}));
  const delta = await readRemoteHistory({sdk,firestore:a,uid:'a',isCurrent:()=>true,protocol:1,baseline:history.snapshot});
  assert.equal(delta.records.size,262); assert.equal(delta.records.get(10).deleted,true);
  const group = doc(a,'groups/ABC123');
  await assertSucceeds(setDoc(group,{name:'League',code:'ABC123',ownerUid:'a',createdAt:1,updatedAt:1}));
  const summary = {uid:'a',displayName:'Matthew',games:1,average:180,highGame:180,highSeries:0,strikePct:40};
  await assertSucceeds(setDoc(doc(a,'groups/ABC123/members/a'),summary));
  await assertSucceeds(setDoc(doc(b,'groups/ABC123/members/b'),{...summary,uid:'b'}));
  await assertFails(updateDoc(group,{ownerUid:''}));
  await assertFails(updateDoc(group,{ownerUid:'outsider'}));
  const transfer = writeBatch(a); transfer.update(group,{ownerUid:'b'}); transfer.delete(doc(a,'groups/ABC123/members/a'));
  await assertSucceeds(transfer.commit());
  await assertFails(updateDoc(group,{name:'Old owner'}));
  await assertSucceeds(updateDoc(doc(b,'groups/ABC123'),{name:'New owner'}));
  await assertSucceeds(deleteDoc(doc(b,'groups/ABC123')));
  // A partially completed group creation can leave an owner without a member
  // row. The owner must still be able to inspect membership and dissolve it.
  await assertSucceeds(setDoc(doc(a,'groups/INCOMPLETE'),{name:'Pending',code:'INCOMPLETE',ownerUid:'a',createdAt:1,updatedAt:1}));
  await assertFails(sdk.getDocs(sdk.collection(b,'groups/INCOMPLETE/members')));
  await leaveMembership({sdk,firestore:a,groupId:'INCOMPLETE',uid:'a',isCurrent:()=>true});
  assert(!(await getDoc(doc(a,'groups/INCOMPLETE'))).exists());
  console.log('PASS Firestore rules: v38 rollout compatibility, independent same-account device edits/deletions, numeric/UUID games, score-only, schema/range validation, private ownership, server cursor protocol and atomic group transfer.');
} finally { await env.cleanup(); }
