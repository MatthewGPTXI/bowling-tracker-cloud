import fs from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, setDoc, getDoc, deleteDoc, updateDoc, serverTimestamp, writeBatch} from 'firebase/firestore';
import {cloudGamePayload, cloudDeletePayload} from '../modules/reconciliation.js';
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
  await assertFails(updateDoc(doc(a,'users/a'),{syncProtocolVersion:1}));
  await env.withSecurityRulesDisabled(async admin => setDoc(doc(admin.firestore(),'users/a'),{syncProtocolVersion:1},{merge:true}));
  await assertFails(setDoc(ref,record));
  await assertSucceeds(setDoc(ref,{...record,serverUpdatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(a,'users/a'),{syncReadAt:0}));
  await assertSucceeds(updateDoc(doc(a,'users/a'),{syncReadAt:serverTimestamp()}));
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
  console.log('PASS Firestore rules: numeric/UUID games, score-only, schema/range validation, private ownership, server cursor protocol and atomic group transfer.');
} finally { await env.cleanup(); }
