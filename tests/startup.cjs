const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=fs.readFileSync(path.join(__dirname,'ui-regression.cjs'),'utf8').split('(async()=>{')[0]
.replace('api.test={showView,','api.test={init,openDatabase,openInitialDatabase,showView,');
const tests=`
(async()=>{
 const saved=game(1,'2026-08-01',175,'Legacy league name');
 const databases=new Map();let openFailure=false;
 function persistentDb(initial=[]){const d=database(initial);d.close=()=>{};d.objectStoreNames={contains:name=>Object.hasOwn(d.stores,name)};return d;}
 const index={open(name){const request={};setImmediate(()=>{if(openFailure){request.error=new Error('Simulated storage failure');request.onerror?.();return;}if(!databases.has(name))databases.set(name,persistentDb());request.result=databases.get(name);request.onsuccess?.();});return request;}};
 c.indexedDB=index;c.window.indexedDB=index;
 databases.set('bowling-tracker-db-user-a',persistentDb([saved]));storage.set('bowling-tracker-last-account-uid','a');
 await t.init();assert.equal(app.ready,true,'Startup should complete with existing data');assert.equal(app.getGames().length,1);assert.equal(app.getGames()[0].sessionName,'Legacy league name');assert.equal(app.getGames()[0].ball,undefined,'Opening must not rewrite old games');
 assert(events.some(e=>e.type==='bowling:ready' && e.detail.ok));
 // Data arriving from Firebase is applied after the database becomes ready.
 await app.applyRemoteChanges({expectedUid:'a',upserts:[{...game(2,'2026-08-02',185),ball:'Ball A',sessionType:'Practice'}]});assert.equal(app.getGames().length,2);
 await app.activateGuest();assert.equal(app.getGames().length,0);await app.activateAccount('a');assert.equal(app.getGames().length,2);
 openFailure=true;await assert.rejects(()=>t.openDatabase('failed'),/Simulated storage failure/);
 console.log('PASS: complete startup opens existing account database, preserves legacy fields, accepts cloud downloads, switches accounts, and reports database open failures.');
})().catch(e=>{console.error(e);process.exitCode=1});`;
vm.runInNewContext(harness+tests,{require,console,__dirname,setTimeout,clearTimeout,URL,structuredClone,queueMicrotask,setImmediate,process});
const cloud=fs.readFileSync(path.join(__dirname,'../cloud.js'),'utf8');
const gate=cloud.slice(cloud.indexOf('  function waitForBowlingApp()'),cloud.indexOf('  async function loadFirebaseModules()'));
(async()=>{
 const assert=require('assert');let listener;
 const c={window:{BowlingApp:{ready:false,startupError:'tx is not defined'},addEventListener:(_,fn)=>listener=fn}};
 vm.createContext(c);vm.runInContext(gate,c);
 await assert.rejects(()=>c.waitForBowlingApp(),/startup failed/);
 c.window.BowlingApp.startupError=null;const pending=c.waitForBowlingApp();listener({detail:{ok:false}});await assert.rejects(()=>pending,/storage is unavailable/);
 c.window.BowlingApp.ready=true;assert.equal(await c.waitForBowlingApp(),c.window.BowlingApp);
 console.log('PASS: Firebase startup gate rejects failed initialization instead of hanging or accepting an unusable database.');
})().catch(error=>{console.error(error);process.exitCode=1});
