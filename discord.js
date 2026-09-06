(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let account = null, revision = 0, busy = false, linked = false;
  function serviceOrigin() {
    try {
      const url = new URL(window.BOWLING_DISCORD_CONFIG?.serviceUrl || '');
      return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : '';
    } catch (_) { return ''; }
  }
  function render(message) {
    $('discordLinkStatus').textContent = message;
    $('connectDiscordBtn').hidden = linked;
    $('disconnectDiscordBtn').hidden = !linked;
    $('connectDiscordBtn').disabled = busy || !account || !serviceOrigin();
    $('disconnectDiscordBtn').disabled = busy || !account || !serviceOrigin();
  }
  async function request(path, method, user) {
    const origin = serviceOrigin();
    if (!origin) throw new Error('Discord setup is not complete yet.');
    const token = await user.getIdToken();
    const response = await fetch(origin + path, {
      method, headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Please sign in again to manage Discord linking.' : 'Discord linking is unavailable. Please try again later.');
    return response.status === 204 ? {} : response.json();
  }
  async function refresh() {
    const user = account, version = ++revision;
    linked = false; busy = false;
    if (!user) { render('Sign in to your bowling account to connect Discord.'); return; }
    if (!serviceOrigin()) { render('Discord linking is coming next. Connection will be enabled when the bot setup is complete.'); return; }
    busy = true; render('Checking Discord connection…');
    try {
      const result = await request('/discord/link', 'GET', user);
      if (version !== revision || account !== user) return;
      linked = result.linked === true && typeof result.discordUserId === 'string' && /^\d{17,20}$/.test(result.discordUserId);
      busy = false;
      render(linked ? `Connected as ${String(result.username || 'Discord user')} · Discord ID ${result.discordUserId}` : 'No Discord account connected.');
    } catch (error) { if (version === revision) {busy = false; render(error.message);} }
  }
  async function connect() {
    if (busy || !account || !serviceOrigin()) return;
    const user = account, version = ++revision; busy = true; render('Opening Discord authorization…');
    try {
      const result = await request('/discord/link/start', 'POST', user);
      if (version !== revision || account !== user) return;
      const url = new URL(result.authorizationUrl);
      if (url.origin !== 'https://discord.com' || url.pathname !== '/oauth2/authorize' || url.searchParams.get('response_type') !== 'code' || url.searchParams.get('scope') !== 'identify' || !url.searchParams.get('state')) throw new Error('The Discord authorization link is invalid.');
      // Existing pagehide handlers persist unfinished entries before navigating.
      window.location.assign(url.href);
      busy = false; render('Complete authorization in Discord, then return here.');
    } catch (error) { if (version === revision) {busy = false; render(error.message);} }
  }
  async function disconnect() {
    if (busy || !account || !linked || !window.confirm('Disconnect Discord from this bowling account? Your bowling history will stay saved.')) return;
    const user = account, version = ++revision; busy = true; render('Disconnecting Discord…');
    try {
      await request('/discord/link', 'DELETE', user);
      if (version !== revision || account !== user) return;
      linked = false; busy = false; render('Discord disconnected.');
    } catch (error) { if (version === revision) {busy = false; render(error.message);} }
  }
  $('connectDiscordBtn').addEventListener('click', connect);
  $('disconnectDiscordBtn').addEventListener('click', disconnect);
  $('refreshDiscordBtn').addEventListener('click', refresh);
  window.addEventListener('focus', () => { if (!busy && account && serviceOrigin()) refresh(); });
  window.BowlingDiscord = { setAccount(user) { account = user || null; refresh(); } };
  render('Sign in to your bowling account to connect Discord.');
})();
