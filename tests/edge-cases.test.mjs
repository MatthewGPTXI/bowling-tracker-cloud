import assert from 'node:assert/strict';
import {isValidDate, isValidGame, normalizeGame} from '../modules/games.js';
import {calculateStats, completedSeriesTotals, bestThreeGameSeries} from '../modules/statistics.js';
import {buildSessions} from '../modules/sessions.js';
import {cloudGamePayload} from '../modules/reconciliation.js';
import {csvEscape} from '../modules/backup.js';

// Deterministic, reproducible data-driven tests. No network, accounts, or mutable production data.
let seed = Number(process.env.BOWLING_TEST_SEED || 0x5eeda11) >>> 0;
const initialSeed = seed;
const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed; };
const pick = max => random() % max;
const base = {id:1,date:'2026-11-03',bowler:'Test bowler',sessionName:'League',sessionId:'test-session',
  sessionType:'League',score:158,openFrames:4,strikes:4,strikeOpportunities:10,
  createdAt:1,updatedAt:1,gameOrder:1};
const valid = value => assert.equal(isValidGame(value), true, JSON.stringify(value).slice(0,250));
const invalid = value => assert.equal(isValidGame(value), false, JSON.stringify(value).slice(0,250));

valid(base);
valid({...base,scoreOnly:true,score:0,openFrames:null,strikes:null,strikeOpportunities:null});
valid({...base,score:300,strikes:12,strikeOpportunities:12,openFrames:0});
valid({...base,notes:'x'.repeat(100000)});
invalid({...base,notes:'x'.repeat(100001)});
for (const notes of [null,{},[],42,true]) invalid({...base,notes});
// Data from an imported JSON backup must not use JS coercion to silently convert booleans
// or arrays to scores, strikes, timestamps or ordering fields.
for (const field of ['score','openFrames','strikes','strikeOpportunities','createdAt','updatedAt','gameOrder','schemaVersion']) {
  for (const replacement of [true,false,[1],[2],{valueOf:()=>2,toString:()=> '2'}]) {
    invalid({...base,[field]:replacement});
  }
}
for (const [date, expected] of [
  ['2024-02-29',true],['2026-02-29',false],['2026-04-31',false],
  ['2026-12-31',true],['0000-01-01',false],['2026-13-01',false],
  ['2026-11-3',false],['2026-00-01',false],['junk',false]
]) assert.equal(isValidDate(date),expected,date);
for (const raw of ['=1+1',' +2','\t=1+1','\r@sum','\uFEFF-2']) {
  const escaped = csvEscape(raw);
  assert(escaped.startsWith("'") || escaped.startsWith('"\''), 'Potential CSV formula must be neutralized: '+JSON.stringify(raw));
}
assert.equal(csvEscape('normal text'),'normal text');

const variants = [
  {score:100,openFrames:5,strikes:1,strikeOpportunities:10},
  {score:150,openFrames:3,strikes:4,strikeOpportunities:10},
  {score:180,openFrames:2,strikes:5,strikeOpportunities:11},
  {score:220,openFrames:1,strikes:7,strikeOpportunities:11},
  {score:300,openFrames:0,strikes:12,strikeOpportunities:12}
];
let scenarios=0, gamesGenerated=0;
const almost = (a,b,label) => assert(Math.abs(a-b)<1e-9,label+': '+a+' vs '+b);
for(let scenario=0;scenario<1600;scenario++){
  const all=[];
  const sessions=1+pick(9);
  for(let s=0;s<sessions;s++){
    const count=1+pick(9);
    for(let n=0;n<count;n++){
      const variant=variants[pick(variants.length)];
      const scoreOnly=pick(4)===0, noTap=pick(6)===0;
      all.push({...base,...variant,id:scenario*1000+s*20+n+1,
        sessionId:'scenario-'+scenario+'-session-'+s,
        date:'2026-11-'+String(1+s).padStart(2,'0'),
        createdAt:1000+s*100+n,updatedAt:1000+s*100+n,gameOrder:n+1,
        scoreOnly,noTap,
        ...(scoreOnly?{score:pick(301),openFrames:null,strikes:null,strikeOpportunities:null}:{})});
    }
  }
  const selected=all.filter(()=>pick(3)!==0);
  const before=JSON.stringify(all);
  for(const game of all){
    valid(game);
    const normalized=normalizeGame(game);
    assert.deepEqual(normalizeGame(normalized),normalized,'Normalization must be idempotent');
    assert.equal(cloudGamePayload(normalized).score,normalized.score);
  }
  const chosen=new Set(selected.filter(game=>!game.noTap).map(game=>game.id));
  const included=all.filter(game=>chosen.has(game.id));
  const detail=included.filter(game=>!game.scoreOnly);
  const expectedTotal=included.reduce((sum,g)=>sum+g.score,0);
  const expectedStrikes=detail.reduce((sum,g)=>sum+g.strikes,0);
  const expectedOpps=detail.reduce((sum,g)=>sum+g.strikeOpportunities,0);
  const expectedOpens=detail.reduce((sum,g)=>sum+g.openFrames,0);
  const stats=calculateStats(selected,all);
  assert.equal(stats.count,included.length);
  assert.equal(stats.frameCount,detail.length);
  assert.equal(stats.average,included.length?expectedTotal/included.length:0);
  assert.equal(stats.totalStrikes,expectedStrikes);
  assert.equal(stats.totalClosed,detail.length*10-expectedOpens);
  assert.equal(stats.games200,included.filter(g=>g.score>=200).length);
  assert.equal(stats.games250,included.filter(g=>g.score>=250).length);
  assert.equal(stats.games300,included.filter(g=>g.score===300).length);
  if(detail.length){
    almost(stats.strikePct,100*expectedStrikes/expectedOpps,'Weighted strike rate');
    almost(stats.closedFramePct,100*(detail.length*10-expectedOpens)/(detail.length*10),'Closed-frame rate');
  } else {
    assert.equal(stats.strikePct,null,'Score-only history must not be treated as 0% strikes');
    assert.equal(stats.closedFramePct,null,'Score-only history must not be treated as 100% closed');
  }
  let best=null;
  const totals=[];
  for(const session of buildSessions(all)){
    let count=0,total=0;
    for(let i=0;i<session.games.length;i++){
      const game=session.games[i];
      if(!chosen.has(game.id)){count=0;total=0;continue;}
      total+=game.score;
      if(++count===3){totals.push(total);count=0;total=0;}
    }
    for(let i=0;i<=session.games.length-3;i++){
      const triple=session.games.slice(i,i+3);
      if(!triple.every(game=>chosen.has(game.id)))continue;
      const score=triple.reduce((sum,g)=>sum+g.score,0);
      best=Math.max(best??score,score);
    }
  }
  assert.equal(stats.bestSeries?.total??null,best,'Best series may not jump excluded games');
  assert.deepEqual([...completedSeriesTotals(selected,all)].sort((a,b)=>a-b),totals.sort((a,b)=>a-b),'Completed series must be non-overlapping');
  assert.equal(JSON.stringify(all),before,'Stats cannot mutate saved game records');
  gamesGenerated+=all.length;scenarios++;
}
// A partial history should not fabricate a best series by treating missing positions as adjacent.
const triple=[1,2,3].map((id,i)=>({...base,id,gameOrder:i+1}));
assert.equal(bestThreeGameSeries(buildSessions(triple),triple.slice(0,2)),null);

console.log('PASS seeded edge cases: '+scenarios+' scenarios / '+gamesGenerated+' games; seed='+initialSeed+
  '; types, dates, score-only, no-tap, frame denominators, series, normalization, CSV safety.');
