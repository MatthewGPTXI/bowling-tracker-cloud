const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../cloud.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf('  '+start),source.indexOf('  '+end,source.indexOf('  '+start)));
(async()=>{
 const remote=new Map(),badges=[];let reviews=0;
 const base={id:1,date:'2026-09-06',sessionName:'League',score:150,openFrames:3,strikes:4,strikeOpportunities:10,createdAt:1,updatedAt:1};
 const c={currentUser:{uid:'a'},authRevision:1,navigator:{onLine:true},firestore:{},pendingLocalChanges:1,pendingSyncReview:null,console,Math,Number,Map,JSON,
 updateProfileBowlerOptions(){},cloudGamePayload:g=>g,cloudDeletePayload:g=>({...g,deleted:true}),publishAllSummaries:async()=>{},loadLeaderboard:async()=>{},setSyncBadge:s=>badges.push(s),setStatus(){},friendlyError:String,
 performSyncAll:async()=>{reviews++;},modules:{doc:(_,a,uid,b,id)=>id,runTransaction:async(_,callback)=>{
 const writes=[];await callback({get:async ref=>({exists:()=>remote.has(ref),data:()=>remote.get(ref)}),set:(ref,data)=>writes.push([ref,data])});writes.forEach(([ref,data])=>remote.set(ref,data));
 }}};
 vm.createContext(c);
 vm.runInContext(section('function normalizedSessionName','function duplicateSignature')+section('function sameCloudVersion','function syncAll')+section('async function syncLocalChange','function wireEvents'),c);
 assert(!c.sameGameContent({...base,ball:'Ball A'},{...base,ball:'Ball B'}),'Ball-only edits must participate in sync conflict detection');
 assert(c.sameGameContent(base,{...base,ball:''}),'Legacy games have an empty ball');
 remote.set('1',{...base,score:220,updatedAt:3});
 await c.syncLocalChange({type:'upsert',game:{...base,score:180,updatedAt:2},bases:[base]},'a');
 assert.equal(remote.get('1').score,220);assert.equal(reviews,1);assert(!badges.includes('Synced just now'));
 remote.set('1',base);await c.syncLocalChange({type:'upsert',game:{...base,score:180,updatedAt:2},bases:[base]},'a');assert.equal(remote.get('1').score,180);
 remote.set('1',base);remote.set('2',{...base,id:2,score:210,updatedAt:9});
 await c.syncLocalChange({type:'batch-upsert',games:[{...base,score:160,updatedAt:2},{...base,id:2,score:170,updatedAt:2}],bases:[base,{...base,id:2}]},'a');assert.equal(remote.get('1').score,150,'Conflicting batch must not partially write');
 remote.set('1',{...base,score:230,updatedAt:7});await c.syncLocalChange({type:'delete',tombstone:{id:1,updatedAt:8},bases:[base]},'a');assert.equal(remote.get('1').score,230);
 await assert.rejects(()=>c.guardedWrites([{ref:'1',data:base}],new Map([[1,base]]),()=>false));
 const requests={},rendered=[];
 const d={currentUser:{uid:'a'},authRevision:1,selectedGroupId:'A',navigator:{onLine:true},firestore:{},console,Date,
 modules:{collection:(_,type,id)=>id,getDocs:ref=>new Promise(resolve=>requests[ref]=resolve)},setLeaderboardStatus(){},renderLeaderboardRows:rows=>rendered.push(rows),friendlyError:String};
 vm.createContext(d);vm.runInContext(section('let leaderboardRequest','function renderLeaderboardRows'),d);
 const first=d.loadLeaderboard();d.selectedGroupId='B';const second=d.loadLeaderboard();requests.B({forEach:f=>f({data:()=>({name:'B'})})});await second;requests.A({forEach:f=>f({data:()=>({name:'A'})})});await first;
 assert.equal(rendered.at(-1)[0].name,'B');assert.equal(rendered.length,1);
 console.log('PASS: stale edits/deletions route to review, matching-base edits sync, conflicting batches do not partially write, account guards, stale leaderboard responses ignored.');
})().catch(e=>{console.error(e);process.exitCode=1});
