import {document,collection,firebaseUser,activeUsers,gamesDuring} from './firebase.mjs';
import {filterGames,stats,statsText,sessions,safeText,cleanBall,ballKey} from './stats.mjs';
const API='https://discord.com/api/v10';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const now=()=>Math.floor(Date.now()/1000);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const js=s=>JSON.stringify(s).replace(/</g,'\\u003c');
function page(text,script='',cookie='') {
 const nonce=random();return new Response(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bowling Tracker · Discord</title><main><h1>Bowling Tracker</h1><p>${escape(text)}</p><p>You can close this window and return to the bowling app.</p></main>${script?`<script nonce="${nonce}">${script}</script>`:''}`,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,...(cookie?{'Set-Cookie':cookie}:{})}});
}
async function discord(path,env,method='GET',body) {
 const response=await fetch(API+path,{method,headers:{Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`Discord request failed (${response.status}). Check bot channel permissions and configuration.`);
 return response.status===204?{}:response.json();
}
export async function verifySignature(request,body,keyHex) {
 const signature=request.headers.get('X-Signature-Ed25519'),timestamp=request.headers.get('X-Signature-Timestamp');
 if(!signature || !/^[a-f0-9]{128}$/i.test(signature) || !/^[a-f0-9]{64}$/i.test(keyHex||'') || !/^\d+$/.test(timestamp||'') || Math.abs(now()-Number(timestamp))>300)return false;
 const bytes=hex=>Uint8Array.from(hex.match(/../g),x=>parseInt(x,16));
 try{const key=await crypto.subtle.importKey('raw',bytes(keyHex),'Ed25519',false,['verify']);return crypto.subtle.verify('Ed25519',key,bytes(signature),new TextEncoder().encode(timestamp+body));}catch{return false;}
}
async function linked(env,id) {
 const link=await env.DB.prepare('SELECT * FROM links WHERE discord_id=?').bind(id).first();
 if(!link)throw new Error('That player has not connected Discord in the bowling app.');
 if(!(await activeUsers(env,[link.uid])).has(link.uid) || !await document(env,'users',link.uid)){await env.DB.prepare('DELETE FROM links WHERE uid=?').bind(link.uid).run();throw new Error('That bowling account is unavailable.');}return link;
}
const actor=i=>i.member?.user?.id||i.user?.id;
const admin=i=>{const bits=BigInt(i.member?.permissions||'0');return (bits&32n)!==0n||(bits&8n)!==0n;};
async function server(env,i) {
 if(!i.guild_id)throw new Error('Use this command in your bowling Discord server.');
 const config=await env.DB.prepare('SELECT * FROM guilds WHERE guild_id=?').bind(i.guild_id).first();if(!config)throw new Error('A server administrator must run /bowling configure first.');
 const requester=await linked(env,actor(i));
 if(!await document(env,'groups',config.group_id,'members',requester.uid))throw new Error('Join this server’s bowling group in the app first.');
 return {config,requester};
}
async function player(env,i,id) {
 const target=await linked(env,id);
 if(id!==actor(i)){
  const {config}=await server(env,i);
  if(!await document(env,'groups',config.group_id,'members',target.uid))throw new Error('Both players must belong to this server’s bowling group.');
 }
 return target;
}
async function gamesFor(env,uid){return (await collection(env,['users',uid,'games'])).filter(g=>!g.deleted && typeof g.date==='string' && Number.isFinite(g.score));}
export function optionsOf(i){return Object.fromEntries((i.data?.options?.[0]?.options||[]).map(o=>[o.name,o.value]));}
function period(options){return [options.from||'first recorded game',options.through||'latest recorded game'].join(' to ')+(options.type?` · ${options.type}`:'');}
async function groupRoster(env,config) {
 const members=await collection(env,['groups',config.group_id,'members'],100);
 const shared=(await env.DB.prepare('SELECT * FROM links').all()).results||[];
 const map=new Map(shared.map(link=>[link.uid,link]));
 const candidates=members.filter(member=>map.has(member._docId));
 const active=await activeUsers(env,candidates.map(member=>member._docId));
 return candidates.filter(member=>active.has(member._docId)).map(member=>({...member,link:map.get(member._docId)}));
}
export async function command(i,env) {
 const sub=i.data?.options?.[0]?.name,o=optionsOf(i),id=actor(i);
 if(i.data?.name!=='bowling')throw new Error('Unknown command.');
 if(sub==='link')return `Connect Discord from Account settings in ${env.APP_URL}\nBot replies are public in the channel. Linked bowling group members are automatically available for comparisons, leaderboards and recaps. Notes are excluded.`;
 if(sub==='disable'){
  if(!i.guild_id||!admin(i))throw new Error('Manage Server permission is required.');await env.DB.prepare('DELETE FROM guilds WHERE guild_id=?').bind(i.guild_id).run();return 'Server connection removed. Weekly recaps disabled.';
 }
 if(sub==='configure'){
  if(!i.guild_id||!admin(i))throw new Error('Manage Server permission is required.');
  if(await env.DB.prepare('SELECT guild_id FROM guilds WHERE guild_id<>? LIMIT 1').bind(i.guild_id).first())throw new Error('This free-tier deployment supports one Discord server. Disable the previous server connection first.');
  const me=await linked(env,id),group=String(o.group||'').trim().toUpperCase();if(!/^[A-Z0-9]{8}$/.test(group))throw new Error('Enter the eight-character group code from the app.');
  const record=await document(env,'groups',group);if(!record || record.ownerUid!==me.uid)throw new Error('Only the bowling group owner can connect it to a Discord server.');
  if(o.weekly && !o.channel)throw new Error('Select a bowling channel when enabling weekly recaps.');
  if(o.channel){const channel=await discord('/channels/'+o.channel,env);if(channel.guild_id!==i.guild_id || ![0,5].includes(channel.type))throw new Error('Choose a text channel in this server.');}
  await env.DB.prepare('INSERT INTO guilds(guild_id,group_id,configured_by,channel_id,weekly) VALUES(?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET group_id=excluded.group_id,configured_by=excluded.configured_by,channel_id=excluded.channel_id,weekly=excluded.weekly').bind(i.guild_id,group,me.uid,o.channel||null,o.weekly?1:0).run();
  return `Connected to ${safeText(record.name)||'your bowling group'}. Weekly recaps ${o.weekly?'enabled (Mondays, 16:00 UTC)':'disabled'}. Linked group members are included. Restrict the recap channel to your bowling group.`;
 }
 if(sub==='leaderboard'){
  const {config}=await server(env,i),members=await groupRoster(env,config);const metric=['average','highGame','highSeries','strikePct','cleanGames'].includes(o.metric)?o.metric:'average';
  members.sort((a,b)=>Number(b[metric]||0)-Number(a[metric]||0));
  return '**Group leaderboard · all recorded games**\n'+(members.slice(0,15).map((m,n)=>`${n+1}. ${safeText(m.displayName||m.link.username)} — ${Number(m[metric]||0).toFixed(1)} · ${Number(m.games||0)} games${metric==='average'&&Number(m.games||0)<10?' (provisional)':''}`).join('\n')||'No group members have connected Discord yet.')+'\nUses the latest summaries synced by the app. Only linked group members are shown.';
 }
 if(sub==='recap'){const {config}=await server(env,i);return recap(env,config);}
 if(sub==='compare'){
  const left=await player(env,i,o.player||id),right=await player(env,i,o.opponent);
  // Even when one target is the requester, both must be in the configured group.
  const {config}=await server(env,i);
  for(const p of [left,right])if(!await document(env,'groups',config.group_id,'members',p.uid))throw new Error('Both players must be members of the configured group.');
  const a=await gamesFor(env,left.uid),b=left.uid===right.uid?a:await gamesFor(env,right.uid);
  return `**Comparison · ${period(o)}**\n${statsText(safeText(left.username),filterGames(a,o),a)}\n\n${statsText(safeText(right.username),filterGames(b,o),b)}`;
 }
 const me=await player(env,i,o.player||id),all=await gamesFor(env,me.uid);
 if(sub==='stats')return statsText(safeText(me.username)+' · '+period(o),filterGames(all,o),all);
 if(sub==='ball'){
  if(!o.ball){const balls=[...new Map(all.filter(g=>cleanBall(g.ball)).map(g=>[ballKey(g.ball),cleanBall(g.ball)])).values()].sort();return '**Your recorded balls**\n'+(balls.slice(0,40).map(safeText).join('\n')||'No balls recorded. Add them through Advanced in game entry.');}
  return statsText(safeText(me.username)+' · '+safeText(o.ball)+' · '+period(o),filterGames(all,o),all);
 }
 if(sub==='session'){
  const session=sessions(all)[0];if(!session)return 'No synced games yet.';
  return `**${safeText(me.username)} · ${session.date} · ${session.type}**\n`+session.games.slice(0,20).map((g,n)=>`Game ${n+1}: ${g.score}${g.ball?' · '+safeText(g.ball):''}`).join('\n')+`\nTotal: ${session.games.reduce((s,g)=>s+g.score,0)} · Average: ${stats(session.games).average.toFixed(1)}${session.games.length>20?'\nShowing the first 20 game rows; total includes the full session.':''}`;
 }
 throw new Error('Unknown bowling command.');
}
export async function recap(env,config) {
 const group=await document(env,'groups',config.group_id);
 if(!group || group.ownerUid!==config.configured_by)throw new Error('Group ownership changed. Reconfigure the server connection.');
 const roster=await groupRoster(env,config);if(roster.length>15)throw new Error('Weekly recaps support up to 15 linked members per group on this setup.');
 const end=new Date();end.setUTCHours(0,0,0,0);const start=new Date(end.getTime()-7*86400000),through=new Date(end.getTime()-86400000);
 const o={from:start.toISOString().slice(0,10),through:through.toISOString().slice(0,10)},rows=[];
 for(const member of roster){
  if(!await document(env,'users',member.link.uid))continue;
  const all=await gamesDuring(env,member.link.uid,o.from,o.through),selected=filterGames(all,o);if(!selected.length)continue;
  const s=stats(selected,all);rows.push({name:safeText(member.displayName||member.link.username),...s});
 }
 rows.sort((a,b)=>b.average-a.average);
 return `**Weekly bowling recap · ${o.from} to ${o.through} (UTC dates)**\n`+(rows.map(r=>`${r.name}: ${r.games} games · avg ${r.average.toFixed(1)} · high ${r.highGame}`).join('\n')||'No synced games from linked players in this period.')+'\nOnly linked members are included.';
}
async function interaction(request,env,ctx) {
 const body=await request.text();if(body.length>65536)return new Response('Too large',{status:413});
 if(!await verifySignature(request,body,env.DISCORD_PUBLIC_KEY))return new Response('Invalid signature',{status:401});
 let i;try{i=JSON.parse(body);}catch{return new Response('Invalid JSON',{status:400});}
 if(i.type===1)return json({type:1});
 if(i.application_id!==env.DISCORD_APPLICATION_ID)return new Response('Wrong app',{status:403});
 if(i.type===4){
  // Autocomplete must answer immediately; regular /ball without a value lists all saved balls.
  return json({type:8,data:{choices:[]}});
 }
 if(i.type!==2)return new Response('Unsupported interaction',{status:400});
 ctx.waitUntil((async()=>{
  const claimed=await env.DB.prepare('INSERT OR IGNORE INTO requests(id,expires) VALUES(?,?)').bind(i.id,now()+900).run();if(!claimed.meta.changes)return;
  let content;try{content=await command(i,env);}catch(error){content=error.message||'Could not load bowling stats. Try again.';}
  // Interaction tokens are used only for responding; never log the payload.
  const response=await fetch(`${API}/webhooks/${env.DISCORD_APPLICATION_ID}/${i.token}/messages/@original`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:content.slice(0,1950),allowed_mentions:{parse:[]}}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)console.error('Discord response failed',response.status);
 })().catch(()=>console.error('Interaction processing failed')));
 return json({type:5});
}
async function route(request,env,ctx) {
 const url=new URL(request.url),origin=new URL(env.APP_URL).origin;
 if(url.pathname==='/health')return json({ok:true,bot:'Bowling Tracker Bot',configured:!!(env.DISCORD_CLIENT_SECRET&&env.DISCORD_BOT_TOKEN&&env.GOOGLE_PRIVATE_KEY&&env.GOOGLE_CLIENT_EMAIL)});
 if(url.pathname==='/interactions' && request.method==='POST')return interaction(request,env,ctx);
 if(url.pathname==='/discord/connect' && request.method==='GET'){
  const nonce=random();await env.DB.prepare('INSERT INTO oauth_nonces(nonce,expires) VALUES(?,?)').bind(nonce,now()+600).run();
  return page('Preparing your Discord connection. Keep this window open.',`if(window.opener)window.opener.postMessage({type:'bowling-discord-ready',nonce:${js(nonce)}},${js(origin)});`,`__Host-bowling-link=${nonce}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
 }
 if(url.pathname==='/discord/callback' && request.method==='GET'){
  const state=url.searchParams.get('state'),cookie=request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-bowling-link=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!state||!cookie)return page('Connection could not be verified. Start again from the bowling app.');
  const pending=await env.DB.prepare('DELETE FROM oauth_states WHERE state=? AND nonce=? AND expires>? RETURNING uid').bind(state,cookie,now()).first();
  if(!pending)return page('This connection request expired or was already used. Start again in the app.');
  if(url.searchParams.has('error'))return page('Discord authorization was cancelled.');
  const tokenResponse=await fetch(API+'/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:env.DISCORD_APPLICATION_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code:url.searchParams.get('code')||'',redirect_uri:env.WORKER_ORIGIN+'/discord/callback'}),signal:AbortSignal.timeout(10000)});
  if(!tokenResponse.ok)throw new Error('Discord authorization failed. Start again from the app.');
  const token=await tokenResponse.json();const identityResponse=await fetch(API+'/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(10000)});
  if(!identityResponse.ok)throw new Error('Could not verify the Discord identity.');const identity=await identityResponse.json();
  if(!/^\d{17,20}$/.test(identity.id)||!await document(env,'users',pending.uid))throw new Error('The bowling account is unavailable.');
  try{await env.DB.prepare('INSERT INTO links(uid,discord_id,username,created_at) VALUES(?,?,?,?)').bind(pending.uid,identity.id,identity.username,now()).run();}
  catch{throw new Error('One of these accounts is already linked. Disconnect it in the app before linking again.');}
  return page('Discord connected. Your stats can now appear in public bot replies, comparisons and group recaps. Notes are excluded.',`if(window.opener)window.opener.postMessage({type:'bowling-discord-linked'},${js(origin)});`,`__Host-bowling-link=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
 }
 if(url.pathname==='/discord/link' || url.pathname==='/discord/link/start'){
  if(request.headers.get('Origin')!==origin)return new Response('Origin not allowed',{status:403});
  const uid=await firebaseUser(request,env);
  if(url.pathname==='/discord/link' && request.method==='GET'){
   const row=await env.DB.prepare('SELECT * FROM links WHERE uid=?').bind(uid).first();return json(row?{linked:true,discordUserId:row.discord_id,username:row.username}:{linked:false});
  }
  if(url.pathname==='/discord/link' && request.method==='DELETE'){
   await env.DB.batch([env.DB.prepare('DELETE FROM links WHERE uid=?').bind(uid),env.DB.prepare('DELETE FROM oauth_states WHERE uid=?').bind(uid)]);return new Response(null,{status:204});
  }
  if(url.pathname==='/discord/link/start' && request.method==='POST'){
   const {nonce}=await request.json();if(!/^[a-f0-9]{64}$/.test(nonce||''))throw new Error('Open the connection window from the app first.');
   const row=await env.DB.prepare('DELETE FROM oauth_nonces WHERE nonce=? AND expires>? RETURNING nonce').bind(nonce,now()).first();if(!row)throw new Error('The connection window expired. Please try again.');
   if(await env.DB.prepare('SELECT uid FROM links WHERE uid=?').bind(uid).first())throw new Error('Disconnect your current Discord account first.');
   const state=random();await env.DB.prepare('INSERT INTO oauth_states(state,nonce,uid,expires) VALUES(?,?,?,?)').bind(state,nonce,uid,now()+600).run();
   const target=new URL('https://discord.com/oauth2/authorize');target.search=new URLSearchParams({client_id:env.DISCORD_APPLICATION_ID,response_type:'code',scope:'identify',state,redirect_uri:env.WORKER_ORIGIN+'/discord/callback'});return json({authorizationUrl:target.href});
  }
 }
 return new Response('Not found',{status:404});
}
export default {
 async fetch(request,env,ctx){
  const origin=new URL(env.APP_URL).origin,allowed=request.headers.get('Origin')===origin;
  const headers=allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Vary':'Origin'}:{};
  if(request.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers});
  try{const response=await route(request,env,ctx);const result=new Response(response.body,response);for(const [key,value]of Object.entries(headers))result.headers.set(key,value);return result;}
  catch(error){if(new URL(request.url).pathname==='/discord/callback')return page(error.message||'Connection failed.');return json({error:error.message||'Request failed'},400,headers);}
 },
 async scheduled(event,env,ctx){
  await env.DB.batch(['oauth_nonces','oauth_states','requests'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE expires<?`).bind(now())));
  const configs=(await env.DB.prepare('SELECT * FROM guilds WHERE weekly=1 AND channel_id IS NOT NULL LIMIT 10').all()).results||[];
  const week=new Date(event.scheduledTime).toISOString().slice(0,10);
  for(const config of configs){
   const result=await env.DB.prepare("INSERT OR IGNORE INTO recaps(guild_id,week,status) VALUES(?,?,'pending')").bind(config.guild_id,week).run();if(!result.meta.changes)continue;
   try{const content=await recap(env,config);const channel=await discord('/channels/'+config.channel_id,env);if(channel.guild_id!==config.guild_id)throw new Error('Wrong server');await discord('/channels/'+config.channel_id+'/messages',env,'POST',{content:content.slice(0,1950),allowed_mentions:{parse:[]}});await env.DB.prepare("UPDATE recaps SET status='sent' WHERE guild_id=? AND week=?").bind(config.guild_id,week).run();}
   catch{await env.DB.prepare("UPDATE recaps SET status='failed' WHERE guild_id=? AND week=?").bind(config.guild_id,week).run();console.error('Weekly recap failed; check configuration or permissions.');}
  }
 }
};
