const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../cloud.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf('  '+start),source.indexOf('  '+end,source.indexOf('  '+start)));
(async()=>{
 const remote=new Map(),local=new Map(),removed=new Map(),storage=new Map(),badges=[];let fail=false;
 const game=(id,score)=>({id,date:'2026-09-06',bowler:'Matthew',sessionName:'League',score,openFrames:3,strikes:4,strikeOpportunities:10,createdAt:id,updatedAt:id});
 const app={getGames:()=>[...local.values()],getTombstones:async()=>[...removed.values()],applyRemoteChanges:async({upserts,deletes})=>{upserts.forEach(g=>{local.set(g.id,g);removed.delete(g.id)});deletes.forEach(g=>{removed.set(g.id,g);local.delete(g.id)})}};
 const c={currentUser:{uid:'a'},authRevision:1,localChangeRevision:0,navigator:{onLine:true},firestore:{},pendingLocalChanges:1,pendingSyncReview:null,syncing:false,lastSyncAt:0,localChangeQueue:Promise.resolve(),console:{error(){},warn(){}},Math,Number,Map,Set,JSON,Date,
 localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},waitForBowlingApp:async()=>app,publishAllSummaries:async()=>{},loadLeaderboard:async()=>{},setSyncBadge:s=>badges.push(s),setStatus(){},friendlyError:e=>e.message,
 hideSyncReview(){c.pendingSyncReview=null},renderSyncReview(issues){c.pendingSyncReview={issues}},
 modules:{doc:(_,a,uid,b,id)=>id,collection:()=>'',getDocs:async()=>({forEach:f=>remote.forEach((g,id)=>f({id:String(id),data:()=>g}))}),runTransaction:async(_,callback)=>{
 if(fail)throw new Error('Simulated connection loss');const writes=[];const result=await callback({get:async ref=>({exists:()=>remote.has(Number(ref)),data:()=>remote.get(Number(ref))}),set:(ref,data)=>writes.push([Number(ref),data])});writes.forEach(([ref,data])=>remote.set(ref,data));return result;
 }}};
 c.window={BowlingBalls:require('../balls.js')};
 vm.createContext(c);
 vm.runInContext(section('function cloudGameRef','function renderSyncReview')+section('function outboxKey','function randomGroupCode'),c);
 const base=game(1,150);local.set(1,base);c.queueLocalChange({type:'upsert',game:base,bases:[null]},'a');await c.performSyncAll();assert.equal(remote.get(1).score,150);assert.equal(Object.keys(c.readOutbox('a')).length,0);
 const edit={...base,score:180,updatedAt:2};local.set(1,edit);c.queueLocalChange({type:'upsert',game:edit,bases:[base]},'a');c.navigator.onLine=false;await c.performSyncAll();assert.equal(remote.get(1).score,150);assert(c.readOutbox('a')[1]);
 // Recover from durable storage (no in-memory pending request is needed).
 c.navigator.onLine=true;await c.performSyncAll();assert.equal(remote.get(1).score,180);assert.equal(c.pendingSyncReview,null);
 const edit2={...edit,ball:'Ball A',updatedAt:3};local.set(1,edit2);c.queueLocalChange({type:'upsert',game:edit2,bases:[edit]},'a');remote.set(1,{...edit,score:220,updatedAt:4});
 const fresh=game(2,190);local.set(2,fresh);c.queueLocalChange({type:'upsert',game:fresh,bases:[null]},'a');await c.performSyncAll();assert.equal(remote.get(1).score,220);assert.equal(remote.get(2).score,190,'Unrelated new games must sync during a conflict');assert(c.pendingSyncReview);
 await c.performSyncAll('Reviewed sync',{'version:1':'local'});assert.equal(remote.get(1).ball,'Ball A');assert.equal(c.pendingSyncReview,null);assert.equal(Object.keys(c.readOutbox('a')).length,0);
 const third=game(3,170);local.set(3,third);c.queueLocalChange({type:'upsert',game:third,bases:[null]},'a');fail=true;await c.performSyncAll();assert(c.readOutbox('a')[3]);assert(!remote.has(3));fail=false;await c.performSyncAll();assert.equal(remote.get(3).score,170);
 const newer={...third,score:175,updatedAt:4},newest={...third,score:185,updatedAt:5};local.set(3,newest);c.queueLocalChange({type:'upsert',game:newer,bases:[third]},'a');c.queueLocalChange({type:'upsert',game:newest,bases:[newer]},'a');await c.performSyncAll();assert.equal(remote.get(3).score,185,'Retry keeps earliest base and latest edit');
 assert(!c.sameGameContent({...base,ball:'A'},{...base,ball:'B'}));assert(c.sameGameContent(base,{...base,ball:''}));
 assert(!c.sameGameContent({...base,noTap:true},{...base,noTap:false}));assert(c.sameGameContent(base,{...base,noTap:false}));
 assert.notEqual(c.duplicateSignature({...base,noTap:true}),c.duplicateSignature(base),'Standard and no-tap games are not duplicates');
 assert.equal(c.cloudGamePayload({...base,noTap:true}).noTap,true);assert.equal(c.cloudGamePayload(base).noTap,false);
 const beforeTag=local.get(3),tagged={...beforeTag,noTap:true,updatedAt:beforeTag.updatedAt+1};
 local.set(3,tagged);c.queueLocalChange({type:'upsert',game:tagged,bases:[beforeTag]},'a');c.navigator.onLine=false;await c.performSyncAll();
 assert.equal(remote.get(3).noTap,false);assert.equal(c.readOutbox('a')[3].data.noTap,true);
 c.pendingLocalChanges=0;c.navigator.onLine=true;await c.performSyncAll();
 assert.equal(remote.get(3).noTap,true,'A tag-only offline edit survives a durable retry');assert.equal(Object.keys(c.readOutbox('a')).length,0);
 const beforeUntag=local.get(3),untagged={...beforeUntag,noTap:false,updatedAt:beforeUntag.updatedAt+1};
 local.set(3,untagged);c.queueLocalChange({type:'upsert',game:untagged,bases:[beforeUntag]},'a');
 remote.set(3,{...remote.get(3),notes:'Edited elsewhere',updatedAt:untagged.updatedAt+1});
 await c.performSyncAll();assert(c.pendingSyncReview,'A scoring-tag edit must not overwrite a concurrent cloud edit');assert.equal(remote.get(3).noTap,true);
 await c.performSyncAll('Reviewed sync',{'version:3':'remote'});assert.equal(local.get(3).noTap,true);assert.equal(local.get(3).notes,'Edited elsewhere');assert.equal(c.pendingSyncReview,null);
 remote.set(7,{...game(7,190),noTap:true});await c.performSyncAll();assert.equal(local.get(7).noTap,true);
 assert.equal(Object.keys(c.readOutbox('other')).length,0);await assert.rejects(()=>c.guardedWrites([{ref:'1',data:base}],new Map([[1,base]]),()=>false));
 const requests={},rendered=[];
 const d={currentUser:{uid:'a'},authRevision:1,selectedGroupId:'A',navigator:{onLine:true},firestore:{},console,Date,modules:{collection:(_,type,id)=>id,getDocs:ref=>new Promise(resolve=>requests[ref]=resolve)},setLeaderboardStatus(){},renderLeaderboardRows:rows=>rendered.push(rows),friendlyError:String};
 vm.createContext(d);vm.runInContext(section('let leaderboardRequest','function renderLeaderboardRows'),d);
 const first=d.loadLeaderboard();d.selectedGroupId='B';const second=d.loadLeaderboard();requests.B({forEach:f=>f({data:()=>({name:'B'})})});await second;requests.A({forEach:f=>f({data:()=>({name:'A'})})});await first;assert.equal(rendered.length,1);assert.equal(rendered[0][0].name,'B');
 const split={...game(8,180),ball:'Venom',balls:[{name:'Venom',frames:4},{name:'Mercy',frames:6}]};
 local.set(8,split);c.queueLocalChange({type:'upsert',game:split,bases:[null]},'a');await c.performSyncAll();
 assert.equal(JSON.stringify(remote.get(8).balls),JSON.stringify(split.balls));
 assert(c.sameGameContent({...base,ball:'Venom'},{...base,balls:[{name:'venom',frames:null}]}),'Legacy single balls compare equally');
 const allocation={...split,balls:[{name:'Venom',frames:5},{name:'Mercy',frames:5}],updatedAt:9};
 assert(!c.sameGameContent(split,allocation),'Frame-only edits must be detected');
 local.set(8,allocation);c.queueLocalChange({type:'upsert',game:allocation,bases:[split]},'a');c.navigator.onLine=false;await c.performSyncAll();
 assert.equal(c.readOutbox('a')[8].data.balls[1].frames,5);c.pendingLocalChanges=0;c.navigator.onLine=true;await c.performSyncAll();
 assert.equal(remote.get(8).balls[1].frames,5,'Frame counts survive an offline/reload retry');
 const later={...allocation,balls:[{name:'Venom',frames:6},{name:'Mercy',frames:4}],updatedAt:10};
 local.set(8,later);c.queueLocalChange({type:'upsert',game:later,bases:[allocation]},'a');remote.set(8,{...allocation,notes:'Changed on another device',updatedAt:11});
 await c.performSyncAll();assert(c.pendingSyncReview);assert.equal(remote.get(8).balls[1].frames,5);
 await c.performSyncAll('Reviewed sync',{'version:8':'remote'});assert.equal(local.get(8).balls[1].frames,5);assert.equal(local.get(8).notes,'Changed on another device');
 console.log('PASS: sync, durable retries, conflict protection, no-tap and multi-ball/frame-only edits, account isolation and stale leaderboards.');
})().catch(e=>{console.error(e);process.exitCode=1});
