import {performance} from 'node:perf_hooks';
import {buildSessions} from '../modules/sessions.js';
import {calculateStats, progressStats} from '../modules/statistics.js';
import {planSync, cloudGamePayload} from '../modules/reconciliation.js';
import {historyRows} from '../modules/history-renderer.js';
const measure=fn=>{for(let i=0;i<3;i++)fn();const times=[];for(let i=0;i<9;i++){const start=performance.now();fn();times.push(performance.now()-start);}return +times.sort((a,b)=>a-b)[4].toFixed(2);};
export function fixture(count) {
  return Array.from({length:count},(_,i)=>({id:i+1,bowler:'Performance test',date:`2026-${String(1+Math.floor(i/84)%12).padStart(2,'0')}-${String(Math.floor(i/3)%28+1).padStart(2,'0')}`,
    sessionId:'session-'+Math.floor(i/3),schemaVersion:6,sessionName:'League',sessionType:'League',score:150+i%100,scoreOnly:i%5===0,
    strikes:i%5===0?null:4,openFrames:i%5===0?null:3,strikeOpportunities:i%5===0?null:10,
    noTap:i%13===0,ball:'Ball '+i%12,balls:[{name:'Ball '+i%12,frames:null}],alley:'Alley '+i%8,createdAt:i+1,updatedAt:i+1,gameOrder:i%3,notes:''}));
}
if (process.argv[1]?.endsWith('/performance.mjs')) {
const results=[];
for (const count of [1000,5000]) {
  const games=fixture(count),sessions=buildSessions(games), localGameMap=new Map(games.map(game=>[game.id,game]));
  const remoteMap=new Map(games.map(game=>[game.id,cloudGamePayload(game)]));
  const query=()=>games.filter(game=>game.alley==='Alley 1' && !game.noTap);
  results.push({games:count,sessions:sessions.length,statsMs:measure(()=>calculateStats(games)),sessionGroupingMs:measure(()=>buildSessions(games)),
    filteringMs:measure(query),trendMs:measure(()=>progressStats(games)),reconciliationMs:measure(()=>planSync({localGameMap,remoteMap,tombstoneMap:new Map()})),
    firstTenHistoryTemplatesMs:measure(()=>historyRows(sessions.slice(0,10),new Map(sessions.map(session=>[session.key,session])),new Map()))});
}
console.log(JSON.stringify({environment:`Node ${process.version}; median of 9 warm runs; milliseconds`,results},null,2));
}
