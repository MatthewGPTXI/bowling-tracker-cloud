const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=fs.readFileSync(path.join(__dirname,'ui-regression.cjs'),'utf8').split('(async()=>{')[0]
.replace('api.test={showView,','api.test={loadBallInventory,startEdit,recoverDraft,persistDrafts,readDraft,showView,');
const tests=`
(async()=>{
 const original={...game(1,'2026-09-01',180),ball:'Storm Concept'};
 const db=database([original]); t.setState(db,[original]); app.ready=true;
 t.resetEntryForm(); t.wireEvents(); await t.loadBallInventory();
 const active=()=>app.getBallInventory().filter(row=>!row.removed).map(row=>row.name);
 assert.deepEqual([...active()],['Storm Concept']);
 assert.equal(db.stores.settings.get('ballInventory').value[0].name,'Storm Concept','Legacy tags are persisted independently of games');
 await app.editBallInventory('  Spare   Ball  '); assert(active().includes('Spare Ball'));
 await assert.rejects(()=>app.editBallInventory('spare ball'),/already/);
 await assert.rejects(()=>app.editBallInventory('  '),/Enter a ball/);
 await assert.rejects(()=>app.editBallInventory('x'.repeat(101)),/100/);
 await app.editBallInventory('Concept Solid','Storm Concept');
 assert(!active().includes('Storm Concept')); assert(active().includes('Concept Solid'));
 assert.equal(app.getGames()[0].ball,'Storm Concept'); assert.equal(db.stores.games.get(1).ball,'Storm Concept');
 await app.mergeBallInventory([{name:'Storm Concept',updatedAt:0}], 'a');
 assert(!active().includes('Storm Concept'),'Old device/legacy tags cannot resurrect a removed name');
 await app.editBallInventory('Concept Solid','',true); assert(!active().includes('Concept Solid'));
 await app.editBallInventory('Concept Solid'); assert(active().includes('Concept Solid'),'Explicit re-add works');
 const before=JSON.stringify(app.getBallInventory()); db.fail=true;
 await assert.rejects(()=>app.editBallInventory('Failed save'),/Simulated/); db.fail=false;
 assert.equal(JSON.stringify(app.getBallInventory()),before,'A failed write leaves the inventory unchanged');
 assert.equal(await app.mergeBallInventory([{name:'Wrong account',updatedAt:1}], 'b'),false);
 assert(!active().includes('Wrong account'));
 const other=database(); t.setState(other,[]); await t.loadBallInventory(); assert.equal(active().length,0);
 await app.editBallInventory('Other account ball'); t.setState(db,[original]); await t.loadBallInventory();
 assert(active().includes('Spare Ball')); assert(!active().includes('Other account ball'));
 // Legacy single-ball drafts may reference a ball removed from today's inventory.
 t.resetEntryForm(); $('scoreInput').value='180'; $('ballInput').value='Retired ball'; t.persistDrafts();
 const draft=t.readDraft('entry'); draft.values=draft.values.slice(0,10);
 storage.set('bowling-draft:a:entry',JSON.stringify(draft)); $('ballInput').value='';
 t.recoverDraft('entry'); assert.equal($('ballInput').value,'Retired ball');
 const Balls=c.window.BowlingBalls;
 const a=[{name:'A',updatedAt:2},{name:'B',updatedAt:3,removed:true}];
 const b=[{name:'B',updatedAt:1},{name:'C',updatedAt:4}];
 assert.deepEqual(Balls.mergeInventory(a,b),Balls.mergeInventory(b,a));
 assert.equal(Balls.mergeInventory(a,b).find(x=>x.name==='B').removed,true);
 assert.equal(Balls.mergeInventory([{name:'A',updatedAt:2}],[{name:'a',updatedAt:2,removed:true}])[0].removed,true);
 t.clearUndo(); console.log('PASS: inventory migration, validation, rename/remove/re-add, historical records, storage failures, account isolation, legacy drafts, deterministic offline merge and removal protection.');
})().catch(e=>{console.error(e);process.exitCode=1});`;
vm.runInNewContext(harness+tests,{require,console,__dirname,setTimeout,clearTimeout,URL,structuredClone,queueMicrotask,setImmediate,process});
