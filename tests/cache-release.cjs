const fs = require('fs'), vm = require('vm'), assert = require('assert');
(async () => {
  const handlers = {}, requests = [];
  const worker = {
    URL,
    Request: class { constructor(url, options) { this.url = url; this.cache = options.cache; } },
    self: { BOWLING_VERSION: '30.1', registration: {scope:'https://example.com/bowling/'}, addEventListener:(name,fn)=>handlers[name]=fn, skipWaiting(){} },
    importScripts(){},
    caches: {open:async()=>({addAll:async values=>requests.push(...values)})}
  };
  vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../service-worker.js'),'utf8'),worker);
  let installation;
  handlers.install({waitUntil:promise=>installation=promise});
  await installation;
  assert(requests.some(request=>request.url==='./profile.js'));
  assert(requests.some(request=>request.url==='./app.js'));
  assert(requests.some(request=>request.url==='./ui.js'),'Modal and navigation support must work offline');
  assert(requests.every(request=>request.cache==='reload'),'Release installation must bypass stale HTTP-cached assets');
  console.log('PASS: release installation refreshes every offline asset instead of reusing stale HTTP files.');
})().catch(error=>{console.error(error);process.exitCode=1});
