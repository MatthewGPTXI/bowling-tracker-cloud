const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../updates.js'),'utf8');
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
function harness(initial='32',savedGuard=null){
  const events={},timers=[],storage=new Map(savedGuard?[['bowling-update-reload:/bowling/',JSON.stringify(savedGuard)]]:[]);
  let workerRelease=initial,safe=true,focus=false,reloads=0,updates=0,fail=false,now=100000;
  const listen=(name,fn)=>(events[name]??=[]).push(fn);
  const worker={postMessage(_,ports){ports[0].peer.onmessage?.({data:{version:workerRelease}})}};
  const registration={update:async()=>{updates++;if(fail)throw Error('offline')}};
  const c={console,Date:class extends Date{static now(){return now}},AbortController,
    MessageChannel:class{constructor(){this.port1={close(){}};this.port2={peer:this.port1}}},
    setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer},clearTimeout:timer=>{if(timer)timer.cleared=true},setInterval:(fn,ms)=>timers.push({fn,ms,interval:true}),
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    navigator:{onLine:true,serviceWorker:{controller:worker,addEventListener:listen}},
    location:{pathname:'/bowling/',reload(){reloads++}},
    document:{visibilityState:'visible',activeElement:{matches:()=>focus},addEventListener:listen},
    window:{BOWLING_VERSION:initial,BowlingApp:{canApplyUpdate:()=>safe},addEventListener:listen},
    fetch:async(url,options)=>{assert(url.startsWith('./build.json?check='));assert.equal(options.cache,'no-store');if(fail)throw Error('offline');return{ok:true,json:async()=>({version:workerRelease})}}
  };
  vm.runInNewContext(source,c);
  return{c,timers,registration,start:()=>c.window.BowlingUpdates.start(registration),tick,emit:async name=>{for(const fn of events[name]||[])await fn();await tick()},
    version:v=>workerRelease=v,safe:v=>safe=v,focus:v=>focus=v,fail:v=>fail=v,time:()=>now+=10000,
    reloads:()=>reloads,updates:()=>updates};
}
(async()=>{
  let h=harness();h.start();await tick();assert.equal(h.reloads(),0,'First install must not reload');assert.equal(h.updates(),1,'One worker update per check');assert(!h.timers.some(t=>t.ms===2000&&!t.cleared),'No idle update polling');
  const before=h.updates();await h.emit('pageshow');assert.equal(h.updates(),before,'Duplicate resume events are throttled');
  h.time();await h.emit('pageshow');assert(h.updates()>before);
  h.safe(false);h.version('33');await h.emit('controllerchange');assert.equal(h.reloads(),0,'Active draft/save/dialog must survive');assert(h.timers.some(t=>t.ms===2000&&!t.cleared),'Pending update retries after entry is safe');
  h.safe(true);h.focus(true);await h.emit('bowling:rendered');assert.equal(h.reloads(),0,'Focused entry is protected');
  h.focus(false);await h.emit('bowling:rendered');assert.equal(h.reloads(),1);
  await h.emit('controllerchange');assert.equal(h.reloads(),1,'Only one refresh per document');
  h=harness();h.start();await tick();h.c.document.visibilityState='hidden';h.version('33');await h.emit('controllerchange');assert.equal(h.reloads(),0);
  h.c.document.visibilityState='visible';h.time();await h.emit('visibilitychange');assert.equal(h.reloads(),1,'Resume applies installed update');
  h=harness();h.c.navigator.onLine=false;h.start();await tick();assert.equal(h.updates(),0);h.c.navigator.onLine=true;h.fail(true);await h.emit('online');assert.equal(h.reloads(),0,'Network failures cannot reload the offline app');
  h=harness('32',{version:'33',time:100000});h.start();await tick();h.version('33');await h.emit('controllerchange');assert.equal(h.reloads(),0,'Stale cache cannot cause a reload loop');
  assert(h.timers.some(t=>t.ms===300000));
  // Network-only manifest, version handshake, scoped cache cleanup, offline shell.
  const handlers={},puts=[],deleted=[];let claimed=false;
  const cache={match:async()=>new Response('offline shell'),put:async(...x)=>puts.push(x)};
  const sw={URL,Request,Response,importScripts(){},
    self:{BOWLING_VERSION:'32',registration:{scope:'https://example.com/bowling/'},location:{origin:'https://example.com'},addEventListener:(n,f)=>handlers[n]=f,clients:{claim:async()=>claimed=true}},
    caches:{open:async()=>cache,keys:async()=>['bowling-tracker:/bowling/:v31','bowling-tracker:/bowling/:v32','other-app'],delete:async k=>deleted.push(k)},
    fetch:async request=>{assert.equal(request.cache,'no-store');return new Response('{"version":"33"}')}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../service-worker.js'),'utf8'),sw);
  let pending;handlers.activate({waitUntil:p=>pending=p});await pending;assert(claimed);assert.deepEqual(deleted,['bowling-tracker:/bowling/:v31']);
  let version;handlers.message({data:{type:'BOWLING_VERSION'},ports:[{postMessage:v=>version=v.version}]});assert.equal(version,'32');
  handlers.fetch({request:new Request('https://example.com/bowling/build.json?check=1'),respondWith:p=>pending=p});assert.equal(await(await pending).text(),'{"version":"33"}');assert.equal(puts.length,0);
  handlers.fetch({request:new Request('https://example.com/bowling/'),respondWith:p=>pending=p});assert.equal(await(await pending).text(),'offline shell');
  let intercepted=false;handlers.fetch({request:new Request('https://firebase.example/api'),respondWith:()=>intercepted=true});assert.equal(intercepted,false);
  const release={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../version.js'),'utf8'),{self:release});
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname,'../build.json'))).version,release.BOWLING_VERSION);
  console.log('PASS: launch/resume/reconnect/poll checks, idle-only reloads, first-install and loop guards, offline failures, worker handshake, network-only build probe, cache scope, and release version consistency.');
})().catch(e=>{console.error(e);process.exitCode=1});
