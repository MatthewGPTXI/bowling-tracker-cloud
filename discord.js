(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let account = null, revision = 0, busy = false, linked = false;
  let popup = null, popupTimer = null, pendingVersion = 0;
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
  async function request(path, method, user, body) {
    const origin = serviceOrigin();
    if (!origin) throw new Error('Discord setup is not complete yet.');
    const token = await user.getIdToken();
    const response = await fetch(origin + path, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? {'Content-Type':'application/json'} : {}) },
      ...(body ? {body:JSON.stringify(body)} : {}),
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) { let data={}; try {data=await response.json();}catch(_){} throw new Error(typeof data.error==='string' ? data.error : 'Discord linking is unavailable. Please try again later.'); }
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
      render(linked ? `Connected as ${String(result.username || 'Discord user')} · Discord ID ${result.discordUserId}. Group sharing ${result.sharing ? 'on' : 'off'}. Use /bowling sharing in Discord to change it.` : 'No Discord account connected.');
    } catch (error) { if (version === revision) {busy = false; render(error.message);} }
  }
  function connect() {
    if (busy || !account || !serviceOrigin()) return;
    pendingVersion = ++revision;
    popup = window.open(serviceOrigin() + '/discord/connect', 'bowling-discord-link', 'popup,width=520,height=720');
    if (!popup) {render('Allow pop-ups for this app, then tap Connect Discord again.');return;}
    busy = true; render('Complete the connection in the Discord window.');
    clearTimeout(popupTimer);
    popupTimer = setTimeout(() => {if (pendingVersion === revision) {busy=false;render('If the connection window closed, tap Refresh connection or try again.');}},120000);
  }
  window.addEventListener('message', async event => {
    if (event.origin !== serviceOrigin() || event.source !== popup || !account || pendingVersion !== revision) return;
    if (event.data?.type === 'bowling-discord-linked') { clearTimeout(popupTimer); popup?.close(); popup=null; await refresh(); return; }
    if (event.data?.type !== 'bowling-discord-ready' || !/^[a-f0-9]{64}$/.test(event.data.nonce || '')) return;
    const user=account, version=revision;
    try {
      const result=await request('/discord/link/start','POST',user,{nonce:event.data.nonce});
      if (version !== revision || account !== user || !popup || popup.closed) return;
      const url=new URL(result.authorizationUrl);
      if (url.origin !== 'https://discord.com' || url.pathname !== '/oauth2/authorize' || url.searchParams.get('response_type') !== 'code' || url.searchParams.get('scope') !== 'identify' || !url.searchParams.get('state')) throw new Error('The Discord authorization link is invalid.');
      popup.location.href=url.href;
    } catch(error) { if (version===revision) {clearTimeout(popupTimer);busy=false;render(error.message);} }
  });

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
  window.BowlingDiscord = { setAccount(user) { clearTimeout(popupTimer); if (popup) {popup.close();popup=null;} account = user || null; refresh(); } };
  render('Sign in to your bowling account to connect Discord.');
})();
