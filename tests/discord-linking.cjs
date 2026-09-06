const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../discord.js'),'utf8');
function setup(serviceUrl='') {
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{listeners:{},addEventListener(t,f){this.listeners[t]=f}});return elements.get(id)};
 const requests=[],handlers={},popup={closed:false,location:{href:''},close(){this.closed=true}};let reply={linked:false};
 const c={URL,AbortSignal,setTimeout,clearTimeout,document:{getElementById:$},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,status:200,json:async()=>reply}},window:{BOWLING_DISCORD_CONFIG:{serviceUrl},addEventListener:(type,fn)=>handlers[type]=fn,confirm:()=>true,open:()=>{popup.closed=false;return popup}}};
 vm.createContext(c);vm.runInContext(source,c);
 return {c,$,requests,handlers,popup,setReply:r=>reply=r};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const user={uid:'a',getIdToken:async()=> 'test-token'};
 const off=setup();off.c.window.BowlingDiscord.setAccount(user);await settle();assert.equal(off.requests.length,0);assert(off.$('connectDiscordBtn').disabled);
 const on=setup('https://link.example');on.c.window.BowlingDiscord.setAccount(user);await settle();assert.equal(on.requests[0].options.headers.Authorization,'Bearer test-token');assert(!on.$('connectDiscordBtn').disabled);
 on.$('connectDiscordBtn').listeners.click();const message={origin:'https://link.example',source:on.popup,data:{type:'bowling-discord-ready',nonce:'a'.repeat(64)}};
 const count=on.requests.length;await on.handlers.message({...message,origin:'https://evil.example'});assert.equal(on.requests.length,count);
 on.setReply({authorizationUrl:'https://attacker.example/'});await on.handlers.message(message);assert.equal(on.popup.location.href,'');
 on.$('connectDiscordBtn').listeners.click();on.setReply({authorizationUrl:'https://discord.com/oauth2/authorize?response_type=code&scope=identify&state=nonce&client_id=123'});await on.handlers.message(message);assert(on.popup.location.href.startsWith('https://discord.com/'));assert.equal(JSON.parse(on.requests.at(-1).options.body).nonce,'a'.repeat(64));
 on.setReply({linked:true,discordUserId:'123456789012345678',username:'Matthew',sharing:false});await on.handlers.message({...message,data:{type:'bowling-discord-linked'}});assert(on.$('connectDiscordBtn').hidden);assert(!on.$('disconnectDiscordBtn').hidden);
 await on.$('disconnectDiscordBtn').listeners.click();assert.equal(on.requests.at(-1).options.method,'DELETE');assert(on.$('discordLinkStatus').textContent.includes('disconnected'));
 let release;user.getIdToken=()=>new Promise(resolve=>release=resolve);const pending=on.$('refreshDiscordBtn').listeners.click();on.c.window.BowlingDiscord.setAccount(null);release('test-token');await pending;assert(on.$('discordLinkStatus').textContent.startsWith('Sign in'));assert(on.$('connectDiscordBtn').disabled);
 console.log('PASS: disabled linking makes no requests; authenticated popup handshake, origin/source validation, allowed OAuth redirect, connect/disconnect and stale account responses.');
})().catch(e=>{console.error(e);process.exitCode=1});
