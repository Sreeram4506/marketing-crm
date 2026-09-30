/* ==========================================================================
   portal.js — Client portal: overview, approvals, deliverables, invoices,
   monthly feedback. Clients only ever receive their own account's data.
   ========================================================================== */

const CLIENT_STAGE = {
  Backlog: 'Planned', 'Scripting / Brief': 'Planned', 'Design / Editing': 'In production', 'Internal Review': 'In production',
  'Client Approval': 'Waiting for you', 'Ready to Publish': 'Approved', Published: 'Published',
};
const clientStage = (s) => CLIENT_STAGE[s] || s;
const stageTone = (s) => ({ Planned: 'neutral', 'In production': 'info', 'Waiting for you': 'warn', Approved: 'good', Published: 'good-strong' }[clientStage(s)]);
function myClient() { return Store.clients[0]; }
function portalHead(title, sub) { return setTitle(`<h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}`); }
function noAccount(main) { main.innerHTML = emptyState('Your account isn’t linked yet', 'Ask your account manager to link your login to your company.'); }

Views.portal = function (main) {
  const c = myClient();
  if (!c) return noAccount(main);
  const u = Store.currentUser();
  const mk = monthKey();
  const q = quotaStatus(c, mk);
  const waiting = Store.tasks.filter((t) => t.status === 'Client Approval');
  const due = sum(Store.payments, balance);
  const overdue = Store.payments.filter((p) => p.status === 'Overdue');
  const manager = Store.users.find((x) => x.id === c.managerId);
  const lastMonth = addMonths(mk, -1);
  const reviewed = (c.feedback || []).some((f) => f.month === lastMonth && f.by === u.id);
  main.innerHTML = portalHead(`Hello, ${firstName(u.name)}`, `${esc(c.company)} · ${esc(Store.settings.agencyName)}`) + `
    ${waiting.length ? `<a class="alert alert-warn portal-cta" href="#/approvals">${icon('alert')} ${waiting.length} deliverable${waiting.length > 1 ? 's are' : ' is'} waiting for your approval <b>Review now →</b></a>` : ''}
    <section class="kpis">
      <a class="kpi" href="#/deliverables"><span class="kpi-label">This month’s deliverables</span><span class="kpi-value">${q.completed}<small>/${q.quota}</small></span>${progressBar(q.pct, { tone: 'good' })}<span class="kpi-sub">${q.pct}% delivered</span></a>
      <a class="kpi ${waiting.length ? 'kpi-bad' : ''}" href="#/approvals"><span class="kpi-label">Waiting for your approval</span><span class="kpi-value">${waiting.length}</span><span class="kpi-sub">${waiting.length ? 'Approve or request changes' : 'Nothing pending'}</span></a>
      <a class="kpi ${overdue.length ? 'kpi-bad' : ''}" href="#/invoices"><span class="kpi-label">Balance due</span><span class="kpi-value">${inrShort(due)}</span><span class="kpi-sub">${overdue.length ? `${overdue.length} overdue` : due ? 'Within terms' : 'All paid — thank you!'}</span></a>
    </section>
    <div class="grid-2">
      <section class="card"><div class="card-head"><h2>${fmtMonth(mk)} progress</h2><a class="link" href="#/deliverables">Details</a></div>
        ${q.rows.length ? `<div class="deliv-summary">${q.rows.map((r) => `<div><span class="muted small">${esc(r.label)}</span><b>${r.completed}/${r.quota}</b></div>`).join('')}</div>` : '<p class="muted">No deliverables planned this month.</p>'}
      </section>
      <section class="card"><div class="card-head"><h2>Your account manager</h2></div>
        ${manager ? `<div class="presence-row">${avatar(manager.name)}<span class="grow"><b>${esc(manager.name)}</b><span class="muted small">${esc(manager.designation || 'Account manager')}</span></span></div>
          <div class="quick">${manager.email ? `<a class="btn btn-sm" href="mailto:${esc(manager.email)}">${icon('mail')}Email</a>` : ''}${manager.phone ? `<a class="btn btn-sm" href="tel:${esc(manager.phone.replace(/\s/g, ''))}">${icon('phone')}Call</a>` : ''}</div>` : '<p class="muted">—</p>'}
      </section>
      <section class="card full-span"><div class="card-head"><h2>How did we do in ${fmtMonth(lastMonth)}?</h2>${reviewed ? badge('Thanks — received', 'good') : ''}</div>
        ${reviewed ? '<p class="muted">Your feedback for last month is with the team. You can update it below.</p>' : '<p class="muted">Your rating goes straight to your account manager and helps us improve.</p>'}
        <form id="fbForm" class="form-grid">
          <div class="field"><span class="field-label">Overall satisfaction</span><div class="star-pick" role="radiogroup" aria-label="Satisfaction">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="csat" value="${n}" ${n === 4 ? 'checked' : ''}><span>★</span></label>`).join('')}</div></div>
          ${field('How likely are you to recommend us? (0–10)', `<input type="range" name="nps" min="0" max="10" value="8" id="npsIn"><span class="muted small" id="npsVal">8</span>`)}
          ${field('Anything we should do differently?', textareaEl('notes', '', { rows: 2 }), { full: true })}
          <div class="full"><button class="btn btn-primary" type="submit">Send feedback</button></div>
        </form></section>
    </div>`;
  $('#npsIn').oninput = (e) => ($('#npsVal').textContent = e.target.value);
  $('#fbForm').onsubmit = (e) => {
    e.preventDefault();
    const d = formData(e.target);
    c.feedback = (c.feedback || []).concat({ id: uid('fb'), month: lastMonth, csat: Number(d.csat), nps: Number(d.nps), notes: d.notes.trim(), by: u.id, date: todayISO() });
    Store.log('Client feedback', `${c.company} rated ${fmtMonth(lastMonth)}: ${d.csat}/5, NPS ${d.nps}`, { entity: 'client', entityId: c.id, clientId: c.id });
    Store.save(); toast('Thank you — your feedback was sent');
    setTimeout(() => Router.render(), 800);
  };
};

Views.approvals = function (main) {
  const c = myClient();
  if (!c) return noAccount(main);
  const waiting = Store.tasks.filter((t) => t.status === 'Client Approval').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const recent = Store.tasks.filter((t) => (t.clientComments || []).length).sort((a, b) => (b.clientComments.slice(-1)[0].at || 0) - (a.clientComments.slice(-1)[0].at || 0)).slice(0, 8);
  main.innerHTML = portalHead('Approvals', 'Review each deliverable, then approve it or tell us what to change') + `
    ${waiting.length ? waiting.map((t) => `<section class="card approval">
      <div class="card-head wrap"><div><h2>${esc(t.title)}</h2><p class="muted small">${esc(taskType(t.type).label)} · ${t.publishDate ? `goes live ${fmtDate(t.publishDate)}` : `due ${fmtDate(t.dueDate)}`} · revision ${t.revisions} of ${t.maxRevisions} included</p></div>
        ${t.link ? linkHtml(t.link, 'Open to review', { cls: 'btn btn-primary' }) : '<span class="muted small">Your account manager will share the file</span>'}</div>
      ${t.description ? `<p class="prewrap">${esc(t.description)}</p>` : ''}
      ${commentThread(t)}
      <div class="approval-actions">
        <textarea rows="2" placeholder="Comments (required if you request changes)" data-note="${t.id}" aria-label="Comments for ${esc(t.title)}"></textarea>
        <div class="row-actions"><button class="btn" data-changes="${t.id}">Request changes</button><button class="btn btn-primary" data-approve="${t.id}">${icon('check')}Approve</button></div>
        ${t.revisions >= t.maxRevisions ? '<p class="small text-warn">You’ve used the included revisions for this item — further changes may be billed. Your account manager will confirm first.</p>' : ''}
      </div></section>`).join('') : `<section class="card">${emptyState('Nothing to approve right now', 'We’ll email you when something is ready.')}</section>`}
    ${recent.length ? `<section class="card"><div class="card-head"><h2>Recent decisions</h2></div><div class="mini-list">${recent.map((t) => { const last = t.clientComments.slice(-1)[0]; return `<div class="mini-row"><div><b>${esc(t.title)}</b><span class="muted small">${last.action === 'approved' ? 'Approved' : 'Changes requested'} ${timeAgo(last.at)}${last.text ? ` · “${esc(last.text)}”` : ''}</span></div>${badge(clientStage(t.status), stageTone(t.status))}</div>`; }).join('')}</div></section>` : ''}`;
  const decide = (id, approve) => {
    const t = Store.task(id);
    const text = ($(`[data-note="${id}"]`, main).value || '').trim();
    if (!approve && !text) { toast('Tell us what to change so the team can fix it', 'warn'); $(`[data-note="${id}"]`, main).focus(); return; }
    t.clientComments = (t.clientComments || []).concat({ id: uid('cc'), by: Store.currentUser().id, byName: Store.currentUser().name, at: Date.now(), text, action: approve ? 'approved' : 'changes' });
    t.status = approve ? 'Ready to Publish' : 'Design / Editing';
    if (!approve) t.revisions += 1;
    Store.log(approve ? 'Deliverable approved' : 'Changes requested', `${t.title}${text ? ' — ' + text : ''}`, { entity: 'task', entityId: t.id, clientId: t.clientId });
    Store.save();
    toast(approve ? 'Approved — thank you!' : 'Sent to the team');
    Router.render();
  };
  $$('[data-approve]', main).forEach((b) => (b.onclick = () => decide(b.dataset.approve, true)));
  $$('[data-changes]', main).forEach((b) => (b.onclick = () => decide(b.dataset.changes, false)));
};

function commentThread(t) {
  const list = t.clientComments || [];
  if (!list.length) return '';
  return `<div class="thread">${list.map((c) => `<div class="thread-item"><b>${esc(c.byName)}</b> <span class="muted small">${c.action === 'approved' ? 'approved' : c.action === 'changes' ? 'requested changes' : 'commented'} · ${fmtDateTime(c.at)}</span>${c.text ? `<div>${esc(c.text)}</div>` : ''}</div>`).join('')}</div>`;
}

const portalMonth = { mk: '' };
Views.deliverables = function (main, _id, params) {
  const c = myClient();
  if (!c) return noAccount(main);
  if (!portalMonth.mk) portalMonth.mk = monthKey();
  const mk = portalMonth.mk;
  const q = quotaStatus(c, mk);
  const tasks = q.tasks.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  main.innerHTML = portalHead('Deliverables', `Everything in your ${esc(c.package.name || '')} package`) + `
    <div class="toolbar"><div class="month-nav"><button class="icon-btn" id="pm" aria-label="Previous month">${icon('chevronL')}</button><b>${fmtMonth(mk)}</b><button class="icon-btn" id="nm" aria-label="Next month">${icon('chevronR')}</button></div>
      <span class="spacer"></span><button class="btn btn-sm" id="report">${icon('print')}Monthly report</button></div>
    <section class="card"><div class="big-progress"><b>${q.completed}</b> of ${q.quota} delivered · ${q.pct}%</div>${progressBar(q.pct, { tone: 'good' })}
      <div class="deliv-summary pad-top">${q.rows.map((r) => `<div><span class="muted small">${esc(r.label)}</span><b>${r.completed}/${r.quota}</b>${r.rolled ? `<span class="dim small">incl. ${r.rolled} carried over</span>` : ''}</div>`).join('')}</div></section>
    <section class="card flush">${tasks.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Deliverable</th><th class="hide-sm">Type</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>
      ${tasks.map((t) => `<tr><td><b>${esc(t.title)}</b></td><td class="hide-sm">${esc(taskType(t.type).label)}</td><td class="nowrap">${fmtShortDate(t.publishDate || t.dueDate)}</td>
        <td>${badge(clientStage(t.status), stageTone(t.status))}</td><td class="actions-col">${t.status === 'Client Approval' ? '<a class="btn btn-sm btn-primary" href="#/approvals">Review</a>' : DONE_STATUSES.includes(t.status) && t.link ? linkHtml(t.link, 'View', { cls: 'btn btn-sm' }) : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Nothing scheduled for this month yet')}</section>`;
  $('#pm').onclick = () => { portalMonth.mk = addMonths(mk, -1); Router.render(); };
  $('#nm').onclick = () => { portalMonth.mk = addMonths(mk, 1); Router.render(); };
  $('#report').onclick = () => printDeliveryReport(c.id, mk);
};

Views.invoices = function (main) {
  const c = myClient();
  if (!c) return noAccount(main);
  const s = Store.settings;
  const list = Store.payments.slice().sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const due = sum(list, balance);
  main.innerHTML = portalHead('Invoices & payments', 'Download invoices and payment receipts') + `
    <div class="grid-2"><section class="card"><div class="card-head"><h2>Balance due</h2></div><div class="kpi-value">${inr(due)}</div>
      ${due ? `<p class="muted small">Please share the transaction reference with your account manager once paid.</p>` : '<p class="muted small">You’re all paid up — thank you!</p>'}</section>
    <section class="card"><div class="card-head"><h2>How to pay</h2></div><dl class="dl">
      ${s.upiId ? `<div class="dl-row"><dt>UPI</dt><dd><b>${esc(s.upiId)}</b> <button class="btn btn-sm" id="copyUpi">${icon('copy')}Copy</button></dd></div>` : ''}
      ${s.bankDetails ? `<div class="dl-row"><dt>Bank transfer</dt><dd>${esc(s.bankDetails)}</dd></div>` : ''}
      ${s.gstin ? `<div class="dl-row"><dt>Our GSTIN</dt><dd>${esc(s.gstin)}</dd></div>` : ''}</dl></section></div>
    <section class="card flush">${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th class="hide-sm">Period</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((p) => { const nd = nextDue(p); return `<tr><td><b>${esc(p.invoiceNo)}</b><div class="muted small">${fmtDate(p.issueDate)}${nd && balance(p) ? ` · due ${fmtDate(nd.due)}` : ''}</div></td><td class="hide-sm">${fmtMonth(p.month)}${p.description ? `<div class="muted small">${esc(p.description)}</div>` : ''}</td>
        <td class="num">${inr(p.amountDue)}</td><td class="num"><b>${balance(p) ? inr(balance(p)) : '—'}</b></td><td>${badge(p.status === 'In Dispute' ? 'Under review' : p.status, { 'In Dispute': 'violet' }[p.status])}</td>
        <td class="actions-col"><div class="row-actions"><button class="btn btn-sm" data-inv="${p.id}">${icon('print')}Invoice</button>${p.transactions.map((t) => `<button class="btn btn-sm" data-rcpt="${p.id}|${t.id}" title="Receipt for ${inr(t.amount)} on ${fmtDate(t.date)}">${icon('check')}Receipt</button>`).join('')}</div></td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No invoices yet')}</section>`;
  $$('[data-inv]', main).forEach((b) => (b.onclick = () => openInvoice(Store.payment(b.dataset.inv))));
  $$('[data-rcpt]', main).forEach((b) => (b.onclick = () => { const [pid, tid] = b.dataset.rcpt.split('|'); const p = Store.payment(pid); openReceipt(p, p.transactions.find((t) => t.id === tid)); }));
  if ($('#copyUpi')) $('#copyUpi').onclick = () => copyText(s.upiId, 'UPI ID copied');
};

/* ---------- Staff side: manage portal logins on the Client 360 page ---------- */
function portalAccessCard(c) {
  if (Api.mode !== 'server' || !Perm.is('admin', 'pm')) return '';
  const users = Store.portalUsers(c.id);
  return `<section class="card"><div class="card-head"><h2>Client portal access</h2><button class="btn btn-sm" id="addPortal">${icon('plus')}Add login</button></div>
    <p class="muted small">Portal users can approve deliverables, see invoices and receipts, and rate each month. They never see internal notes, staff details or other clients.</p>
    ${users.length ? `<div class="mini-list">${users.map((u) => `<div class="mini-row"><div><b>${esc(u.name)}</b><span class="muted small">${esc(u.email)}</span></div>
      <div class="row-actions">${badge(u.status)}<button class="btn btn-sm" data-pw="${u.id}">Set password</button>${Api.info.emailEnabled ? `<button class="btn btn-sm" data-invite="${u.id}">${icon('mail')}Invite</button>` : ''}<button class="icon-btn" data-rm="${u.id}" title="Remove login" aria-label="Remove login">${icon('trash')}</button></div></div>`).join('')}</div>` : '<p class="muted">No portal logins yet.</p>'}</section>`;
}
function bindPortalAccess(root, c) {
  if (!$('#addPortal', root)) return;
  $('#addPortal', root).onclick = () => {
    const m = Modal.open({ title: `Portal login for ${c.company}`, body: `<form id="plForm" class="form-grid">
      ${field('Name', inputEl('name', c.contact), { required: true })}${field('Email', inputEl('email', c.email, { type: 'email' }), { required: true })}
      ${Api.info.emailEnabled ? '<label class="check full"><input type="checkbox" name="invite" checked> Email them an invite to choose their password</label>' : ''}
      ${field('Or set a password now', inputEl('password', '', { type: 'password', attrs: 'autocomplete="new-password"' }), { full: true, hint: PASSWORD_RULE })}
      <p class="form-error full" hidden></p></form>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="plSave">Create login</button>` });
    $('#plSave', m).onclick = async () => {
      const d = formData($('#plForm', m)), err = $('.form-error', m);
      if (!d.name.trim() || !/^\S+@\S+\.\S+$/.test(d.email)) { err.textContent = 'Add a name and a valid email.'; err.hidden = false; return; }
      if (!d.invite && !d.password) { err.textContent = 'Send an invite or set a password so they can sign in.'; err.hidden = false; return; }
      const u = { id: uid('u'), name: d.name.trim(), email: d.email.trim(), phone: '', role: 'client', clientId: c.id, designation: `${c.company} (client)`, department: 'Management', workArrangement: WORK_ARRANGEMENTS[0], status: 'Active', joinDate: todayISO(),
        emergencyContact: { name: '', phone: '' }, ctc: 0, bank: { holder: '', account: '', ifsc: '' }, idProof: { type: '', number: '', verified: false }, docs: { nda: '', contract: '', idCopy: '' }, leaveQuota: { casual: 0, sick: 0, pto: 0 }, timer: null };
      Store.users.push(u);
      Store.log('Portal login added', `${u.name} <${u.email}> can now sign in to the ${c.company} portal`, { entity: 'client', entityId: c.id, clientId: c.id });
      try {
        await Api.flush();
        if (!Store.user(u.id)) throw new Error('The login wasn’t saved — is that email already used?');
        if (d.password) await Api.req('POST', `/users/${u.id}/password`, { password: d.password });
        if (d.invite) await Api.req('POST', `/users/${u.id}/invite`);
        Modal.close(); toast(d.invite ? 'Invite sent' : 'Login created'); Router.render();
      } catch (x) { err.textContent = x.message; err.hidden = false; }
    };
  };
  $$('[data-pw]', root).forEach((b) => (b.onclick = () => {
    const m = Modal.open({ title: 'Set portal password', body: `<form id="spForm">${field('New password', inputEl('password', '', { type: 'password', attrs: 'autocomplete="new-password"' }), { hint: PASSWORD_RULE })}<p class="form-error" hidden></p></form>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="spSave">Save</button>` });
    $('#spSave', m).onclick = async () => { try { await Api.req('POST', `/users/${b.dataset.pw}/password`, { password: $('[name=password]', m).value }); Modal.close(); toast('Password set — share it privately'); } catch (x) { const e = $('.form-error', m); e.textContent = x.message; e.hidden = false; } };
  }));
  $$('[data-invite]', root).forEach((b) => (b.onclick = async () => { try { await Api.req('POST', `/users/${b.dataset.invite}/invite`); toast('Invite emailed'); } catch (x) { toast(x.message, 'error'); } }));
  $$('[data-rm]', root).forEach((b) => (b.onclick = async () => {
    const u = Store.user(b.dataset.rm);
    if (!(await confirmDialog('Remove portal login?', `${u.name} will no longer be able to sign in.`, 'Remove', true))) return;
    Store.data.users = Store.users.filter((x) => x.id !== u.id);
    Store.log('Portal login removed', `${u.name} <${u.email}> (${c.company})`, { entity: 'client', entityId: c.id, clientId: c.id });
    Store.save(); Router.render();
  }));
}
