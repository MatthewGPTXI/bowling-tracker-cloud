const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const legacy=require('./helpers/legacy.cjs');
const source=legacy.source(path.join(__dirname,'../cloud.js'));
const section=(start,end)=>source.slice(source.indexOf('  '+start),source.indexOf('  '+end,source.indexOf('  '+start)));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
  const requests={},writes=[];
  const c={currentUser:{uid:'a'},authRevision:1,profile:null,firestore:{},Date,console,
    waitForBowlingApp:async()=>({}),modules:{doc:(_,type,uid)=>uid,getDoc:uid=>new Promise(resolve=>requests[uid]=resolve)}};
  vm.createContext(legacy.prepare(c));
  vm.runInContext(section('async function userProfileRef','function updateProfileBowlerOptions'),c);
  const a=c.loadOrCreateProfile();await turn();c.currentUser={uid:'b'};c.authRevision++;
  const b=c.loadOrCreateProfile();await turn();
  requests.b({exists:()=>true,data:()=>({displayName:'Account B',groupIds:['B-GROUP']})});await b;
  requests.a({exists:()=>true,data:()=>({displayName:'Account A',groupIds:['A-GROUP']})});
  assert.equal(await a,null);assert.equal(c.profile.displayName,'Account B');
  // The same UID after a later auth cycle is still a different operation.
  c.currentUser={uid:'a'};c.authRevision++;const old=c.loadOrCreateProfile();await turn();
  c.authRevision++;c.profile={displayName:'New session'};
  requests.a({exists:()=>true,data:()=>({displayName:'Old session'})});await old;
  assert.equal(c.profile.displayName,'New session');
  let release;
  c.waitForBowlingApp=async()=>({getDefaultBowler:()=>new Promise(resolve=>release=resolve),getBowlerNames:()=>[]});
  c.modules.getDoc=async()=>({exists:()=>false});c.modules.setDoc=async(ref,data)=>writes.push({ref,data});
  const creating=c.loadOrCreateProfile();await turn();c.currentUser={uid:'b'};c.authRevision++;c.profile={displayName:'B'};
  release('Default A');await creating;assert.equal(writes.length,0);assert.equal(c.profile.displayName,'B');

  c.dom={profileDisplayName:{value:'Name requested for A'}};c.currentUser={uid:'a',email:'a@example.invalid'};c.authRevision++;c.profile={};
  c.modules.updateProfile=user=>{assert.equal(user.uid,'a');return new Promise(resolve=>release=resolve)};
  c.waitForBowlingApp=async()=>({setProfileName(){throw Error('Stale profile must not reach the new local account')}});
  c.publishAllSummaries=async()=>{};c.loadLeaderboard=async()=>{};c.setStatus=()=>{};c.friendlyError=error=>error.message;
  vm.runInContext(section('async function saveProfile','async function createAccount'),c);
  const saving=c.saveProfile();c.currentUser={uid:'b',email:'b@example.invalid'};c.authRevision++;c.profile={displayName:'B'};
  release();await saving;assert.equal(writes.length,0);assert.equal(c.profile.displayName,'B');
  // A request already sent to A may finish, but must never update B's state.
  c.currentUser={uid:'a',email:'a@example.invalid'};c.authRevision++;c.profile={displayName:'A'};c.modules.updateProfile=async()=>{};
  c.modules.setDoc=(ref,data)=>{writes.push({ref,data});return new Promise(resolve=>release=resolve)};
  const sent=c.saveProfile();await turn();assert.equal(writes.at(-1).ref,'a');
  c.currentUser={uid:'b'};c.authRevision++;c.profile={displayName:'B'};release();await sent;
  assert.equal(c.profile.displayName,'B');assert.equal(writes.length,1);

  c.currentUser={uid:'a'};c.authRevision++;c.profile={groupIds:['A'],activeGroupId:'A'};c.selectedGroupId='A';
  vm.runInContext(section('async function setProfileGroupIds','async function memberPayload'),c);
  const membership=c.setProfileGroupIds(['A','NEW'],'NEW');assert.equal(writes.at(-1).ref,'a');
  c.currentUser={uid:'b'};c.authRevision++;c.profile={groupIds:['B'],activeGroupId:'B'};release();await membership;
  assert.deepEqual(plain(c.profile),{groupIds:['B'],activeGroupId:'B'});

  const pubs=[],memberships=[];
  c.dom={joinGroupCode:{value:'JOIN-A'}};c.initFirebase=async()=>true;
  c.currentUser={uid:'a'};c.authRevision++;c.profile={groupIds:['A']};
  c.modules.getDoc=()=>new Promise(resolve=>release=resolve);
  c.publishSummaryToGroup=async id=>pubs.push(id);c.setProfileGroupIds=async ids=>memberships.push(ids);
  c.resetLeaderboardView=()=>{};c.loadGroups=async()=>{};
  vm.runInContext(section('async function joinGroup','async function leaveGroup'),c);
  const joining=c.joinGroup();await turn();c.currentUser={uid:'b'};c.authRevision++;c.profile={groupIds:['B']};
  release({exists:()=>true,data:()=>({name:'A group'})});await joining;
  assert.equal(pubs.length,0);assert.equal(memberships.length,0);assert.deepEqual(plain(c.profile.groupIds),['B']);

  // A tab can miss BroadcastChannel delivery. The persistent revision still
  // invalidates a cloud read begun before that tab committed an edit.
  let savedRevision=1,local={id:1,date:'2026-10-01',bowler:'Review',sessionName:'League',score:150,openFrames:3,strikes:4,strikeOpportunities:10,createdAt:1,updatedAt:1};
  const scheduled=[],applies=[],acks=[];
  const app={getLocalScopeInfo:()=>({uid:'a'}),getGames:()=>[local],getTombstones:async()=>[],getSyncOutbox:()=>({}),
    getSyncState:async()=>({games:[structuredClone(local)],tombstones:[],outbox:{},revision:savedRevision}),
    getHistoryRevision:async()=>savedRevision,acknowledgeSyncOutbox:async()=>acks.push(true),applyRemoteChanges:async value=>applies.push(value)};
  const sync={currentUser:{uid:'a'},authRevision:1,profile:null,localChangeRevision:0,pendingLocalChanges:0,pendingSyncReview:null,syncing:false,
    firestore:{},navigator:{onLine:true},localChangeQueue:Promise.resolve(),window:{BowlingApp:app},
    console:{error(){},warn(){}},waitForBowlingApp:async()=>app,publishAllSummaries:async()=>{},loadLeaderboard:async()=>{},
    setSyncBadge(){},setStatus(){},friendlyError:error=>error.message,hideSyncReview(){},renderSyncReview(){},
    setTimeout:fn=>scheduled.push(fn),modules:{doc:(_,a,uid,b,id)=>id,collection:()=>'',
      getDocs:()=>new Promise(resolve=>release=resolve),runTransaction:async(_,fn)=>fn({get(){},set(){}})}};
  vm.createContext(legacy.prepare(sync));
  vm.runInContext(section('function cloudGameRef','function renderSyncReview')+section('function withServerTimestamp','function randomGroupCode'),sync);
  const pending=sync.performSyncAll();await turn();local={...local,score:230,updatedAt:3};savedRevision++;
  release({forEach:fn=>fn({id:'1',data:()=>({...local,score:170,updatedAt:2})})});await pending;
  assert.equal(local.score,230);assert.equal(applies.length,0);assert.equal(acks.length,0);assert.equal(scheduled.length,1);
  // If another tab edits just after a transaction uploads, acknowledge that
  // confirmed upload even though the rest of this sync must stop and retry.
  const original={...local,score:150,updatedAt:1},upload={...local,score:180,updatedAt:2};
  let current=true;
  app.getSyncOutbox=()=>({1:{data:sync.cloudGamePayload(upload),base:original}});
  app.acknowledgeSyncOutbox=async(items,uid)=>acks.push({items,uid});
  sync.modules.runTransaction=async(_,fn)=>{
    const result=await fn({get:async()=>({exists:()=>true,data:()=>original}),set(){}});current=false;return result;
  };
  await sync.flushOutbox('a',async()=>current,new Map([[1,upload]]),new Map());
  assert.equal(acks.length,1);assert.equal(acks[0].uid,'a');assert.equal(acks[0].items[1].data.score,180);
  console.log('PASS account races: delayed profiles, repeated UID auth cycles, delayed defaults, profile saves before/after dispatch, membership/join guards and persistent cross-tab revision checks during sync.');
})().catch(error=>{console.error(error);process.exitCode=1});
