const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=fs.readFileSync(path.join(__dirname,'ui-regression.cjs'),'utf8').split('(async()=>{')[0]
.replace('api.test={showView,','api.test={loadAlleyInventory,buildSessions,statsGames,periodComparison,startEdit,saveGameFromForm,normalizeGame,persistDrafts,recoverDraft,readDraft,clearDraft,exportBackup,exportCsv,importBackupFile,confirmImport,setDownload(fn){downloadFile=fn;},showView,');
const tests=`
(async()=>{
 const original={...game(1,'2026-09-01',180),alley:'Local Lanes'};
 const other={...game(2,'2026-09-02',160),alley:'Other Lanes'};
 const db=database([original,other]);t.setState(db,[original,other]);app.ready=true;t.resetEntryForm();t.wireEvents();await t.loadAlleyInventory();
 const active=()=>app.getAlleyInventory().filter(row=>!row.removed).map(row=>row.name);
 assert(active().includes('Local Lanes'));await app.editAlleyInventory('  Bowl   Center  ');assert(active().includes('Bowl Center'));
 await assert.rejects(()=>app.editAlleyInventory('bowl center'),/already/);await assert.rejects(()=>app.editAlleyInventory(' '),/Enter an alley/);
 await assert.rejects(()=>app.editAlleyInventory('x'.repeat(101)),/100/);
 await app.editAlleyInventory('New Lanes','Local Lanes');assert(!active().includes('Local Lanes'));assert.equal(db.stores.games.get(1).alley,'Local Lanes');
 await app.mergeAlleyInventory([{name:'Local Lanes',updatedAt:0}],'a');assert(!active().includes('Local Lanes'));
 await app.editAlleyInventory('New Lanes','',true);assert(!active().includes('New Lanes'));await app.editAlleyInventory('New Lanes');assert(active().includes('New Lanes'));
 db.fail=true;await assert.rejects(()=>app.editAlleyInventory('Failed save'),/Simulated/);db.fail=false;assert(!active().includes('Failed save'));
 assert.equal(await app.mergeAlleyInventory([{name:'Wrong account',updatedAt:1}],'b'),false);
 const otherDb=database();t.setState(otherDb,[]);await t.loadAlleyInventory();assert.equal(active().length,0);await app.editAlleyInventory('Private alley');
 t.setState(db,[original,other]);await t.loadAlleyInventory();assert(!active().includes('Private alley'));
 t.startEdit(1);assert.equal($('alleyInput').value,'Local Lanes');$('alleyInput').value='Bowl Center';await t.saveGameFromForm();assert.equal(db.stores.games.get(1).alley,'Bowl Center');assert.equal(db.stores.games.get(2).alley,'Other Lanes');
 $('statsAlley').value='alley:bowl center';await $('statsAlley').fire('change');assert.equal(t.statsGames().length,1);assert.equal($('statAverage').textContent,'180.0');
 assert($('statHighGameDetail').textContent.includes('Bowl Center'));$('statsAlley').value='';
 $('sessionSearch').value='BOWL CENTER';assert.equal(t.matchingSessions(t.buildSessions(app.getGames())).length,1);$('sessionSearch').value='';
 t.resetEntryForm();$('alleyInput').value='Draft Alley';t.persistDrafts();$('alleyInput').value='';t.recoverDraft('entry');assert.equal($('alleyInput').value,'Draft Alley');t.clearDraft('entry');
 // Old drafts must not shift the ball/scoring fields or invent a location.
 t.resetEntryForm();$('scoreInput').value='180';t.persistDrafts();const old=t.readDraft('entry');old.values=old.values.slice(0,12);storage.set('bowling-draft:a:entry',JSON.stringify(old));$('alleyInput').value='Leaked';t.recoverDraft('entry');assert.equal($('alleyInput').value,'');t.clearDraft('entry');
 t.resetEntryForm();t.openSeriesEntry();$('seriesAlley').value='Series Lanes';t.persistDrafts();$('seriesDialog').close();t.recoverDraft('series');assert.equal($('seriesAlley').value,'Series Lanes');
 for(const row of $('seriesRows').children){row.fields.score.value='170';row.fields.openFrames.value='3';row.fields.strikes.value='4';}
 await t.saveSeries(submit);assert.equal(app.getGames().filter(g=>g.alley==='Series Lanes').length,3);
 const downloads=[];t.setDownload((name,contents)=>downloads.push({name,contents}));await t.exportBackup();const backup=JSON.parse(downloads.at(-1).contents);assert(backup.alleyInventory.length);assert(backup.games.some(g=>g.alley==='Series Lanes'));
 t.exportCsv();assert(downloads.at(-1).contents.includes('Alley'));assert(downloads.at(-1).contents.includes('Series Lanes'));
 await t.importBackupFile({text:async()=>JSON.stringify({games:[],alleyInventory:[{name:'Backup Lanes',updatedAt:10}]})});await t.confirmImport();assert(active().includes('Backup Lanes'));
 const current=app.getGames()[0];await app.applyRemoteChanges({expectedUid:'a',upserts:[{...current,alley:'Remote Lanes',updatedAt:Date.now()+100}]});assert.equal(app.getGames().find(g=>g.id===current.id).alley,'Remote Lanes');
 assert.equal(t.normalizeGame(game(50,'2026-09-01',170)).alley,'');assert(!t.isValidGame({...original,alley:{bad:true}}));assert(!t.isValidGame({...original,alley:'x'.repeat(101)}));
 const history=[{...game(11,'2026-08-31',120),alley:'A'},{...game(12,'2026-09-01',180),alley:'A'},{...game(13,'2026-09-01',150),alley:'B'},{...game(14,'2026-09-01',250),alley:'A',noTap:true}];
 t.setState(database(history),history);$('statsAlley').value='alley:a';$('statsFrom').value='2026-09-01';$('statsTo').value='2026-09-01';const comparison=t.periodComparison();assert.equal(comparison.current.average,180);assert.equal(comparison.previous.average,120);
 t.clearUndo();console.log('PASS: alley lifecycle, history preservation, failed writes, account isolation, game edits, search/stats/date/no-tap filtering, legacy and new drafts, series tagging, JSON/CSV/import and cloud downloads.');
})().catch(e=>{console.error(e);process.exitCode=1});`;
vm.runInNewContext(harness+tests,{require,console,__dirname,setTimeout,clearTimeout,URL,structuredClone,queueMicrotask,setImmediate,process});
