const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const harness = fs.readFileSync(path.join(__dirname, 'ui-regression.cjs'), 'utf8').split('(async()=>{')[0]
  .replace('api.test={showView,', 'api.test={clearAllHistory,completedSeriesTotals,startEdit,showView,');
const {c, app, t, $, game, database, events} = vm.runInNewContext(harness + '\n({c,app,t,$,game,database,events});',
  {require, console, __dirname, setTimeout, clearTimeout, URL, structuredClone, queueMicrotask, setImmediate, process});
const cloudSource = fs.readFileSync(path.join(root, 'cloud.js'), 'utf8');
const section = (start, end) => cloudSource.slice(cloudSource.indexOf('  ' + start), cloudSource.indexOf('  ' + end, cloudSource.indexOf('  ' + start)));
const plain = value => JSON.parse(JSON.stringify(value));

(async () => {
  // Series averages use the same filters and original game positions as the other stats.
  const data = [150,180,210,120,150,180].map((score, i) => ({...game(i+1, '2026-09-01', score, i<3?'A':'B'), alley:i<3?'Home':'Away',
    ...(i===1 ? {scoreOnly:true, strikes:null, openFrames:null, strikeOpportunities:null} : {})}));
  let db = database(data); t.setState(db, data); t.resetEntryForm(); t.wireEvents(); app.renderAll();
  assert.equal($('statAverageSeries').textContent, '495.0');
  $('statsAlley').value = 'alley:home'; await $('statsAlley').fire('change');
  assert.equal($('statAverageSeries').textContent, '540.0', 'Alley filter must include mixed score-only/full-detail series');
  $('statsAlley').value = 'alley:away'; await $('statsAlley').fire('change');
  assert.equal($('statAverageSeries').textContent, '450.0');
  $('statsAlley').value = 'none'; await $('statsAlley').fire('change');
  assert.equal($('statAverageSeries').textContent, '—');
  await $('clearStatsFilters').fire('click');
  const gap = [150,300,180,210].map((score,i) => ({...game(i+1,'2026-09-02',score), noTap:i===1}));
  t.setState(database(gap), gap); app.renderAll();
  assert.equal($('statAverageSeries').textContent, '—', 'A no-tap game breaks a consecutive standard series');
  const ballGap = gap.map((g,i) => ({...g, noTap:false, ball:i===1?'Spare':'Concept'}));
  t.setState(database(ballGap), ballGap); app.renderAll();
  $('statsBall').value='ball:concept'; await $('statsBall').fire('change');
  assert.equal($('statAverageSeries').textContent,'—','A filtered-out ball breaks a series');
  await $('clearStatsFilters').fire('click');
  const six = [100,100,100,100,100,250].map((score,i) => game(i+1,'2026-09-02',score));
  t.setState(database(six),six);app.renderAll();
  assert.equal($('statAverageSeries').textContent,'375.0','Completed series are non-overlapping triples');
  assert(events.some(event => event.type === 'bowling:history-rendered'));

  // Reset is one transaction, retains all games on failure, and emits durable deletion bases.
  db=database(data); t.setState(db,data); db.fail=true;
  await t.clearAllHistory();
  assert.equal(db.stores.games.size,6); assert.equal(db.stores.tombstones.size,0);
  assert.equal(app.getGames().length,6); assert($('settingsStatus').textContent.includes('Could not delete'));
  db.fail=false;c.window.confirm=()=>false;await t.clearAllHistory();assert.equal(db.stores.games.size,6);
  c.window.confirm=()=>true;await t.clearAllHistory();
  assert.equal(db.stores.games.size,0);assert.equal(db.stores.tombstones.size,6);
  const deletion=events.filter(event=>event.type==='bowling:data-changed').at(-1).detail;
  assert.equal(deletion.type,'batch-delete');assert.equal(deletion.bases.length,6);
  assert(deletion.tombstones.every((item,i)=>item.updatedAt>data[i].updatedAt));
  const storage=new Map();const outbox={window:c.window,Date,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},setStatus(){}};
  vm.createContext(outbox);vm.runInContext(section('function cloudGamePayload','function normalizedSessionName')+section('function outboxKey','async function flushOutbox'),outbox);
  outbox.queueLocalChange(deletion,'a');
  assert.equal(Object.keys(outbox.readOutbox('a')).length,6);
  assert(outbox.readOutbox('a')[1].data.deleted);assert.equal(outbox.readOutbox('a')[1].base.score,150);

  // Actual profile event handler preserves goal labels after filtered history renders.
  const listeners={};const profileStorage=new Map([['bowling-goal-average:guest','175']]);
  const statusHost={children:[],querySelector(){return this.children[0]},appendChild(child){this.children.push(child)}};
  const row={querySelector:selector=>selector==='.game-actions-toggle'?{dataset:{id:'1'}}:statusHost};
  const list={querySelectorAll:selector=>selector==='.game-row'?[row]:[]};
  const profileContext={console,localStorage:{getItem:key=>profileStorage.get(key)},
    document:{readyState:'loading',addEventListener(){},getElementById:id=>id==='sessionsList'?list:null,createElement:()=>({remove(){statusHost.children=[]}})},
    window:{BowlingApp:{getGames:()=>[game(1,'2026-09-01',180),game(2,'2026-09-01',220)],getLocalScopeInfo:()=>({dbName:'guest'})},
      addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn)}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'profile.js'),'utf8'),profileContext);
  listeners['bowling:history-rendered'][0]();assert.equal(statusHost.children[0].textContent,'Above goal');
  listeners['bowling:history-rendered'][0]();assert.equal(statusHost.children.length,1);
  profileStorage.clear();listeners['bowling:history-rendered'][0]();assert.equal(statusHost.children[0].textContent,'Below average');

  // Failed or cached-missing group reads never remove saved memberships.
  const groupContext={currentUser:{uid:'a'},authRevision:1,profile:{groupIds:['A','B'],activeGroupId:'B'},groups:[{id:'B',name:'Cached'}],selectedGroupId:'B',firestore:{},
    console:{warn(){}},resetLeaderboardView(){},renderGroups(){},renderLeaderboardShell(){},loadLeaderboard:async()=>{},
    modules:{doc:(_,type,id)=>id,getDoc:async id=>{if(id==='B')throw Error('Network unavailable');return{exists:()=>true,data:()=>({name:'First'})}},setDoc(){throw Error('A read must not write memberships')}}};
  vm.createContext(groupContext);vm.runInContext(section('async function loadGroups','function renderGroups'),groupContext);
  await groupContext.loadGroups();assert.deepEqual(plain(groupContext.profile.groupIds),['A','B']);assert.equal(groupContext.selectedGroupId,'B');
  let finish;groupContext.modules.getDoc=()=>new Promise(resolve=>finish=resolve);
  const loading=groupContext.loadGroups();groupContext.currentUser={uid:'b'};groupContext.authRevision++;
  groupContext.profile={groupIds:['C'],activeGroupId:'C'};groupContext.groups=[{id:'C'}];groupContext.selectedGroupId='C';
  finish({exists:()=>true,data:()=>({name:'Old account'})});await loading;
  assert.equal(groupContext.selectedGroupId,'C');assert.deepEqual(plain(groupContext.groups),[{id:'C'}]);

  // Cloud backup reads profile once and does not mix accounts during asynchronous reads.
  const downloads=[], reads=[];const backupContext={currentUser:{uid:'a',email:'a@example.com'},authRevision:1,profile:{},firestore:{},navigator:{onLine:true},
    dom:{downloadCloudBackupBtn:{}},console,setStatus(){},friendlyError:error=>error.message,localDateStamp:()=> '2026-09-24',window:{BowlingApp:{version:8}},
    downloadJson:(_,payload)=>downloads.push(payload),modules:{doc:(_,type,id)=>type+'/'+id,collection:(_,type,id)=>type+'/'+id,
      getDocs:async()=>({forEach:fn=>fn({id:'1',data:()=>data[0]})}),getDoc:async ref=>{reads.push(ref);return {exists:()=>true,data:()=>({displayName:'Matthew',ballInventory:[{name:'Concept',updatedAt:1}],alleyInventory:[{name:'Home',updatedAt:1}]})}}}};
  vm.createContext(backupContext);vm.runInContext(section('async function downloadCloudBackup','async function deleteRefsInChunks'),backupContext);
  await backupContext.downloadCloudBackup();assert.equal(reads.length,1);assert.equal(downloads[0].ballInventory[0].name,'Concept');assert.equal(downloads[0].alleyInventory[0].name,'Home');
  backupContext.modules.getDocs=()=>new Promise(resolve=>finish=resolve);
  const backup=backupContext.downloadCloudBackup();backupContext.currentUser={uid:'b'};backupContext.authRevision++;
  finish({forEach(){}});await backup;assert.equal(downloads.length,1,'No stale account backup may be downloaded');

  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert(html.includes('<select id="strikeOppInput">'));assert(html.includes('<script src="./profile.js" defer>'));
  assert(!fs.readFileSync(path.join(root,'friend-stats.js'),'utf8').includes('MutationObserver'));
  t.clearUndo();console.log('PASS: filtered/non-overlapping series, no-tap and ball gaps, goal labels after history refresh, atomic reset failure/retry, durable bulk deletions, group-read failures/account switches, and single-read isolated cloud backups.');
})().catch(error=>{console.error(error);t.clearUndo();process.exitCode=1});
