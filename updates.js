(() => {
  'use strict';
  const currentVersion = String(window.BOWLING_VERSION);
  let registration, checking = false, pendingVersion = '', reloading = false, lastCheck = 0;
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
    if (!pendingVersion || reloading || document.visibilityState !== 'visible') return;
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      // The manifest bypasses both the service worker and HTTP caches.
      const response = await fetch('./build.json?check=' + Date.now(), {cache: 'no-store', signal: controller.signal});
      const build = response.ok ? await response.json() : null;
      if (build?.version && String(build.version) !== currentVersion) await registration.update();
    } catch (_) { /* An offline or failed release check leaves the cached app working. */ }
    finally { clearTimeout(timeout); }
    // Also checks on each launch/resume even if the manifest request failed.
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
    setInterval(applyWhenSafe, 2000);
    check();
  }
  window.BowlingUpdates = {start};
})();
