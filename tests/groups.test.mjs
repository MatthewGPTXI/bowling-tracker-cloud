import assert from 'node:assert/strict';
import {successorFor, leaveMembership} from '../modules/groups.js';
assert.equal(successorFor('a',[{uid:'c'},{uid:'a'},{uid:'b'}]),'b');
assert.equal(successorFor('a',[{uid:'a'}]),null);
let current=true;
const rows=new Map([['groups/G',{ownerUid:'a'}],['groups/G/members/a',{uid:'a'}],['groups/G/members/b',{uid:'b'}]]);
const snap=ref=>({exists:()=>rows.has(ref),data:()=>rows.get(ref)});
const sdk={doc:(_, ...parts)=>parts.join('/'),collection:(_, ...parts)=>parts.join('/'),getDoc:async ref=>snap(ref),
  getDocs:async ref=>({forEach:callback=>[...rows].filter(([key])=>key.startsWith(ref+'/')).forEach(([key])=>callback({id:key.split('/').at(-1)}))}),
  runTransaction:async(_,callback)=>{const writes=[];await callback({get:async ref=>snap(ref),update:(ref,value)=>writes.push(()=>rows.set(ref,{...rows.get(ref),...value})),delete:ref=>writes.push(()=>rows.delete(ref))});writes.forEach(write=>write());}};
await leaveMembership({sdk,firestore:{},groupId:'G',uid:'a',isCurrent:()=>current});
assert.equal(rows.get('groups/G').ownerUid,'b');assert(!rows.has('groups/G/members/a'));
current=false;await assert.rejects(leaveMembership({sdk,firestore:{},groupId:'G',uid:'b',isCurrent:()=>current}),/Account changed/);
assert(rows.has('groups/G/members/b'));
current=true;await leaveMembership({sdk,firestore:{},groupId:'G',uid:'b',isCurrent:()=>current});
assert(!rows.has('groups/G'));assert(!rows.has('groups/G/members/b'));
// Another owner may transfer ownership to this departing member between the
// initial read and the transaction. Do not treat that as an empty group.
rows.set('groups/G',{ownerUid:'b'}); rows.set('groups/G/members/a',{uid:'a'}); rows.set('groups/G/members/c',{uid:'c'});
const run = sdk.runTransaction;
sdk.runTransaction = (...args) => { rows.set('groups/G',{ownerUid:'a'}); return run(...args); };
await assert.rejects(leaveMembership({sdk,firestore:{},groupId:'G',uid:'a',isCurrent:()=>true}),/ownership changed/);
assert(rows.has('groups/G')); assert(rows.has('groups/G/members/a')); assert(rows.has('groups/G/members/c'));
console.log('PASS group lifecycle: deterministic transfer, departing member removal, account-switch guard and sole-owner dissolution.');
