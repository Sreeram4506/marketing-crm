/* ==========================================================================
   api.js — server mode. When the AgencyDesk API is reachable, data lives in
   MongoDB: the app loads what the signed-in user may see, sends only changed
   records (with their version, so simultaneous edits are caught), and polls
   for teammates' updates. Without an API the app runs as a browser-only demo.
   ========================================================================== */

const SYNCED = ['users', 'clients', 'invoices', 'tasks', 'attendance', 'leaves', 'eod'];
const PASSWORD_RULE = 'At least 10 characters, including a number or symbol';

const Api = {
  mode: 'local',
  base: String(window.AGENCYDESK_API || '').replace(/\/$/, ''), // '' = same origin (/api proxied by Vercel)
  token: (() => { try { return localStorage.getItem('agencyDesk.token'); } catch (e) { return null; } })(),
  snapshot: null, pendingActivity: [], saveTimer: null, inFlight: null, dirtyWhileSending: false, pollTimer: null, info: {}, me: null,

  async req(method, path, body, { timeout = 30000, raw = null, headers = {} } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(this.base + '/api' + path, {
        method, signal: ctl.signal,
        headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}), ...headers },
        body: raw || (body ? JSON.stringify(body) : undefined),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401 && json.code === 'AUTH' && this.token) { this.signOut(json.error || 'Please sign in again.'); throw new Error(json.error || 'Signed out'); }
      if (res.status === 403 && json.code === '2FA_REQUIRED') { renderEnroll2fa(true); throw new Error(json.error); }
      if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status, body: json });
      return json;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The server took too long to answer. Check your connection and try again.');
      if (e instanceof TypeError) throw new Error('Can’t reach the server — check your internet connection.');
      throw e;
    } finally { clearTimeout(t); }
  },

  /* Is there an AgencyDesk API behind this page? (Render's free tier can take ~50s to wake) */
  async detect() {
    if (location.protocol === 'file:') return 'local';
    try {
      const res = await fetch(this.base + '/api/health', { signal: AbortSignal.timeout(70000) });
      const j = await res.json().catch(() => null);
      return j && j.app === 'agencydesk' ? 'server' : 'local';
    } catch (e) { return 'local'; }
  },

  setToken(t) { this.token = t; try { t ? localStorage.setItem('agencyDesk.token', t) : localStorage.removeItem('agencyDesk.token'); } catch (e) {} },

  enable() {
    this.mode = 'server';
    // Server is the source of truth: no browser-side invoice generation, no localStorage copy
    Store.runAutomations = () => [];
    Store.reset = () => {};
    Store.load = async () => this.apply(await this.req('GET', '/data'));
    Store.save = () => this.queue();
    const localLog = Store.log.bind(Store);
    Store.log = (action, details, meta = {}) => { localLog(action, details, meta); this.pendingActivity.push({ action, details, ...meta }); };
    window.addEventListener('beforeunload', (e) => { if (this.hasChanges() || this.inFlight) { this.flush(); e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Store.data) this.refresh(); });
    window.addEventListener('online', () => { setSyncState('saving'); this.flush().then(() => this.refresh()); });
    window.addEventListener('offline', () => setSyncState('error'));
  },

  /* Merge server data into the existing objects instead of replacing them: open
     screens keep references to records (the client on a profile, today's
     attendance on My Day…), and those must stay the live copies. */
  apply(data) {
    this.me = data.me;
    const me = data.me;
    delete data.me;
    if (!Store.data || Store.data.session?.userId !== me.id) {
      Store.data = { ...data, session: { userId: me.id } };
    } else {
      const replaceInPlace = (target, src) => { Object.keys(target).forEach((k) => { if (!(k in src)) delete target[k]; }); Object.assign(target, src); };
      SYNCED.forEach((c) => {
        const current = Store.data[c] || (Store.data[c] = []);
        const byId = new Map(current.map((x) => [x.id, x]));
        const merged = (data[c] || []).map((x) => { const ex = byId.get(x.id); if (ex) { replaceInPlace(ex, x); return ex; } return x; });
        current.length = 0;
        current.push(...merged);
      });
      replaceInPlace(Store.data.settings, data.settings);
      Store.data.activity.length = 0;
      Store.data.activity.push(...data.activity);
      Store.data.version = data.version;
    }
    this.snapshot = this.snap(Store.data);
  },
  snap(data) {
    const s = { settings: JSON.stringify(data.settings) };
    SYNCED.forEach((c) => { s[c] = new Map((data[c] || []).map((x) => [x.id, JSON.stringify(x)])); });
    return s;
  },
  diff() {
    const changes = {};
    SYNCED.forEach((c) => {
      const before = this.snapshot[c];
      const upsert = [], seen = new Set();
      (Store.data[c] || []).forEach((x) => { seen.add(x.id); const j = JSON.stringify(x); if (before.get(x.id) !== j) upsert.push(x); });
      const del = [...before.keys()].filter((id) => !seen.has(id));
      if (upsert.length || del.length) changes[c] = { upsert, delete: del };
    });
    const settingsChanged = JSON.stringify(Store.data.settings) !== this.snapshot.settings;
    return { changes, settings: settingsChanged ? Store.data.settings : null };
  },
  hasChanges() { if (!this.snapshot || !Store.data) return false; const d = this.diff(); return Object.keys(d.changes).length || d.settings || this.pendingActivity.length; },

  queue() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.flush(), 250); },
  async flush() {
    clearTimeout(this.saveTimer);
    if (this.inFlight) { this.dirtyWhileSending = true; return this.inFlight; }
    if (!this.hasChanges()) return;
    const { changes, settings } = this.diff();
    const activity = this.pendingActivity.splice(0);
    const state = () => JSON.stringify(SYNCED.map((c) => Store.data[c]).concat([Store.data.settings]));
    const sent = state();
    setSyncState('saving');
    this.inFlight = this.req('POST', '/sync', { changes, settings, activity }).then((res) => {
      const problems = res.rejected || res.conflicts.length || res.invalid.length;
      if (state() === sent || problems) {
        // Take the server's version. If something was refused, this also undoes it on screen.
        const before = JSON.stringify(Store.data);
        this.apply(res.data);
        if (JSON.stringify(Store.data) !== before) rerenderSoon();
      } else {
        // You kept editing while this save was in flight: keep those edits, adopt the new versions, save again
        const byId = Object.fromEntries(SYNCED.map((c) => [c, new Map(res.data[c].map((x) => [x.id, x]))]));
        Object.entries(changes).forEach(([c, ch]) => ch.upsert.forEach((x) => { const local = Store.data[c].find((y) => y.id === x.id); const srv = byId[c].get(x.id); if (local && srv) local._rev = srv._rev; }));
        this.snapshot = this.snap(res.data);
        this.dirtyWhileSending = true;
      }
      if (res.conflicts.length || res.invalid.length || res.rejected) document.querySelectorAll('#toasts .toast-ok').forEach((t) => t.remove()); // the optimistic “Saved” was wrong
      if (res.conflicts.length) toast(`Someone else changed ${res.conflicts.length === 1 ? 'this record' : res.conflicts.length + ' records'} at the same time. You’re now seeing their version — please redo your change.`, 'warn');
      else if (res.invalid.length) toast(`Not saved: ${res.invalid[0].error}`, 'error');
      else if (res.rejected) toast(`${res.rejected} change(s) weren’t allowed for your role and were undone.`, 'warn');
      setSyncState('saved');
    }).catch((e) => {
      this.pendingActivity.unshift(...activity);
      setSyncState('error');
      toast('Couldn’t save to the server: ' + e.message + ' Your changes will be retried.', 'error');
      if (e.status === 409) this.refresh(true);
      else setTimeout(() => this.queue(), 15000); // retry automatically
    }).finally(() => {
      this.inFlight = null;
      if (this.dirtyWhileSending) { this.dirtyWhileSending = false; this.queue(); }
    });
    return this.inFlight;
  },

  /* Pull teammates' changes. Skipped while you have unsaved edits or a dialog open. */
  async refresh(force = false) {
    if (this.inFlight || (!force && (this.hasChanges() || Modal.el))) return;
    try {
      const data = await this.req('GET', '/data');
      if (this.inFlight || (!force && this.hasChanges())) return;
      const before = JSON.stringify(Store.data);
      this.apply(data);
      if (JSON.stringify(Store.data) !== before) rerenderSoon();
      setSyncState('saved');
    } catch (e) { setSyncState('error'); }
  },
  startPolling() { clearInterval(this.pollTimer); this.pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && Store.currentUser()) this.refresh(); }, 60000); },

  async signIn(token) {
    this.setToken(token);
    const me = await this.req('GET', '/auth/me');
    if (me.mustEnroll2fa) return renderEnroll2fa(true);
    await Store.load();
    this.startPolling();
    if (!location.hash || location.hash === '#' || location.hash.startsWith('#/reset')) location.hash = '#/dashboard';
    Router.render();
  },
  async signOut(message) {
    if (this.hasChanges()) { try { await this.flush(); } catch (e) {} }
    this.setToken(null);
    clearInterval(this.pollTimer);
    Store.data = null; this.snapshot = null; this.pendingActivity = []; this.me = null;
    Modal.close();
    if (message) toast(message, 'warn');
    renderLogin();
  },

  /* ---------- Files ---------- */
  async upload(file, scope = 'general') {
    const q = `?name=${encodeURIComponent(file.name)}&scope=${scope}`;
    return this.req('POST', '/files' + q, null, { raw: file, headers: { 'Content-Type': file.type || 'application/octet-stream' }, timeout: 120000 });
  },
  async openFile(id) {
    const win = window.open('', '_blank'); // open synchronously so pop-up blockers allow it
    try { const r = await this.req('GET', `/files/${id}/link`); if (win) win.location = this.base + r.url; else location.href = this.base + r.url; }
    catch (e) { if (win) win.close(); toast(e.message, 'error'); }
  },
};

