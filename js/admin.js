/* ==========================================================================
   admin.js — audit trail, settings, backup/restore, app start
   ========================================================================== */

const actState = { q: '', user: '', type: '' };
Views.activity = function (main) {
  const st = actState;
  const u = Store.currentUser();
  const ids = Perm.visibleClientIds();
  const base = Store.data.activity.filter((a) => u.role === 'admin' || (a.clientId && ids.has(a.clientId)) || a.userId === u.id);
  const broken = u.role === 'admin' ? verifyAudit(Store.data.activity) : -1;
  main.innerHTML = setTitle('<h1>Audit trail</h1><p class="muted">Every status change, quota edit, approval and payment — who, what, when. Entries can’t be edited or deleted in the app.</p>', `<button class="btn btn-sm" id="expAct">${icon('download')}Export</button>`) + `
    ${u.role === 'admin' ? (broken === -1 ? `<div class="alert alert-good">${icon('shield')} Integrity check passed — all ${Store.data.activity.length} entries are hash-chained and unmodified.</div>` : `<div class="alert alert-bad">${icon('alert')} Integrity check failed at entry from ${fmtDateTime(Store.data.activity[broken].ts)} — the log was altered outside the app.</div>`) : ''}
    <div class="toolbar"><div class="search">${icon('search')}<input id="aq" type="search" placeholder="Search…" value="${esc(st.q)}" aria-label="Search audit trail"></div>
      ${selectEl('aUser', [{ value: 'system', label: 'System (automatic)' }, ...userOptions()], st.user, { placeholder: 'Everyone', attrs: 'aria-label="Person"' })}
      ${selectEl('aType', [['client', 'Clients & quotas'], ['task', 'Tasks & approvals'], ['payment', 'Billing'], ['attendance', 'Attendance'], ['leave', 'Leave'], ['employee', 'Employees']].map(([value, label]) => ({ value, label })), st.type, { placeholder: 'All areas', attrs: 'aria-label="Area"' })}
    </div><section class="card flush" id="actList"></section>`;
  const filtered = () => base.filter((a) => (!st.user || a.userId === st.user) && (!st.type || a.entity === st.type) && (!st.q || (a.userName + ' ' + a.action + ' ' + a.details).toLowerCase().includes(st.q.toLowerCase())));
  const draw = () => {
    const list = filtered().slice(0, 400);
    $('#actList').innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Who</th><th>What</th><th class="hide-sm">Details</th><th class="hide-sm">Hash</th></tr></thead><tbody>
      ${list.map((a) => `<tr><td class="nowrap" title="${new Date(a.ts).toLocaleString('en-IN')}">${fmtDateTime(a.ts)}</td><td class="nowrap">${a.userId === 'system' ? '<span class="muted">System</span>' : esc(a.userName)}</td>
        <td><b>${esc(a.action)}</b><div class="muted small show-sm">${esc(a.details)}</div></td><td class="hide-sm">${esc(a.details)}</td><td class="hide-sm"><code class="dim small">${esc(a.hash)}</code></td></tr>`).join('')}</tbody></table></div>` : emptyState('No matching entries');
  };
  draw();
  $('#aq').oninput = (e) => { st.q = e.target.value; draw(); };
  $('[name=aUser]', main).onchange = (e) => { st.user = e.target.value; draw(); };
  $('[name=aType]', main).onchange = (e) => { st.type = e.target.value; draw(); };
  $('#expAct').onclick = () => exportExcel([['Date & time', 'User', 'Action', 'Details', 'Area', 'Hash', 'Previous hash'], ...filtered().map((a) => [new Date(a.ts).toLocaleString('en-IN'), a.userName, a.action, a.details, a.entity, a.hash, a.prev])], 'audit-trail', 'Audit');
};

Views.settings = function (main) {
  const s = Store.settings;
  main.innerHTML = setTitle('<h1>Settings</h1><p class="muted">Agency details, billing, attendance rules and automation</p>') + `
    <form id="sForm"><section class="card"><div class="form-grid">
      <h3 class="full form-section">Agency (shown on invoices, slips and reminders)</h3>
      ${field('Agency name', inputEl('agencyName', s.agencyName))}${field('GSTIN', inputEl('gstin', s.gstin, { attrs: 'style="text-transform:uppercase" maxlength="15"' }), { hint: 'First 2 digits = your state code' })}
      ${field('Email', inputEl('agencyEmail', s.agencyEmail, { type: 'email' }))}${field('Phone', inputEl('agencyPhone', s.agencyPhone))}
      ${field('Address', textareaEl('agencyAddress', s.agencyAddress, { rows: 2 }), { full: true })}
      <h3 class="full form-section">Billing</h3>
      ${field('GST rate (%)', inputEl('gstRate', s.gstRate, { type: 'number', attrs: 'min="0" max="28"' }))}${field('SAC code', inputEl('sac', s.sac), { hint: '998361 = advertising services' })}
      ${field('Invoice prefix', inputEl('invoicePrefix', s.invoicePrefix), { hint: 'e.g. BPD → BPD/26-09/0001' })}${field('Days to pay (advance / milestone 1)', inputEl('dueDays', s.dueDays, { type: 'number', attrs: 'min="0" max="60"' }))}
      ${field('UPI ID', inputEl('upiId', s.upiId))}${field('Bank details', inputEl('bankDetails', s.bankDetails))}
      <h3 class="full form-section">Production</h3>
      ${field('Default client revisions per task', inputEl('maxRevisions', s.maxRevisions, { type: 'number', attrs: 'min="0" max="10"' }), { hint: 'More than this prompts an extra-billable flag' })}
      ${field('Overloaded at (open tasks per person)', inputEl('overloadThreshold', s.overloadThreshold, { type: 'number', attrs: 'min="1" max="50"' }))}
      <h3 class="full form-section">Attendance</h3>
      ${field('Work starts', inputEl('workStart', s.workStart, { type: 'time' }))}${field('Work ends', inputEl('workEnd', s.workEnd, { type: 'time' }))}
      ${field('Grace period before “late” (minutes)', inputEl('graceMinutes', s.graceMinutes, { type: 'number', attrs: 'min="0" max="120"' }))}${field('Half-day if active hours below', inputEl('halfDayHours', s.halfDayHours, { type: 'number', attrs: 'min="1" max="8" step="0.5"' }))}
      <div class="field full"><span class="field-label">Weekly off</span><div class="checks">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<label class="check pill"><input type="checkbox" name="weekOff" value="${i}" ${(s.weekOff || []).includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
      <label class="check full"><input type="checkbox" name="captureIp" ${s.captureIp ? 'checked' : ''}> Capture public IP address on clock-in (uses the free api.ipify.org service)</label>
      <label class="check full"><input type="checkbox" name="pfEnabled" ${s.pfEnabled ? 'checked' : ''}> Deduct PF (12% of basic) on salary slips</label>
      <h3 class="full form-section">Automated payment reminders</h3>
      ${field('Webhook URL', inputEl('webhookUrl', s.webhookUrl, { type: 'url', placeholder: 'https://hooks.zapier.com/… or your Gupshup / Twilio relay' }), { full: true, hint: 'We POST JSON with the invoice, contact and ready-to-send WhatsApp + email text. Your automation tool sends the message.' })}
      <label class="check full"><input type="checkbox" name="autoWebhook" ${s.autoWebhook ? 'checked' : ''}> ${Api.mode === 'server' ? 'Send due reminders automatically (the server checks every hour and on each cron call)' : 'Send due reminders automatically when anyone opens the app'}</label>
      ${Api.mode === 'server' ? `<h3 class="full form-section">Email & security</h3>
      <p class="full muted small">Email: ${Api.info.emailEnabled ? '<b class="text-good">connected</b>' : '<b class="text-warn">not set up</b> — add RESEND_API_KEY, EMAIL_FROM and APP_URL on the server to enable invites, password resets and emailed reminders'}.</p>
      <label class="check full"><input type="checkbox" name="emailReminders" ${s.emailReminders ? 'checked' : ''} ${Api.info.emailEnabled ? '' : 'disabled'}> Email payment reminders directly to clients (3 days before and when overdue)</label>
      <label class="check full"><input type="checkbox" name="notifyLeave" ${s.notifyLeave !== false ? 'checked' : ''} ${Api.info.emailEnabled ? '' : 'disabled'}> Email managers about leave requests, and staff about decisions</label>
      <h3 class="full form-section">AI co-founder</h3>
      <p class="full muted small">Status: ${Api.info.aiConfigured ? (s.aiDisabled ? '<b class="text-warn">switched off</b>' : '<b class="text-good">connected</b>') : '<b class="text-warn">not set up</b> — add OPENAI_API_KEY on the server'}. Team members can talk or type to it (Ctrl + J). It reviews the business, flags risks, gives a daily briefing and remembers your goals; it acts with each person’s own permissions and asks before money, new clients or leave decisions. Every action is in the audit trail.</p>
      <label class="check full"><input type="checkbox" name="aiOn" ${s.aiDisabled ? '' : 'checked'}> Turn on the AI co-founder for the team</label>
      <div class="field full"><span class="field-label">Require two-factor authentication for</span><div class="checks">${Object.entries(ROLES).map(([k, r]) => `<label class="check pill"><input type="checkbox" name="require2fa" value="${k}" ${(s.require2fa || []).includes(k) ? 'checked' : ''}> ${esc(r.label)}</label>`).join('')}</div>
        <span class="field-hint">People in these roles must set up an authenticator app at their next sign-in. Recommended: Super Admin and Finance.</span></div>` : ''}
      <div class="full row-actions"><button class="btn btn-primary" type="submit">Save settings</button>${s.webhookUrl ? `<button class="btn" type="button" id="testHook">${icon('send')}Send test</button>` : ''}</div>
    </div></section></form>
    ${Api.mode === 'server' && Api.info.aiConfigured && !s.aiDisabled ? '<section class="card" id="aiMemory"><div class="card-head"><h2>What the co-founder remembers</h2></div><p class="muted small">Loading…</p></section>' : ''}
    ${Api.mode === 'server' ? `<section class="card"><div class="card-head"><h2>Data</h2></div><p class="muted small">Data is stored in MongoDB and shared by the whole team. Download a JSON export any time; for full restores use your MongoDB Atlas backups.</p>
      <div class="row-actions"><button class="btn" id="exportAll">${icon('download')}Download export</button></div></section>` : `<section class="card"><div class="card-head"><h2>Data</h2></div><p class="muted small">Demo mode: everything is stored in this browser. Download a backup regularly — it’s also how you move data to another computer.</p>
      <div class="row-actions"><button class="btn" id="backup">${icon('download')}Download backup</button>
        <label class="btn">${icon('restore')}Restore backup<input type="file" id="restore" accept=".json,application/json" hidden></label>
        <button class="btn btn-ghost-danger" id="resetData">${icon('trash')}Reset to sample data</button></div></section>`}`;
  if ($('#exportAll')) $('#exportAll').onclick = async () => { try { const d = await Api.req('GET', '/export', null, { timeout: 60000 }); downloadBlob(JSON.stringify(d, null, 2), `agencydesk-export-${todayISO()}.json`, 'application/json'); } catch (e) { toast(e.message, 'error'); } };
  bindSettingsForm(s);
  if ($('#aiMemory')) renderAiMemory($('#aiMemory'));
  if (Api.mode === 'server') return;
  $('#backup').onclick = () => downloadBlob(JSON.stringify(Store.data, null, 2), `agencydesk-backup-${todayISO()}.json`, 'application/json');
  $('#restore').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.version !== DATA_VERSION || !data.clients || !data.invoices || !data.users) throw new Error('Not an AgencyDesk backup');
      if (!(await confirmDialog('Restore backup?', `This replaces ALL current data with “${file.name}”.`, 'Restore', true))) return;
      const me = Store.currentUser().id;
      Store.data = data; Store.data.session = { userId: Store.user(me) ? me : null };
      Store.runAutomations(); Store.log('Backup restored', file.name); Store.save(); toast('Backup restored'); Router.render();
    } catch (err) { toast('Could not read that file: ' + err.message, 'error'); }
  };
  $('#resetData').onclick = async () => {
    if (!(await confirmDialog('Reset all data?', 'Everything is replaced with sample data. Download a backup first if you need it.', 'Reset', true))) return;
    Store.reset(); Store.data.session.userId = 'u_admin'; Store.save(); toast('Sample data restored'); Router.render();
  };
};

function bindSettingsForm(s) {
  $('#sForm').onsubmit = (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const num = (k) => Number(d[k]) || 0;
    Object.assign(s, { agencyName: d.agencyName.trim(), gstin: d.gstin.trim().toUpperCase(), agencyEmail: d.agencyEmail.trim(), agencyPhone: d.agencyPhone.trim(), agencyAddress: d.agencyAddress.trim(),
      gstRate: num('gstRate'), sac: d.sac.trim(), invoicePrefix: d.invoicePrefix.trim() || 'INV', dueDays: num('dueDays'), upiId: d.upiId.trim(), bankDetails: d.bankDetails.trim(),
      maxRevisions: num('maxRevisions'), overloadThreshold: Math.max(1, num('overloadThreshold')), workStart: d.workStart, workEnd: d.workEnd, graceMinutes: num('graceMinutes'), halfDayHours: Number(d.halfDayHours) || 4.5,
      weekOff: [].concat(d.weekOff || []).map(Number), captureIp: !!d.captureIp, pfEnabled: !!d.pfEnabled, webhookUrl: d.webhookUrl.trim(), autoWebhook: !!d.autoWebhook });
    if (Api.mode === 'server') { Api.info.aiEnabled = !!Api.info.aiConfigured && !!d.aiOn; if (!d.aiOn && typeof Assistant !== 'undefined') Assistant.unmount(); }
    if (Api.mode === 'server') Object.assign(s, { aiDisabled: !d.aiOn, emailReminders: Api.info.emailEnabled ? !!d.emailReminders : !!s.emailReminders, notifyLeave: Api.info.emailEnabled ? !!d.notifyLeave : s.notifyLeave !== false, require2fa: [].concat(d.require2fa || []) });
    Store.log('Settings updated', 'Agency, billing, attendance or automation settings changed');
    Store.save(); toast('Settings saved'); Router.render();
  };
  if ($('#testHook')) $('#testHook').onclick = async () => {
    if (Api.mode === 'server') { try { const r = await Api.req('POST', '/webhook/test'); toast(r.ok ? 'Test sent — check your automation tool' : `Webhook failed: ${r.error || 'status ' + r.status}`, r.ok ? 'ok' : 'warn'); } catch (e) { toast(e.message, 'error'); } return; }
    try { const r = await fetch(s.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'test', from: s.agencyName, at: new Date().toISOString() }) }); toast(r.ok ? 'Test sent — check your automation tool' : `Webhook replied ${r.status}`, r.ok ? 'ok' : 'warn'); }
    catch (e) { toast('Could not reach the webhook (network or CORS). Check the URL.', 'error'); }
  };
}

/* ---------- Start ---------- */
function tick() {
  if (Api.mode === 'server') return []; // the server runs invoices and reminders
  const made = Store.runAutomations();
  Store.save();
  if (made.length && Store.currentUser()) toast(`${made.length} new invoice(s) generated`);
  const s = Store.settings;
  if (s.webhookUrl && s.autoWebhook && Store.currentUser()) {
    const due = remindersDue(Store.payments);
    if (due.length) sendRemindersViaWebhook(due).then((n) => n && toast(`${n} payment reminder(s) sent automatically`));
  }
  return made;
}
async function boot() {
  applyTheme();
  bootScreen('Connecting…');
  if ((await Api.detect()) === 'server') {
    Api.enable();
    if (Api.token) { try { await Store.load(); Api.startPolling(); } catch (e) { Api.setToken(null); Store.data = null; } }
    Router.render();
    return;
  }
  // Browser-only demo mode: data in localStorage, automations run here
  Store.load();
  Router.render();
  tick();
  setInterval(() => { if (tick().length) Router.render(); }, 3600 * 1000);
}
boot();

/* Goals and notes the AI co-founder keeps between conversations (personal notes stay private to each person) */
async function renderAiMemory(box) {
  let items;
  try { items = (await Api.req('GET', '/assistant/memory')).items.filter((m) => m.scope === 'agency'); } catch (e) { box.querySelector('p').textContent = e.message; return; }
  const kindLabel = { goal: 'Goal', note: 'Note' };
  box.innerHTML = `<div class="card-head"><h2>What the co-founder remembers</h2></div>
    <p class="muted small">Agency goals and notes it uses in every conversation. Add more by telling it, e.g. “Remember our goal is 5 lakh monthly revenue by March.”</p>
    ${items.length ? `<div class="ai-mem-list">${items.map((m) => `<div class="ai-mem-row">${badge(kindLabel[m.kind] || 'Note', m.kind === 'goal' ? 'violet' : 'neutral')}<span class="grow">${esc(m.text)}<br><small class="muted">${esc(m.by)} · ${fmtDate(new Date(m.createdAt).toISOString().slice(0, 10))}</small></span>${m.canRemove ? `<button class="icon-btn" data-forget="${esc(m.id)}" title="Forget" aria-label="Forget">${icon('trash')}</button>` : ''}</div>`).join('')}</div>` : '<p class="muted small"><i>Nothing saved yet.</i></p>'}`;
  box.querySelectorAll('[data-forget]').forEach((b) => (b.onclick = async () => {
    try { await Api.req('DELETE', '/assistant/memory/' + encodeURIComponent(b.dataset.forget)); toast('Forgotten'); renderAiMemory(box); } catch (e) { toast(e.message, 'error'); }
  }));
}
