(() => {
  'use strict';
  const currentVersion = String(window.BOWLING_VERSION);
  let registration, checking = false, pendingVersion = '', reloading = false, lastCheck = 0, retryTimer;
  const guardKey = 'bowling-update-reload:' + location.pathname;

  function workerVersion(worker) {
    return new Promise(resolve => {
      if (!worker) { resolve(''); return; }
      const channel = new MessageChannel();
      const finish = value => { clearTimeout(timer); channel.port1.close(); resolve(value); };
      const timer = setTimeout(() => finish(''), 2000);
      channel.port1.onmessage = event => finish(String(event.data?.version || ''));
      try { worker.postMessage({type: 'BOWLING_VERSION'}, [channel.port2]); } catch (_) { finish(''); }
    });
  }

  async function applyWhenSafe() {
    clearTimeout(retryTimer);
    if (!pendingVersion || reloading || document.visibilityState !== 'visible') return;
    // Only poll for an idle moment while an installed update is waiting.
    retryTimer = setTimeout(applyWhenSafe, 2000);
    if (!window.BowlingApp?.canApplyUpdate?.()) return;
    if (document.activeElement?.matches('input, select, textarea, [contenteditable="true"]')) return;
    // Only reload once the complete new offline release controls this page.
    const version = await workerVersion(navigator.serviceWorker.controller);
    if (version !== pendingVersion || !window.BowlingApp?.canApplyUpdate?.() || reloading) return;
    if (document.visibilityState !== 'visible' || document.activeElement?.matches('input, select, textarea, [contenteditable="true"]')) return;
    try {
      const last = JSON.parse(sessionStorage.getItem(guardKey) || 'null');
      if (last?.version === version && Date.now() - last.time < 60000) return;
      sessionStorage.setItem(guardKey, JSON.stringify({version, time: Date.now()}));
    } catch (_) { /* Storage restrictions must not prevent an update. */ }
    reloading = true;
    clearTimeout(retryTimer);
    window.BowlingUI?.rememberPage();
    location.reload();
  }

  async function inspectController() {
    const version = await workerVersion(navigator.serviceWorker.controller);
    if (version && version !== currentVersion) pendingVersion = version;
    else if (version === currentVersion) pendingVersion = '';
    await applyWhenSafe();
  }

  async function check() {
    if (!registration || checking || navigator.onLine === false || document.visibilityState !== 'visible') return;
    // pageshow and visibilitychange can arrive together on mobile.
    if (Date.now() - lastCheck < 3000) { await applyWhenSafe(); return; }
    checking = true;
    lastCheck = Date.now();
    // updateViaCache: 'none' checks the worker and imported version directly.
    // The worker handshake only permits a reload after all assets are installed.
    try { await registration.update(); } catch (_) {}
    try { await inspectController(); } finally { checking = false; }
  }

  function start(value) {
    if (registration) return;
    registration = value;
    navigator.serviceWorker.addEventListener('controllerchange', inspectController);
    window.addEventListener('pageshow', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('bowling:rendered', applyWhenSafe);
    setInterval(check, 5 * 60 * 1000);
    check();
  }
  window.BowlingUpdates = {start};
})();
