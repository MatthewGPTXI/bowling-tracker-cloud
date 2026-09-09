const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const all = new Map();
function element(id='') {
 const classes = new Set();
 const e={id,value:'',textContent:'',dataset:{},hidden:false,open:false,children:[],listeners:{},attributes:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,yes)=>yes===undefined?(classes.has(x)?classes.delete(x):classes.add(x)):(yes?classes.add(x):classes.delete(x))},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)},async fire(type,event={}){for(const fn of this.listeners[type]||[])await fn({target:this,preventDefault(){},...event})},focus(){this.focused=true},scrollIntoView(){},removeAttribute(name){delete this.attributes[name]},setAttribute(name,v){this.attributes[name]=v},close(){this.open=false},showModal(){this.open=true},appendChild(child){this.children.push(child);child.parent=this},remove(){this.parent.children=this.parent.children.filter(x=>x!==this)},querySelector(sel){if(sel==='legend')return this.legend??=element();if(sel==='.remove-series-row')return this.removeBtn??=element();if((sel==='input' || sel==='input, select'))return Object.values(this.fields||{})[0];return this.fields?.[sel.match(/data-field="(\w+)"/)?.[1]]},querySelectorAll(sel){if((sel==='input' || sel==='input, select')){if(this.fields)return Object.values(this.fields);return this.children.flatMap(c=>c.querySelectorAll(sel));}if(sel==='[data-field="score"]')return this.children.map(c=>c.fields.score);return []}};
 let html='';Object.defineProperty(e,'innerHTML',{get:()=>html,set(v){html=v;e.children=[];if(v.includes('data-field="score"')){e.fields={};for(const field of ['score','openFrames','strikes','strikeOpp','notes','ball']){e.fields[field]=element();e.fields[field].value=field==='strikeOpp'?'10':'';}}}});const query=e.querySelector.bind(e);e.querySelector=sel=>{if(/^\[data-ball-(editor|first|advanced)\]$/.test(sel)){e.ballControls??={};return e.ballControls[sel]??=element();}return query(sel);};return e;
}
const $=id=>{if(!all.has(id))all.set(id,element(id));return all.get(id)};
const pages=['home','sessions','stats','friends'].map(v=>$('view-'+v));
const nav=['home','sessions','stats','friends'].map(v=>{const e=$('nav-'+v);e.dataset.goView=v;return e});
const dialogs=['seriesDialog','editSessionDialog'];
$('seriesDialog').querySelectorAll=()=>[$('seriesDate'),$('seriesName'),$('seriesType'),$('seriesBall'),$('seriesNoTap'),...$('seriesRows').querySelectorAll('input')];
$('editSessionDialog').querySelectorAll=()=>[$('editSessionDate'),$('editSessionName')];
const events=[]; const storage=new Map();
const c={console,Date,Math,Map,Set,Promise,structuredClone,setTimeout,clearTimeout,URL,CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},document:{addEventListener(){},getElementById:$,createElement:()=>element(),querySelector:()=>element(),querySelectorAll:sel=>sel==='.app-view'?pages:sel.includes('data-go-view')?nav:[]},navigator:{onLine:true},window:{confirm:()=>true,dispatchEvent:e=>events.push(e),addEventListener(){},scrollTo(){}}};
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
c.window.BowlingBalls=require(path.join(root,'balls.js'));
vm.createContext(c);vm.runInContext(source.replace('  init();',`api.test={showView,matchingSessions,renderHistory,rememberEntry,hasEntryDraft,closeEntryDialog,openSeriesEntry,updateSeriesPreview,saveSeries,saveSessionEdit,openSessionEditor,confirmDelete,undoLastDeletion,clearUndo,progressStats,calculateStats,isValidGame,isValidDate,commitGames,wireEvents,resetEntryForm,addToSession,setState(database,data){db=database;games=data;dialogScope=database;activeLocalScope={kind:'user',uid:'a'};}};`),c);
const app=c.window.BowlingApp,t=app.test;
function database(initial=[]){const stores={games:new Map(initial.map(g=>[g.id,g])),tombstones:new Map(),settings:new Map()};return {stores,fail:false,transaction(names,mode){const database=this,writable=mode==='readwrite',drafts=Object.fromEntries(Object.entries(stores).map(([k,v])=>[k,new Map(v)]));const tx={objectStore(name){const map=writable?drafts[name]:stores[name];const request=result=>{const r={result};queueMicrotask(()=>r.onsuccess?.());return r};return {put(v){map.set(v.id??v.key,structuredClone(v));return request(v)},delete(id){map.delete(id);return request()},get(id){return request(map.get(id))},getAll(){return request([...map.values()])}}}};setImmediate(()=>{if(writable&&database.fail){tx.error=new Error('Simulated failure');tx.onabort?.()}else{if(writable)Object.assign(stores,drafts);tx.oncomplete?.()}});return tx}}}
const game=(id,date,score,name='League')=>({id,date,score,sessionName:name,bowler:'Matthew',openFrames:3,strikes:4,strikeOpportunities:10,notes:'Keep notes',createdAt:id,updatedAt:id});
const submit={preventDefault(){}};
(async()=>{
 const data=Array.from({length:16},(_,i)=>game(i+1,`2026-08-${String(i+1).padStart(2,'0')}`,150+i));
 const db=database(data);t.setState(db,data);t.resetEntryForm();t.wireEvents();app.renderAll();
 assert(!$('view-home').hidden);assert($('view-stats').hidden);
 $('scoreInput').value='175';assert(t.hasEntryDraft());await $('nav-sessions').fire('click');assert($('view-home').hidden);assert(!$('view-sessions').hidden);assert.equal($('scoreInput').value,'175');
 assert.equal($('nav-sessions').attributes['aria-current'],'page');assert.equal($('nav-home').attributes['aria-current'],undefined);
 assert($('historyResultCount').textContent.includes('10 of 16'));assert.equal(($('sessionsList').innerHTML.match(/<details/g)||[]).length,10);assert.equal(($('sessionsList').innerHTML.match(/ open>/g)||[]).length,1);
 await $('showMoreSessions').fire('click');assert($('historyResultCount').textContent.includes('16 of 16'));
 $('sessionSearch').value='LEAGUE';$('sessionFrom').value='2026-08-05';$('sessionTo').value='2026-08-07';await $('sessionSearch').fire('input');assert($('historyResultCount').textContent.includes('3 of 3'));
 $('sessionSearch').value='missing';await $('sessionSearch').fire('input');assert(!$('noSessionMatches').classList.contains('hidden'));assert.equal($('sessionsList').innerHTML,'');await $('clearSessionFilters').fire('click');assert($('historyResultCount').textContent.includes('10 of 16'));
 c.window.confirm=()=>false;t.addToSession('2026-08-16|||league');assert.equal($('scoreInput').value,'175');assert($('view-home').hidden);
 c.window.confirm=()=>true;t.addToSession('2026-08-16|||league');assert(!$('view-home').hidden);assert.equal($('dateInput').value,'2026-08-16');assert.equal($('scoreInput').value,'');assert(!t.hasEntryDraft());
 t.openSeriesEntry();assert.equal($('seriesRows').children.length,3);const rows=$('seriesRows').children;
 rows[0].fields.score.value='160';t.updateSeriesPreview();assert($('seriesPreview').textContent.includes('1/3'));assert($('seriesPreview').textContent.includes('Total 160'));
 c.window.confirm=()=>false;assert.equal(t.closeEntryDialog('seriesDialog'),false);assert($('seriesDialog').open);c.window.confirm=()=>true;
 for (const [i,row] of rows.entries()){row.fields.score.value=String(160+i*10);row.fields.openFrames.value='3';row.fields.strikes.value='4';}
 await t.saveSeries(submit);assert.equal(db.stores.games.size,19);assert(!$('seriesDialog').open);assert.equal(app.getGames().filter(g=>g.date==='2026-08-16').length,4);assert(!t.hasEntryDraft());
 t.openSeriesEntry();for(const row of $('seriesRows').children){row.fields.score.value='180';row.fields.openFrames.value='3';row.fields.strikes.value='4';}db.fail=true;await t.saveSeries(submit);assert.equal(db.stores.games.size,19);db.fail=false;$('seriesDialog').close();
 t.openSessionEditor('2026-08-16|||league');$('editSessionType').value='Practice';await t.saveSessionEdit(submit);assert.equal(app.getGames().filter(g=>g.sessionType==='Practice').length,4);
 const saved=app.getGames()[0];await t.confirmDelete(saved.id);assert(!db.stores.games.has(saved.id));await t.undoLastDeletion();assert(db.stores.games.has(saved.id));assert(!db.stores.tombstones.has(saved.id));
 const otherDb=database();await t.confirmDelete(saved.id);t.setState(otherDb,[]);await t.undoLastDeletion();assert.equal(otherDb.stores.games.size,0);t.clearUndo();
 const historical=Array.from({length:6},(_,i)=>game(i+1,`2026-09-0${i+1}`,150));historical.push(game(999,'2026-08-01',50));assert.equal(t.calculateStats(historical).last5,150);assert.equal(t.progressStats(historical).last10.count,7);
 assert(!t.isValidDate('2026-02-31'));assert(t.isValidDate('2024-02-29'));assert(!t.isValidGame({...saved,strikeOpportunities:'oops'}));
 console.log('PASS: page navigation, draft retention, selected-nav accessibility state, pagination, collapsed history markup, inclusive filters, clear/no-results flow, discard cancellation, session entry shortcut, series preview and saving, atomic rollback, session edits, undo/account isolation, backdated averages, invalid imports.');
})().catch(e=>{console.error(e);t.clearUndo();process.exitCode=1});
