const fs=require('fs'),path=require('path'),vm=require('vm');
const harness=fs.readFileSync(path.join(__dirname,'ui-regression.cjs'),'utf8').split('(async()=>{')[0]
.replace('api.test={showView,','api.test={ballNames,canonicalBall,matchesBall,renderBallOptions,statsGames,periodComparison,applySeriesBall,normalizeGame,saveGameFromForm,startEdit,persistDrafts,recoverDraft,readDraft,clearDraft,exportCsv,showView,');
const tests=`
(async()=>{
 const first={...game(1,'2026-09-01',150),ball:'Storm Phaze II'};
 const other={...game(2,'2026-09-02',200),ball:'storm   phaze ii'};
 const spare=game(3,'2026-09-02',100);
 const db=database([first,other,spare]);t.setState(db,[first,other,spare]);t.resetEntryForm();t.wireEvents();app.renderAll();
 assert.equal(t.ballNames().length,1);assert.equal(t.canonicalBall(' storm  phaze II '),'Storm Phaze II');
 $('statsBall').value='ball:storm phaze ii';assert.equal(t.statsGames().length,2);$('statsBall').value='none';assert.equal(t.statsGames().length,1);$('statsBall').value='';
 t.startEdit(3);$('ballInput').value='Venom Shock';await t.saveGameFromForm();assert.equal(db.stores.games.get(3).ball,'Venom Shock');assert.equal(db.stores.games.get(1).ball,'Storm Phaze II','Ball is game-specific');
 t.startEdit(3);$('ballInput').value='';await t.saveGameFromForm();assert.equal(db.stores.games.get(3).ball,'');
 t.resetEntryForm();$('ballInput').value='Draft Ball';t.persistDrafts();$('ballInput').value='';t.recoverDraft('entry');assert.equal($('ballInput').value,'Draft Ball');t.clearDraft('entry');
 t.resetEntryForm();t.openSeriesEntry();$('seriesBall').value='Series Ball';t.applySeriesBall();assert([...$('seriesRows').children].every(row=>row.fields.ball.value==='Series Ball'));
 $('seriesRows').children[1].fields.ball.value='Other Ball';t.persistDrafts();$('seriesDialog').close();t.recoverDraft('series');assert.equal($('seriesRows').children[1].fields.ball.value,'Other Ball');
 for(const row of $('seriesRows').children){row.fields.score.value='170';row.fields.openFrames.value='3';row.fields.strikes.value='4';}
 await t.saveSeries(submit);assert.equal(app.getGames().filter(g=>g.ball==='Series Ball').length,2);assert.equal(app.getGames().filter(g=>g.ball==='Other Ball').length,1);
 const data=[{...game(11,'2026-08-31',120),ball:'A'},{...game(12,'2026-09-01',180),ball:'A'},{...game(13,'2026-09-01',300),strikes:12,strikeOpportunities:12,ball:'B'}];
 t.setState(database(data),data);$('statsBall').value='ball:a';$('statsFrom').value='2026-09-01';$('statsTo').value='2026-09-01';const comparison=t.periodComparison();assert.equal(comparison.current.average,180);assert.equal(comparison.previous.average,120);
 const sequence=[1,2,3,4].map((id,i)=>({...game(id,'2026-09-02',150+i),ball:i===1?'B':'A'}));t.setState(database(sequence),sequence);$('statsBall').value='ball:a';$('statsFrom').value='';$('statsTo').value='';assert.equal(t.calculateStats(t.statsGames()).bestSeries,null,'A different-ball game must not be skipped to create a consecutive series');
 assert.equal(t.normalizeGame(spare).ball,'');assert(!t.isValidGame({...spare,ball:{bad:true}}));assert(!t.isValidGame({...spare,ball:'x'.repeat(101)}));
 t.setState(database(),[]);assert.equal(t.ballNames().length,0,'Ball options must follow active account games');
 t.clearUndo();console.log('PASS: reusable/case-normalized balls, per-game editing/clearing, game and series drafts, series-wide apply and per-game override, ball/date comparisons, true consecutive series, legacy defaults, validation and account-scoped suggestions.');
})().catch(e=>{console.error(e);t.clearUndo();process.exitCode=1});`;
vm.runInNewContext(harness+tests,{require,console,__dirname,setTimeout,clearTimeout,URL,structuredClone,queueMicrotask,setImmediate,process});
