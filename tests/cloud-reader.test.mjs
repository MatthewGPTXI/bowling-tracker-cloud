import assert from 'node:assert/strict';
import {readRemoteHistory, READ_PAGE_SIZE} from '../modules/cloud-reader.js';
const rows = new Map(Array.from({length:503},(_,index)=>[String(index+1),{id:index+1,score:180,updatedAt:1}]));
let seconds=1000, cutoff, reads=0, queries=[], current=true, fail=false;
const sdk={
  doc:(_, ...parts)=>parts.join('/'), collection:(_, ...parts)=>parts.join('/'),
  Timestamp:class {constructor(seconds,nanoseconds){Object.assign(this,{seconds,nanoseconds});}},
  serverTimestamp:()=>({seconds,nanoseconds:0}), setDoc:async(_,value)=>{cutoff=value.syncReadAt;},
  getDocFromServer:async()=>({data:()=>({syncReadAt:cutoff})}),
  documentId:()=> '__name__', query:(ref,...constraints)=>({ref,constraints}),
  where:(field,op,value)=>({type:'where',field,op,value}),orderBy:field=>({type:'order',field}),
  limit:size=>({type:'limit',size}),startAfter:doc=>({type:'after',id:doc.id}),
  getDocsFromServer:async query=>{
    if(fail) throw new Error('offline');
    reads++;queries.push(query);
    let result=[...rows].map(([id,data])=>({id,data:()=>structuredClone(data)}));
    for(const rule of query.constraints.filter(rule=>rule.type==='where')) {
      result=result.filter(doc=>{const value=doc.data()[rule.field]?.seconds;return value!==undefined && (rule.op==='>='?value>=rule.value.seconds:value<=rule.value.seconds);});
    }
    const incremental=query.constraints.some(rule=>rule.field==='serverUpdatedAt');
    result.sort((a,b)=>(incremental?a.data().serverUpdatedAt.seconds-b.data().serverUpdatedAt.seconds:0)||a.id.localeCompare(b.id));
    const after=query.constraints.find(rule=>rule.type==='after');if(after)result=result.slice(result.findIndex(doc=>doc.id===after.id)+1);
    result=result.slice(0,query.constraints.find(rule=>rule.type==='limit').size);
    return{forEach:fn=>result.forEach(fn)};
  }
};
const args={sdk,firestore:{},uid:'a',isCurrent:()=>current};
const legacy=await readRemoteHistory(args);
assert.equal(legacy.records.size,503);assert.equal(legacy.snapshot,null);assert.equal(reads,3);
assert(queries.every(query=>query.constraints.find(rule=>rule.type==='limit').size===READ_PAGE_SIZE));
reads=0;queries=[];
const initial=await readRemoteHistory({...args,protocol:1});
assert.equal(initial.records.size,503);assert.deepEqual(initial.snapshot.cursor,{seconds:1000,nanoseconds:0});
// A same-boundary commit and a later tombstone must both be seen; unchanged
// legacy records without server timestamps remain in the durable baseline.
rows.set('1',{id:1,score:210,updatedAt:2,serverUpdatedAt:{seconds:1000,nanoseconds:0}});
rows.set('2',{id:2,deleted:true,updatedAt:3,serverUpdatedAt:{seconds:1001,nanoseconds:0}});
seconds=1002;reads=0;queries=[];
const delta=await readRemoteHistory({...args,protocol:1,baseline:initial.snapshot});
assert.equal(reads,1);assert(queries[0].constraints.some(rule=>rule.type==='where'));
assert.equal(delta.records.size,503);assert.equal(delta.records.get(1).score,210);assert(delta.records.get(2).deleted);
assert.equal(delta.records.get(503).score,180);
// Timestamp ties larger than a page do not lose documents.
for(let id=1;id<=501;id++)rows.set(String(id),{id,score:200,updatedAt:4,serverUpdatedAt:{seconds:1003,nanoseconds:0}});
seconds=1004;reads=0;
const tied=await readRemoteHistory({...args,protocol:1,baseline:delta.snapshot});assert.equal(reads,3);
assert.equal([...tied.records.values()].filter(row=>row.score===200).length,501);
current=false;await assert.rejects(readRemoteHistory({...args,protocol:1,baseline:tied.snapshot}),/Account/);
current=true;fail=true;await assert.rejects(readRemoteHistory({...args,protocol:1,baseline:tied.snapshot}),/offline/);
assert.equal(tied.snapshot.cursor.seconds,1004,'Failed sync cannot mutate the last successful cursor');
console.log('PASS cloud reader: bounded full reads, legacy compatibility, server cutoffs, delta reads, tombstones, equal-timestamp pagination, failed reads and account guards.');
