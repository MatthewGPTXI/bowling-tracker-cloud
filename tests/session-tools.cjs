const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname,'..');
const harness = fs.readFileSync(path.join(__dirname,'ui-regression.cjs'),'utf8').split('(async()=>{')[0]
 .replace('api.test={showView,','api.test={normalizeGame,sessionType,sessionKey,buildSessions,statsGames,periodComparison,renderComparison,moveGame,persistDrafts,readDraft,recoverDraft,clearDraft,showDraftNotice,saveGameFromForm,startEdit,changeSessionMode,buildImportPlan,importBackupFile,confirmImport,csvEscape,renderHome,showView,');
const scenarios = `
(async()=>{
 const old=game(1,'2026-09-06',160,'Old league title');
 const second=game(2,'2026-09-06',180,'Other title');
 let db=database([old,second]);t.setState(db,[old,second]);t.resetEntryForm();t.wireEvents();
 assert.equal(t.normalizeGame(old).sessionType,'League');
 assert.equal(t.buildSessions([old,second]).length,2,'Legacy names must preserve separate sessions');
 t.renderHome();assert.equal($('continueLatestBtn').dataset.key,'2026-09-06|||other title');
 $('sessionMode').value='new';t.changeSessionMode();const key=$('sessionNameInput').value;
 t.changeSessionMode();assert.notEqual($('sessionNameInput').value,key,'Separate new sessions need separate IDs');
 t.startEdit(1);$('sessionTypeInput').value='Practice';await t.saveGameFromForm();
 assert.equal(db.stores.games.get(1).sessionType,'Practice');assert.equal(db.stores.games.get(1).sessionName,'Old league title');
 assert.equal(db.stores.games.get(1).createdAt,old.createdAt);
 t.resetEntryForm();$('scoreInput').value='192';$('notesInput').value='Recover this';t.persistDrafts();
 assert(t.readDraft('entry')); const savedKey=[...storage.keys()].find(k=>k.endsWith(':entry'));
 t.setState(database(),[]); // scope setter remains account a; simulate form reset without clearing storage
 $('scoreInput').value='';$('notesInput').value='';t.recoverDraft('entry');
 assert.equal($('scoreInput').value,'192');assert.equal($('notesInput').value,'Recover this');assert(t.hasEntryDraft());
 t.clearDraft('entry');assert(!storage.has(savedKey));
 t.resetEntryForm();t.openSeriesEntry();$('seriesRows').children[0].fields.score.value='210';$('seriesType').value='Tournament';t.persistDrafts();
 $('seriesDialog').close();$('seriesRows').innerHTML='';t.recoverDraft('series');
 assert.equal($('seriesRows').children.length,3);assert.equal($('seriesRows').children[0].fields.score.value,'210');assert.equal($('seriesType').value,'Tournament');
 t.clearDraft('series');$('seriesDialog').close();
 const data=[game(10,'2026-08-30',100),game(11,'2026-08-31',140),game(12,'2026-09-01',180),{...game(13,'2026-09-02',200),sessionType:'Practice'}];
 db=database(data);t.setState(db,data);$('statsFrom').value='2026-09-01';$('statsTo').value='2026-09-02';$('statsType').value='';
 const comparison=t.periodComparison();assert.equal(comparison.previousFrom,'2026-08-30');assert.equal(comparison.previousTo,'2026-08-31');assert.equal(comparison.current.average,190);assert.equal(comparison.previous.average,120);t.renderComparison();
 $('statsType').value='League';assert.equal(t.statsGames().length,1);$('statsFrom').value='2026-09-03';assert.equal(t.periodComparison(),null);
 const series=[game(20,'2026-09-01',100),game(21,'2026-09-01',200),game(22,'2026-09-01',250),game(23,'2026-09-01',300)];series[3].strikes=12;series[3].strikeOpportunities=12;
 db=database(series);t.setState(db,series);await t.moveGame(23,-1);
 assert.deepEqual(Array.from(t.buildSessions(app.getGames())[0].games,g=>g.id),[20,21,23,22]);
 assert.equal(t.calculateStats(app.getGames()).bestSeries.total,750);
 db.fail=true;await t.moveGame(23,-1);assert.equal(db.stores.games.get(23).gameOrder,3);db.fail=false;
 const rows=t.buildImportPlan([t.normalizeGame(series[0]),{...series[1],score:199},game(50,'2026-09-01',140)],[],series,[]);
 assert.deepEqual(Array.from(rows,r=>r.kind),['duplicate','conflict','addition']);
 assert.equal(t.buildImportPlan([series[0]],[],[],[{id:20,updatedAt:100}])[0].kind,'conflict');
 assert.equal(t.buildImportPlan([], [{id:20,updatedAt:100}], series,[])[0].kind,'conflict');
 await t.importBackupFile({text:async()=>JSON.stringify({games:[game(100,'2026-09-02',170)]})});
 assert(!db.stores.games.has(100),'Preview must not write');await t.confirmImport();assert(db.stores.games.has(100));
 await t.importBackupFile({text:async()=>JSON.stringify({games:[game(101,'2026-09-02',171)]})});
 db.stores.games.set(102,game(102,'2026-09-03',190));await t.confirmImport();assert(!db.stores.games.has(101),'Stale preview must not apply');
 assert.equal(t.csvEscape('=SUM(A1:A2)'),"'=SUM(A1:A2)");assert.equal(t.csvEscape('one,two'),'"one,two"');
 t.clearUndo();console.log('PASS: legacy grouping/type fallback, editable types, same-date latest session, unique new sessions, recoverable game/series drafts, inclusive period comparison, type filters, atomic game ordering, import classification/preview/stale review protection, CSV escaping.');
})().catch(e=>{console.error(e);t.clearUndo();process.exitCode=1});`;
vm.runInNewContext(harness+scenarios,{require,console,__dirname,setTimeout,clearTimeout,URL,structuredClone,queueMicrotask,setImmediate,process});