/* Re-render after background changes, but never while someone is typing */
function rerenderSoon() {
  const busy = () => Modal.el || (document.activeElement && document.activeElement.closest && document.activeElement.closest('#main form, #main input, #main textarea, #main select'));
  if (!Store.currentUser()) return;
  if (!busy()) return Router.render();
  const t = setInterval(() => { if (!busy()) { clearInterval(t); Router.render(); } }, 1500);
}
function setSyncState(state) {
  const el = document.querySelector('.sync-state');
  if (!el) return;
  el.className = 'sync-state ' + state;
  el.textContent = { saving: 'Saving…', saved: 'All changes saved', error: navigator.onLine === false ? 'Offline — will save when back online' : 'Not saved — retrying' }[state];
}

/* ---------- Sign-in screens ---------- */
function authCard(title, subtitle, inner, wide = false) {
  $('#app').innerHTML = `<div class="login"><div class="login-card ${wide ? 'wide' : ''}">
    <div class="brand big"><span class="brand-mark">${icon('sparkle')}</span><span>${esc(Api.info.agencyName || 'AgencyDesk')}</span></div>
    <h1>${esc(title)}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}${inner}</div></div>`;
}
function bindForm(sel, handler, busyLabel) {
  const f = $(sel);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('.form-error', f), btn = $('button[type=submit]', f), label = btn.textContent;
    btn.disabled = true; btn.textContent = busyLabel; err.hidden = true;
    try { await handler(formData(f), f); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
    finally { if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = label; } }
  };
}

