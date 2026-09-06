import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{verifySignature,command} from '../src/worker.mjs';
import {stats,filterGames,sessions} from '../src/stats.mjs';
import {decodeFields} from '../src/firebase.mjs';
import {commands} from '../src/commands.mjs';
const game=(id,date,score,extras={})=>({id,date,score,sessionName:'League night',strikes:4,strikeOpportunities:10,openFrames:3,createdAt:id,...extras});
const env={APP_URL:'https://matthewgptxi.github.io/bowling-tracker-cloud/',WORKER_ORIGIN:'https://bot.example',DISCORD_APPLICATION_ID:'1546004844970770443'};
test('stats match game grouping, legacy League defaults and ball filters',()=>{
 const games=[game(1,'2026-09-01',150,{ball:'Phaze II'}),game(2,'2026-09-01',160,{ball:'Other'}),game(3,'2026-09-01',170,{ball:'phaze  ii'}),game(4,'2026-09-01',180,{ball:'Phaze II'})];
 assert.equal(stats(games).average,165);assert.equal(stats(games).highSeries,510);
 const selected=filterGames(games,{ball:' PHAZE II ',type:'League',from:'2026-09-01',through:'2026-09-01'});assert.equal(selected.length,3);assert.equal(stats(selected,games).highSeries,null);
 assert.throws(()=>filterGames(games,{from:'2026-02-31'}));assert.throws(()=>filterGames(games,{from:'2026-09-02',through:'2026-09-01'}));
 assert.equal(sessions([game(1,'2026-09-01',100),game(5,'2026-09-01',150,{sessionName:'New'})])[0].games[0].id,5);
});
test('Firestore fields decode without converting Discord identifiers to numbers',()=>{
 assert.deepEqual(decodeFields({score:{integerValue:'175'},ball:{stringValue:'Ball'},deleted:{booleanValue:false}}),{score:175,ball:'Ball',deleted:false});
});
test('commands include comparisons with actual Discord user options; no milestones',()=>{
 const options=commands[0].options;assert.equal(options.find(o=>o.name==='compare').options[0].type,6);assert(!JSON.stringify(commands).includes('milestone'));assert(!options.some(o=>o.name==='sharing'));
 for(const option of options){let optional=false;for(const field of option.options){if(!field.required)optional=true;else assert(!optional,'Required options must be first');}}
});
test('Discord signature verification rejects tampering and old requests; real signed ping works',async()=>{
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);const hex=bytes=>Buffer.from(bytes).toString('hex');const publicKey=hex(await crypto.subtle.exportKey('raw',pair.publicKey));
 const timestamp=String(Math.floor(Date.now()/1000)),body=JSON.stringify({type:1});const signature=hex(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(timestamp+body)));
 const request=new Request('https://bot.example/interactions',{method:'POST',body,headers:{'X-Signature-Ed25519':signature,'X-Signature-Timestamp':timestamp}});
 assert(await verifySignature(request,body,publicKey));assert(!await verifySignature(request,body+' ',publicKey));
 assert.deepEqual(await (await worker.fetch(request,{...env,DISCORD_PUBLIC_KEY:publicKey},{})).json(),{type:1});
 const bad=new Request('https://bot.example/interactions',{method:'POST',body:'{}'});assert.equal((await worker.fetch(bad,{...env,DISCORD_PUBLIC_KEY:publicKey},{})).status,401);
});
test('untrusted origins and callback without browser cookie cannot link accounts',async()=>{
 const response=await worker.fetch(new Request('https://bot.example/discord/link',{headers:{Origin:'https://evil.example'}}),env,{});assert.equal(response.status,403);
 const callback=await worker.fetch(new Request('https://bot.example/discord/callback?state=stolen&code=x'),env,{});assert((await callback.text()).includes('could not be verified'));
 const preflight=await worker.fetch(new Request('https://bot.example/discord/link',{method:'OPTIONS',headers:{Origin:new URL(env.APP_URL).origin}}),env,{});assert.equal(preflight.status,204);
});
test('configuration and disabling require administrator permissions before database access',async()=>{
 for(const sub of ['configure','disable'])await assert.rejects(()=>command({guild_id:'123',member:{permissions:'0',user:{id:'123'}},data:{name:'bowling',options:[{name:sub}]}},env),/Manage Server/);
});
test('expired or replayed OAuth state is rejected without a token exchange',async()=>{
 let calls=0;const DB={prepare:()=>({bind:()=>({first:async()=>{calls++;return null;}})})};
 const nonce='a'.repeat(64),request=new Request('https://bot.example/discord/callback?state=expired&code=x',{headers:{Cookie:'__Host-bowling-link='+nonce}});
 assert((await (await worker.fetch(request,{...env,DB},{})).text()).includes('expired'));assert.equal(calls,1);
});
test('command integration allows linked users without opt-in while enforcing group membership',async()=>{
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
 const ids=['111111111111111111','222222222222222222'],links=[{uid:'u1',discord_id:ids[0],username:'One',share:0},{uid:'u2',discord_id:ids[1],username:'Two',share:0}];let member=true;
 const DB={prepare:sql=>({bind:(...args)=>({first:async()=>sql.includes('FROM links')?links.find(l=>l.discord_id===args[0]):sql.includes('FROM guilds')?{group_id:'ABCDEFGH'}:null,run:async()=>({meta:{changes:1}})})})};
 const config={...env,DB,GOOGLE_CLIENT_EMAIL:'test@example.invalid',GOOGLE_PRIVATE_KEY:pem,FIREBASE_PROJECT_ID:'test'};
 const value=v=>typeof v==='number'?{integerValue:String(v)}:{stringValue:v};const doc=data=>({fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,value(v)]))});
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{
  if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'mock',expires_in:3600});
  if(String(url).includes('accounts:lookup'))return Response.json({users:JSON.parse(options.body).localId.map(localId=>({localId}))});
  if(String(url).includes('/members/'))return member?Response.json(doc({uid:'member'})):new Response('',{status:404});
  if(String(url).includes('/games?'))return Response.json({documents:[{...doc(game(1,'2026-09-01',180)),name:'projects/test/documents/users/u1/games/1'}]});
  return Response.json(doc({displayName:'Player'}));
 };
 const i={guild_id:'123',member:{user:{id:ids[0]}},data:{name:'bowling',options:[{name:'stats',options:[]}]}};
 try{
  assert((await command(i,config)).includes('180.0'));
  i.data.options[0].options=[{name:'player',value:ids[1]}];assert((await command(i,config)).includes('Two'),'Legacy share=0 must not block stats');
  i.data.options[0]={name:'compare',options:[{name:'opponent',value:ids[1]}]};assert((await command(i,config)).includes('Comparison'),'Comparison requires no opt-in');
  member=false;await assert.rejects(()=>command(i,config),/group/);
 }finally{globalThis.fetch=original;}
});
test('OAuth callback consumes browser-bound state once and stores the verified Discord ID',async()=>{
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
 let pending={uid:'u1'},inserted;
 const DB={prepare:sql=>({bind:(...args)=>({first:async()=>{if(sql.startsWith('DELETE FROM oauth_states')){const old=pending;pending=null;return old;}return null;},run:async()=>{if(sql.startsWith('INSERT INTO links'))inserted=args;return {meta:{changes:1}};}})})};
 const original=globalThis.fetch;globalThis.fetch=async url=>{
  if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'mock',expires_in:3600});
  if(String(url).endsWith('/oauth2/token'))return Response.json({access_token:'discard-after-use'});
  if(String(url).endsWith('/users/@me'))return Response.json({id:'333333333333333333',username:'Verified'});
  if(String(url).includes('firestore.googleapis.com'))return Response.json({fields:{displayName:{stringValue:'Player'}}});
  throw new Error('Unexpected request');
 };
 const config={...env,DB,GOOGLE_CLIENT_EMAIL:'oauth-test@example.invalid',GOOGLE_PRIVATE_KEY:pem,FIREBASE_PROJECT_ID:'test',DISCORD_CLIENT_SECRET:'mock'};
 const request=()=>new Request('https://bot.example/discord/callback?state=state&code=code',{headers:{Cookie:'__Host-bowling-link='+'a'.repeat(64)}});
 try{assert((await (await worker.fetch(request(),config,{})).text()).includes('Discord connected'));assert.deepEqual(inserted.slice(0,3),['u1','333333333333333333','Verified']);assert((await (await worker.fetch(request(),config,{})).text()).includes('expired'));}finally{globalThis.fetch=original;}
});
test('signed commands defer publicly and edit the public response without ephemeral flags',async()=>{
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']),hex=bytes=>Buffer.from(bytes).toString('hex');
 const publicKey=hex(await crypto.subtle.exportKey('raw',pair.publicKey)),timestamp=String(Math.floor(Date.now()/1000));
 const body=JSON.stringify({id:'interaction-test',type:2,application_id:env.DISCORD_APPLICATION_ID,token:'test-only',guild_id:'guild',member:{user:{id:'111111111111111111'}},data:{name:'bowling',options:[{name:'link'}]}});
 const signature=hex(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(timestamp+body)));
 const pending=[],sent=[],original=globalThis.fetch;globalThis.fetch=async(url,options)=>{sent.push(JSON.parse(options.body));return new Response(null,{status:204});};
 const DB={prepare:()=>({bind:()=>({run:async()=>({meta:{changes:1}})})})};
 try{
  const response=await worker.fetch(new Request('https://bot.example/interactions',{method:'POST',body,headers:{'X-Signature-Ed25519':signature,'X-Signature-Timestamp':timestamp}}),{...env,DISCORD_PUBLIC_KEY:publicKey,DB},{waitUntil:promise=>pending.push(promise)});
  assert.deepEqual(await response.json(),{type:5});await Promise.all(pending);assert.equal(sent.length,1);assert.equal(sent[0].flags,undefined);assert(sent[0].content.includes('public'));assert.deepEqual(sent[0].allowed_mentions,{parse:[]});
 }finally{globalThis.fetch=original;}
});
