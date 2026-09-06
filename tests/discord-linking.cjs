const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../discord.js'),'utf8');
function setup(serviceUrl='') {
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{listeners:{},addEventListener(t,f){this.listeners[t]=f}});return elements.get(id)};
 const requests=[],navigation=[];let reply={linked:false};
 const c={URL,AbortSignal,document:{getElementById:$},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,status:200,json:async()=>reply}},window:{BOWLING_DISCORD_CONFIG:{serviceUrl},addEventListener(){},confirm:()=>true,location:{assign:url=>navigation.push(url)}}};
 vm.createContext(c);vm.runInContext(source,c);
 return {c,$,requests,navigation,setReply:r=>reply=r};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const user={uid:'a',getIdToken:async()=> 'test-token'};
 const off=setup();off.c.window.BowlingDiscord.setAccount(user);await settle();assert.equal(off.requests.length,0);assert(off.$('connectDiscordBtn').disabled);
 const on=setup('https://link.example');on.c.window.BowlingDiscord.setAccount(user);await settle();assert.equal(on.requests[0].options.headers.Authorization,'Bearer test-token');assert(!on.$('connectDiscordBtn').disabled);
 on.setReply({authorizationUrl:'https://attacker.example/'});await on.$('connectDiscordBtn').listeners.click();assert.equal(on.navigation.length,0);
 on.setReply({authorizationUrl:'https://discord.com/oauth2/authorize?response_type=code&scope=identify&state=nonce&client_id=123'});await on.$('connectDiscordBtn').listeners.click();assert.equal(on.navigation.length,1);
 on.setReply({linked:true,discordUserId:'123456789012345678',username:'Matthew'});await on.$('refreshDiscordBtn').listeners.click();assert(on.$('connectDiscordBtn').hidden);assert(!on.$('disconnectDiscordBtn').hidden);
 await on.$('disconnectDiscordBtn').listeners.click();assert.equal(on.requests.at(-1).options.method,'DELETE');assert(on.$('discordLinkStatus').textContent.includes('disconnected'));
 let release;user.getIdToken=()=>new Promise(resolve=>release=resolve);const pending=on.$('refreshDiscordBtn').listeners.click();on.c.window.BowlingDiscord.setAccount(null);release('test-token');await pending;assert(on.$('discordLinkStatus').textContent.startsWith('Sign in'));assert(on.$('connectDiscordBtn').disabled);
 console.log('PASS: disabled unconfigured linking makes no requests; authenticated status, redirect validation, connect/disconnect and stale account responses.');
})().catch(e=>{console.error(e);process.exitCode=1});