async function renderServerLogin() {
  try { Api.info = await Api.req('GET', '/setup-status'); } catch (e) { Api.info = { agencyName: 'AgencyDesk' }; }
  if (Api.info.needsSetup) return renderSetup();
  const m = location.hash.match(/^#\/reset\?(.*)$/);
  if (m) return renderReset(new URLSearchParams(m[1]));
  authCard('Sign in', 'Use the email and password for your AgencyDesk account.', `
    <form id="loginForm" class="stack-sm">
      ${field('Work email', inputEl('email', '', { type: 'email', required: true, attrs: 'autocomplete="username"' }))}
      ${field('Password', inputEl('password', '', { type: 'password', required: true, attrs: 'autocomplete="current-password"' }))}
      <p class="form-error" hidden></p>
      <button class="btn btn-primary btn-lg" type="submit">Sign in</button>
    </form>
    <p class="fine">${Api.info.emailEnabled ? '<button class="linkish" id="forgot">Forgot your password?</button>' : 'Forgot your password? Ask an admin to set a new one in Team & HR.'}</p>`);
  bindForm('#loginForm', async (d) => {
    const r = await Api.req('POST', '/auth/login', { email: d.email, password: d.password });
    if (r.needs2fa) return render2faStep(r.challenge);
    await Api.signIn(r.token);
  }, 'Signing in…');
  if ($('#forgot')) $('#forgot').onclick = renderForgot;
}
function render2faStep(challenge) {
  authCard('Two-factor check', 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.', `
    <form id="tfaForm" class="stack-sm">${field('Code', inputEl('code', '', { required: true, attrs: 'autocomplete="one-time-code" inputmode="numeric" autofocus' }))}
      <p class="form-error" hidden></p><button class="btn btn-primary btn-lg" type="submit">Verify</button></form>
    <p class="fine"><button class="linkish" id="back">Back to sign in</button></p>`);
  bindForm('#tfaForm', async (d) => {
    const r = await Api.req('POST', '/auth/2fa/verify', { challenge, code: d.code });
    if (r.recoveryCodesLeft !== undefined && r.recoveryCodesLeft <= 2) toast(`Only ${r.recoveryCodesLeft} recovery code(s) left — set up 2FA again to get new ones.`, 'warn');
    await Api.signIn(r.token);
  }, 'Checking…');
  $('#back').onclick = renderServerLogin;
}
function renderForgot() {
  authCard('Reset your password', 'We’ll email you a link to choose a new password.', `
    <form id="fgForm" class="stack-sm">${field('Work email', inputEl('email', '', { type: 'email', required: true }))}<p class="form-error" hidden></p>
    <button class="btn btn-primary btn-lg" type="submit">Email me a link</button></form><p class="fine"><button class="linkish" id="back">Back to sign in</button></p>`);
  bindForm('#fgForm', async (d) => {
    const r = await Api.req('POST', '/auth/forgot', { email: d.email });
    authCard('Check your email', esc(r.message) + ' The link works for 30 minutes.', '<p class="fine"><button class="linkish" id="back">Back to sign in</button></p>');
    $('#back').onclick = renderServerLogin;
  }, 'Sending…');
  $('#back').onclick = renderServerLogin;
}
function renderReset(params) {
  authCard('Choose a password', `For ${esc(params.get('email') || '')}. ${PASSWORD_RULE}.`, `
    <form id="rsForm" class="stack-sm">${field('New password', inputEl('password', '', { type: 'password', required: true, attrs: 'autocomplete="new-password"' }))}
      ${field('Repeat it', inputEl('again', '', { type: 'password', required: true, attrs: 'autocomplete="new-password"' }))}
      <p class="form-error" hidden></p><button class="btn btn-primary btn-lg" type="submit">Save password</button></form>`);
  bindForm('#rsForm', async (d) => {
    if (d.password !== d.again) throw new Error('The two passwords don’t match');
    const r = await Api.req('POST', '/auth/reset', { email: params.get('email'), token: params.get('token'), password: d.password });
    history.replaceState(null, '', location.pathname + '#/dashboard');
    if (r.needs2fa) return render2faStep(r.challenge);
    await Api.signIn(r.token);
    toast('Password saved');
  }, 'Saving…');
}
function renderSetup() {
  authCard('Set up your workspace', 'This runs once. You’ll be the Super Admin.', `
    <form id="setupForm" class="stack-sm">
      ${field('Agency name', inputEl('agencyName', '', { required: true, placeholder: 'e.g. BrightPixel Digital' }))}
      ${field('Your name', inputEl('name', '', { required: true }))}
      ${field('Your work email', inputEl('email', '', { type: 'email', required: true, attrs: 'autocomplete="username"' }))}
      ${field('Password', inputEl('password', '', { type: 'password', required: true, attrs: 'autocomplete="new-password"' }), { hint: PASSWORD_RULE })}
      <label class="check"><input type="checkbox" name="sampleData"> Add sample clients, staff and history to explore (you can’t remove them in bulk later)</label>
      <div id="demoPw" hidden>${field('Password for the 9 sample staff accounts', inputEl('demoPassword', '', { type: 'password', attrs: 'autocomplete="new-password"' }), { hint: 'Optional. Leave blank to set their passwords later in Team & HR.' })}</div>
      <p class="form-error" hidden></p>
      <button class="btn btn-primary btn-lg" type="submit">Create workspace</button>
    </form>`, true);
  const f = $('#setupForm');
  f.sampleData.onchange = () => ($('#demoPw').hidden = !f.sampleData.checked);
  bindForm('#setupForm', async (d) => {
    const r = await Api.req('POST', '/setup', { agencyName: d.agencyName.trim(), name: d.name.trim(), email: d.email.trim(), password: d.password, sampleData: !!d.sampleData, demoPassword: d.sampleData ? d.demoPassword : '' });
    await Api.signIn(r.token);
    toast('Workspace created');
  }, 'Creating…');
}

/* ---------- Two-factor enrolment (forced by role policy, or from Account security) ---------- */
let _qrLoading = null;
function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  return (_qrLoading = _qrLoading || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    s.onload = () => resolve(window.qrcode); s.onerror = () => { _qrLoading = null; reject(new Error('offline')); };
    document.head.appendChild(s);
  }));
}
async function twoFactorSetupHtml() {
  const r = await Api.req('POST', '/auth/2fa/setup');
  let qr = '';
  try { const q = (await loadQr())(0, 'M'); q.addData(r.otpauth); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) {}
  return `<ol class="steps plain"><li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or 1Password).</li>
    <li>Scan this code${qr ? '' : ' (couldn’t load the QR image — enter the key manually)'}:<div class="qr">${qr}</div>
      <span class="muted small">Or enter this key: <code class="secret">${esc(r.secret.replace(/(.{4})/g, '$1 ').trim())}</code></span></li>
    <li>Type the 6-digit code it shows:</li></ol>`;
}
function recoveryCodesHtml(codes) {
  return `<div class="alert alert-warn">${icon('alert')} Save these recovery codes somewhere safe. Each works once if you lose your phone. They won’t be shown again.</div>
    <div class="codes">${codes.map((c) => `<code>${esc(c)}</code>`).join('')}</div>`;
}
async function renderEnroll2fa(forced) {
  if (forced) {
    authCard('Turn on two-factor authentication', 'Your role requires a second step at sign-in to protect client and payment data.', `<div id="tfaBody"><div class="spinner"></div></div>`, true);
    try {
      $('#tfaBody').innerHTML = `${await twoFactorSetupHtml()}<form id="enForm" class="stack-sm">${field('Code', inputEl('code', '', { required: true, attrs: 'inputmode="numeric" autocomplete="one-time-code"' }))}<p class="form-error" hidden></p>
        <button class="btn btn-primary btn-lg" type="submit">Turn on 2FA</button></form><p class="fine"><button class="linkish" id="back">Sign out</button></p>`;
    } catch (e) { $('#tfaBody').innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    $('#back').onclick = () => Api.signOut();
    bindForm('#enForm', async (d) => {
      const r = await Api.req('POST', '/auth/2fa/enable', { code: d.code });
      Api.setToken(r.token);
      authCard('Two-factor is on', '', `${recoveryCodesHtml(r.recoveryCodes)}<button class="btn btn-primary btn-lg" id="cont">I’ve saved them — continue</button>`, true);
      $('#cont').onclick = () => Api.signIn(r.token);
    }, 'Checking…');
  }
}

/* ---------- Account security (sidebar shield button) ---------- */
function openSecurity() {
  const me = Api.me || {};
  const m = Modal.open({ title: 'Account security', size: 'lg', body: `
    <section class="sec-block"><h3>Password</h3>
      <form id="pwForm" class="form-grid">
        ${field('Current password', inputEl('current', '', { type: 'password', attrs: 'autocomplete="current-password"' }))}
        ${field('New password', inputEl('next', '', { type: 'password', attrs: 'autocomplete="new-password"' }), { hint: PASSWORD_RULE })}
        <p class="form-error full" hidden></p><div class="full"><button class="btn btn-primary" type="submit">Change password</button> <span class="muted small">Signs you out on your other devices.</span></div></form></section>
    <section class="sec-block"><h3>Two-factor authentication <span id="tfaBadge">${me.twoFactor ? badge('On', 'good') : badge('Off', 'neutral')}</span></h3>
      <div id="tfaArea">${me.twoFactor
        ? `<p class="muted small">You’re asked for a code from your authenticator app at sign-in.</p><form id="offForm" class="form-grid">${field('Password', inputEl('password', '', { type: 'password' }))}${field('Current code', inputEl('code', '', { attrs: 'inputmode="numeric"' }))}<p class="form-error full" hidden></p><div class="full"><button class="btn" type="submit">Turn off 2FA</button></div></form>`
        : '<p class="muted small">Adds a 6-digit code from your phone at sign-in, so a stolen password isn’t enough.</p><button class="btn btn-primary" id="startTfa">Set up 2FA</button>'}</div></section>
    <section class="sec-block"><h3>Sessions</h3><p class="muted small">Lost a laptop or signed in on a shared computer? End every session, including this one.</p>
      <button class="btn btn-ghost-danger" id="logoutAll">${icon('logout')}Sign out everywhere</button></section>` });
  bindForm('#pwForm', async (d) => { const r = await Api.req('POST', '/auth/password', d); Api.setToken(r.token); Modal.close(); toast('Password changed — other devices were signed out'); }, 'Saving…');
  if ($('#offForm', m)) bindForm('#offForm', async (d) => { const r = await Api.req('POST', '/auth/2fa/disable', d); Api.setToken(r.token); Api.me.twoFactor = false; Modal.close(); toast('Two-factor authentication is off'); }, 'Saving…');
  if ($('#startTfa', m)) $('#startTfa', m).onclick = async () => {
    const area = $('#tfaArea', m);
    try { area.innerHTML = `${await twoFactorSetupHtml()}<form id="enForm" class="form-grid">${field('Code', inputEl('code', '', { attrs: 'inputmode="numeric" autocomplete="one-time-code"' }))}<p class="form-error full" hidden></p><div class="full"><button class="btn btn-primary" type="submit">Turn on 2FA</button></div></form>`; }
    catch (e) { toast(e.message, 'error'); return; }
    bindForm('#enForm', async (d) => { const r = await Api.req('POST', '/auth/2fa/enable', { code: d.code }); Api.setToken(r.token); Api.me.twoFactor = true; area.innerHTML = recoveryCodesHtml(r.recoveryCodes); $('#tfaBadge', m).innerHTML = badge('On', 'good'); toast('Two-factor authentication is on'); }, 'Checking…');
  };
  $('#logoutAll', m).onclick = async () => {
    if (!(await confirmDialog('Sign out everywhere?', 'Every device signed in to your account, including this one, will need to sign in again.', 'Sign out everywhere', true))) return;
    try { await Api.req('POST', '/auth/logout-all'); } catch (e) {}
    Api.signOut('You were signed out everywhere.');
  };
}

function bootScreen(text) {
  $('#app').innerHTML = `<div class="login"><div class="login-card boot"><div class="brand big"><span class="brand-mark">${icon('sparkle')}</span><span>AgencyDesk</span></div><div class="spinner"></div><p class="muted">${esc(text)}</p></div></div>`;
}
