/* ==========================================================================
   payments.js — GST invoices, milestones, collections, disputes, receipts,
   reminder queue (copy / WhatsApp / email / webhook), contract renewals
   ========================================================================== */

const payState = { tab: 'invoices', month: '', status: '', q: '', allMonths: false };

Views.payments = function (main, _id, params) {
  const st = payState;
  st.tab = ['invoices', 'overdue', 'reminders', 'renewals'].includes(params.tab) ? params.tab : 'invoices';
  if (!st.month) st.month = monthKey();
  const rev = revenueSummary(st.month);
  const all = Perm.visiblePayments();
  const overdue = all.filter((p) => p.status === 'Overdue');
  const due = remindersDue(all);
  const renewals = renewalList();
  main.innerHTML = setTitle('<h1>Billing & collections</h1><p class="muted">Invoices (with GST) are raised automatically on each client’s billing day</p>',
    Perm.canEditPayments() ? `<button class="btn" id="runAuto">${icon('restore')}Refresh</button><button class="btn btn-primary" id="manualInv">${icon('plus')}One-off invoice</button>` : '') + `
    <div class="sub-head"><div class="month-nav"><button class="icon-btn" id="pm" aria-label="Previous month">${icon('chevronL')}</button><b>${fmtMonth(st.month)}</b><button class="icon-btn" id="nm" aria-label="Next month">${icon('chevronR')}</button></div></div>
    <section class="kpis">
      <div class="kpi"><span class="kpi-label">Expected (incl. GST)</span><span class="kpi-value" title="${inr(rev.expected)}">${inrShort(rev.expected)}</span><span class="kpi-sub">${rev.upcomingCount ? `${inrShort(rev.upcomingAmt)} not yet invoiced` : 'All invoices raised'}</span></div>
      <div class="kpi kpi-good"><span class="kpi-label">Collected</span><span class="kpi-value" title="${inr(rev.collected)}">${inrShort(rev.collected)}</span><span class="kpi-sub">${rev.rate}% of invoiced</span>${progressBar(rev.rate, { label: 'Collection rate' })}</div>
      <div class="kpi ${rev.outstanding ? 'kpi-bad' : ''}"><span class="kpi-label">Total outstanding</span><span class="kpi-value" title="${inr(rev.outstanding)}">${inrShort(rev.outstanding)}</span><span class="kpi-sub">${rev.overdueCount} overdue · ${rev.disputed.length} in dispute</span></div>
      <div class="kpi"><span class="kpi-label">GST collected this month</span><span class="kpi-value">${inrShort(sum(all.filter((p) => p.month === st.month), (p) => (p.cgst + p.sgst + p.igst) * Math.min(1, p.amountPaid / (p.amountDue || 1))))}</span><span class="kpi-sub">proportional to amounts received</span></div>
    </section>
    <div class="tabs" role="tablist">
      <a role="tab" href="#/payments?tab=invoices" class="${st.tab === 'invoices' ? 'on' : ''}">Invoices</a>
      <a role="tab" href="#/payments?tab=overdue" class="${st.tab === 'overdue' ? 'on' : ''}">Overdue ${overdue.length ? `<span class="count bad">${overdue.length}</span>` : ''}</a>
      <a role="tab" href="#/payments?tab=reminders" class="${st.tab === 'reminders' ? 'on' : ''}">Reminder queue ${due.length ? `<span class="count warn">${due.length}</span>` : ''}</a>
      <a role="tab" href="#/payments?tab=renewals" class="${st.tab === 'renewals' ? 'on' : ''}">Renewals ${renewals.length ? `<span class="count">${renewals.length}</span>` : ''}</a>
    </div><div id="payBody"></div>`;
  $('#pm').onclick = () => { st.month = addMonths(st.month, -1); Router.render(); };
  $('#nm').onclick = () => { st.month = addMonths(st.month, 1); Router.render(); };
  if ($('#manualInv')) $('#manualInv').onclick = () => openManualInvoice();
  if ($('#runAuto')) $('#runAuto').onclick = () => { const made = Store.runAutomations(); Store.save(); toast(made.length ? `${made.length} new invoice(s) generated` : 'Up to date — no new invoices due'); Router.render(); };
  const body = $('#payBody');
  ({ invoices: invoicesTab, overdue: overdueTab, reminders: remindersTab, renewals: renewalsTab })[st.tab](body, all);
};

function invoicesTab(body, all) {
  const st = payState;
  body.innerHTML = `<div class="toolbar">
      <div class="search">${icon('search')}<input id="pq" type="search" placeholder="Search client or invoice #" value="${esc(st.q)}" aria-label="Search invoices"></div>
      ${selectEl('f_pstatus', PAYMENT_STATUSES, st.status, { placeholder: 'All statuses', attrs: 'aria-label="Status"' })}
      <label class="check"><input type="checkbox" id="allMonths" ${st.allMonths ? 'checked' : ''}> All months</label>
      <button class="btn btn-sm" id="expPay">${icon('download')}Export</button>
    </div><section class="card flush" id="payTable"></section>`;
  const filtered = () => {
    const q = st.q.trim().toLowerCase();
    return all.filter((p) => (st.allMonths || p.month === st.month) && (!st.status || p.status === st.status) && (!q || (Store.clientName(p.clientId) + ' ' + p.invoiceNo).toLowerCase().includes(q)))
      .sort((a, b) => b.month.localeCompare(a.month) || Store.clientName(a.clientId).localeCompare(Store.clientName(b.clientId)));
  };
  const draw = () => { $('#payTable').innerHTML = paymentsTable(filtered()); bindPaymentTable($('#payTable')); };
  draw();
  $('#pq').oninput = (e) => { st.q = e.target.value; draw(); };
  $('[name=f_pstatus]', body).onchange = (e) => { st.status = e.target.value; draw(); };
  $('#allMonths').onchange = (e) => { st.allMonths = e.target.checked; draw(); };
  $('#expPay').onclick = () => exportExcel(paymentRows(filtered()), `invoices-${st.allMonths ? 'all' : st.month}`, 'Invoices');
}

function overdueTab(body, all) {
  const rows = all.filter((p) => p.status === 'Overdue').sort((a, b) => daysOverdue(b) - daysOverdue(a));
  const disputes = all.filter((p) => p.status === 'In Dispute');
  body.innerHTML = (rows.length ? `<section class="card"><div class="card-head"><h2>Overdue — oldest first</h2><span class="muted small">${inr(sum(rows, balance))} to collect</span></div>
    <div class="overdue-list">${rows.map((p) => { const c = Store.client(p.clientId) || {}; const d = daysOverdue(p); const ms = missedMilestone(p); return `<div class="overdue-row">
      <div class="od-days ${d > 30 ? 'sev-3' : d > 14 ? 'sev-2' : 'sev-1'}"><b>${d}</b><span>day${d === 1 ? '' : 's'}</span></div>
      <div class="od-main"><b>${esc(c.company)}</b><span class="muted small">${esc(p.invoiceNo)} · ${fmtMonth(p.month)} · ${esc(ms ? ms.label : '')} due ${fmtDate(ms ? ms.due : p.dueDate)}</span><span class="small">${esc(c.contact || '')} ${c.phone ? '· ' + esc(c.phone) : ''}</span></div>
      <div class="od-amt"><b>${inr(balance(p))}</b>${p.amountPaid ? `<span class="muted small">of ${inr(p.amountDue)} (part paid)</span>` : ''}</div>
      <div class="od-actions"><button class="btn btn-sm btn-wa" data-remind="${p.id}">${icon('whatsapp')}Reminder</button>${Perm.canEditPayments() ? `<button class="btn btn-sm btn-primary" data-pay="${p.id}">${icon('rupee')}Record payment</button>` : ''}</div></div>`; }).join('')}</div></section>`
    : `<section class="card">${emptyState('Nothing overdue', 'All invoices are paid or within terms.')}</section>`)
    + (disputes.length ? `<section class="card flush"><div class="card-head pad-card"><h2>In dispute</h2></div>${paymentsTable(disputes)}</section>` : '');
  bindPaymentTable(body);
}

function remindersTab(body, all) {
  const due = remindersDue(all);
  const s = Store.settings;
  body.innerHTML = `<section class="card"><div class="card-head wrap"><h2>Reminders due today</h2>
      <div class="page-actions">${Perm.canEditPayments() && due.length && (Api.mode === 'server' || s.webhookUrl) ? `<button class="btn btn-primary btn-sm" id="sendAll">${icon('send')}Send all now</button>` : ''}</div></div>
    <p class="muted small">Rules: a reminder 3 days before each due date (or milestone), and another once it’s missed. ${Api.mode === 'server' ? `Automatic sending: ${[s.autoWebhook ? 'WhatsApp/SMS via webhook' : '', s.emailReminders ? 'email to the client' : ''].filter(Boolean).join(' and ') || '<b>off</b> — turn it on in Settings'}.` : s.webhookUrl ? `Webhook: <code>${esc(s.webhookUrl)}</code>${s.autoWebhook ? ' · auto-send on app open is <b>on</b>' : ''}` : 'Add a webhook URL in Settings (e.g. Zapier, Make, Gupshup, Twilio) to send these automatically.'}</p>
    ${due.length ? `<div class="mini-list">${due.map((r) => `<div class="mini-row"><div><b>${esc(Store.clientName(r.p.clientId))}</b><span class="muted small">${esc(r.p.invoiceNo)} · ${esc(r.milestone.label)} · due ${fmtDate(r.milestone.due)}</span></div>
      <div class="row-actions"><span class="chip tone-${r.kind === 'overdue' ? 'bad' : 'warn'}">${esc(r.label)}</span><b>${inr(balance(r.p))}</b>
        <button class="btn btn-sm btn-wa" data-remind="${r.p.id}" data-key="${r.key}">${icon('whatsapp')}Open</button>
        <button class="btn btn-sm" data-mark="${r.p.id}" data-key="${r.key}" title="Mark as sent">${icon('check')}Sent</button></div></div>`).join('')}</div>` : emptyState('No reminders due today', 'Everything is either paid or not yet close to its due date.')}</section>`;
  $$('[data-remind]', body).forEach((b) => (b.onclick = () => openReminder(Store.payment(b.dataset.remind), b.dataset.key)));
  $$('[data-mark]', body).forEach((b) => (b.onclick = () => { markReminder(Store.payment(b.dataset.mark), b.dataset.key, 'manual'); Store.save(); Router.render(); }));
  if ($('#sendAll')) $('#sendAll').onclick = async (e) => {
    e.target.disabled = true;
    if (Api.mode === 'server') {
      try { const r = await Api.req('POST', '/reminders/send', null, { timeout: 120000 }); await Store.load(); toast(r.reminders ? `${r.reminders} reminder(s) sent` : 'Nothing was sent — check the webhook URL or email set-up in Settings', r.reminders ? 'ok' : 'warn'); }
      catch (x) { toast(x.message, 'error'); }
      return Router.render();
    }
    const n = await sendRemindersViaWebhook(due); toast(`${n} of ${due.length} reminders sent`); Router.render();
  };
}
function markReminder(p, key, channel) {
  p.reminders = p.reminders || {};
  p.reminders[key] = { at: Date.now(), channel, by: Store.currentUser() ? Store.currentUser().id : 'system' };
  Store.log('Reminder sent', `${key.startsWith('pre') ? 'Pre-due' : 'Overdue'} reminder for ${p.invoiceNo} (${Store.clientName(p.clientId)}) via ${channel}`, { entity: 'payment', entityId: p.id, clientId: p.clientId });
}
async function sendRemindersViaWebhook(list) {
  const url = Store.settings.webhookUrl;
  if (!url) return 0;
  let ok = 0;
  for (const r of list) {
    const t = reminderTexts(r.p);
    const c = t.c;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        event: r.kind === 'overdue' ? 'invoice.overdue' : 'invoice.due_soon', invoiceNo: r.p.invoiceNo, client: c.company, contact: c.contact,
        email: c.email, whatsapp: c.whatsapp, amountDue: balance(r.p), dueDate: r.milestone.due, whatsappText: t.whatsapp, emailSubject: t.subject, emailBody: t.email }) });
      if (!res.ok) throw new Error(res.status);
      markReminder(r.p, r.key, 'webhook'); ok++;
    } catch (e) { console.warn('Webhook failed', e); }
  }
  Store.save();
  if (ok < list.length) toast(`${list.length - ok} reminder(s) failed — check the webhook URL`, 'warn');
  return ok;
}

function renewalList() {
  const today = todayISO();
  return Perm.visibleClients().filter((c) => ['Active', 'On Hold'].includes(c.status) && c.package.endDate && daysBetween(today, c.package.endDate) <= 45)
    .sort((a, b) => a.package.endDate.localeCompare(b.package.endDate));
}
function renewalsTab(body) {
  const list = renewalList();
  body.innerHTML = `<section class="card flush"><div class="card-head pad-card"><h2>Contracts ending in the next 45 days</h2></div>${list.length ? `<div class="table-wrap"><table class="table clickable"><thead><tr><th>Client</th><th>Package</th><th class="num">Monthly fee</th><th>Ends</th><th>Sentiment</th></tr></thead><tbody>
    ${list.map((c) => { const d = daysBetween(todayISO(), c.package.endDate); return `<tr data-c="${c.id}"><td><b>${esc(c.company)}</b><div class="muted small">${esc(Store.userName(c.managerId))}</div></td><td>${esc(c.package.name)}</td><td class="num">${inr(c.package.monthlyFee)}</td>
      <td>${fmtDate(c.package.endDate)}<div class="small ${d < 0 ? 'text-bad' : d <= 15 ? 'text-warn' : 'muted'}">${d < 0 ? `Ended ${-d} days ago` : `${d} days left`}</div></td><td>${badge(c.sentiment)}</td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No renewals coming up')}</section>`;
  $$('tr[data-c]', body).forEach((tr) => (tr.onclick = () => (location.hash = `#/clients/${tr.dataset.c}`)));
}

function paymentRows(list) {
  return [['Invoice #', 'Client', 'Client GSTIN', 'Month', 'Issue date', 'Due date', 'Terms', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Invoice total', 'Paid', 'Balance', 'Status', 'Last payment date', 'Mode', 'Transaction ref'],
    ...list.map((p) => { const t = lastTxn(p) || {}; const c = Store.client(p.clientId) || {}; return [p.invoiceNo, c.company, c.gstin || '', fmtMonth(p.month), p.issueDate, p.dueDate, p.terms, p.subtotal, p.cgst, p.sgst, p.igst, p.amountDue, p.amountPaid, balance(p), p.status, t.date || '', t.mode || '', t.ref || '']; })];
}

function paymentsTable(list, { showClient = true } = {}) {
  if (!list.length) return emptyState('No invoices here', 'Invoices appear automatically on each active client’s billing day.');
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th>${showClient ? '<th>Client</th>' : ''}<th class="hide-sm">Due</th><th class="num">Total</th><th class="num hide-sm">Paid</th><th class="num">Balance</th><th>Status</th><th class="actions-col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${list.map((p) => { const t = lastTxn(p); const nd = nextDue(p); return `<tr>
      <td><button class="linkish" data-detail="${p.id}"><b>${esc(p.invoiceNo)}</b></button><div class="muted small">${fmtMonth(p.month)}${p.manual ? ' · one-off' : ''}</div></td>
      ${showClient ? `<td><a href="#/clients/${p.clientId}?tab=billing">${esc(Store.clientName(p.clientId))}</a><div class="muted small">${esc(p.terms)}</div></td>` : ''}
      <td class="hide-sm">${fmtDate(nd ? nd.due : p.dueDate)}${p.schedule.length > 1 && nd ? `<div class="muted small">${esc(nd.label)}</div>` : ''}${p.status === 'Overdue' ? `<div class="text-bad small">${daysOverdue(p)} days overdue</div>` : ''}</td>
      <td class="num">${inr(p.amountDue)}<div class="muted small">incl. ${inr(p.cgst + p.sgst + p.igst)} GST</div></td>
      <td class="num hide-sm">${p.amountPaid ? inr(p.amountPaid) : '—'}${t ? `<div class="muted small">${esc(t.mode)} · ${fmtShortDate(t.date)}</div>` : ''}</td>
      <td class="num"><b>${balance(p) ? inr(balance(p)) : '—'}</b></td>
      <td>${badge(p.status)}</td>
      <td class="actions-col"><div class="row-actions">
        ${Perm.canEditPayments() && balance(p) ? `<button class="btn btn-sm btn-primary" data-pay="${p.id}" title="Record payment">${icon('rupee')}<span class="hide-sm">Record</span></button>` : ''}
        ${balance(p) ? `<button class="icon-btn" data-remind="${p.id}" title="Reminder message" aria-label="Reminder message">${icon('whatsapp')}</button>` : ''}
        <button class="icon-btn" data-print="${p.id}" title="Invoice PDF" aria-label="Print invoice">${icon('print')}</button></div></td></tr>`; }).join('')}</tbody></table></div>`;
}
function bindPaymentTable(root) {
  $$('[data-pay]', root).forEach((b) => (b.onclick = () => openRecordPayment(Store.payment(b.dataset.pay))));
  $$('[data-remind]', root).forEach((b) => { if (!b.dataset.key) b.onclick = () => openReminder(Store.payment(b.dataset.remind)); });
  $$('[data-print]', root).forEach((b) => (b.onclick = () => openInvoice(Store.payment(b.dataset.print))));
  $$('[data-detail]', root).forEach((b) => (b.onclick = () => openPaymentDetail(Store.payment(b.dataset.detail))));
}

/* ---------- Record payment ---------- */
function openRecordPayment(p) {
  if (!Perm.canEditPayments()) return;
  const bal = balance(p), nd = nextDue(p);
  const m = Modal.open({ title: 'Record payment',
    body: `<div class="summary-box"><div><span class="muted small">Client</span><b>${esc(Store.clientName(p.clientId))}</b></div><div><span class="muted small">Invoice</span><b>${esc(p.invoiceNo)}</b></div><div><span class="muted small">Balance</span><b>${inr(bal)}</b></div></div>
      <form id="payForm" class="form-grid">
        ${field('Amount received (₹)', inputEl('amount', nd ? Math.min(bal, sum(p.schedule.slice(0, p.schedule.indexOf(nd) + 1), (x) => x.amount) - p.amountPaid) : bal, { type: 'number', attrs: `min="1" max="${bal}"` }), { required: true, hint: 'Less than the balance = partial payment' })}
        ${field('Payment date', inputEl('date', todayISO(), { type: 'date' }), { required: true })}
        ${field('Mode', selectEl('mode', PAYMENT_MODES, 'UPI'))}
        ${field('Transaction ID / reference', inputEl('ref', '', { placeholder: 'UTR, UPI ref, pay_xxx, cheque no.' }))}
        ${field('Receipt / proof', linkField('receipt', '', { placeholder: 'Link, or upload the screenshot / bank advice' }), { full: true })}
        ${field('Note', inputEl('note', ''), { full: true })}<p class="form-error full" hidden></p></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="savePay">${icon('check')}Save payment</button>` });
  $('#savePay', m).onclick = () => {
    const d = formData($('#payForm', m));
    const amt = Math.round(Number(d.amount)), err = $('.form-error', m);
    if (!(amt > 0)) { err.textContent = 'Enter the amount received.'; err.hidden = false; return; }
    if (amt > bal) { err.textContent = `That’s more than the balance of ${inr(bal)}.`; err.hidden = false; return; }
    if (!d.date) { err.textContent = 'Choose the payment date.'; err.hidden = false; return; }
    p.transactions.push({ id: uid('txn'), date: d.date, amount: amt, mode: d.mode, ref: d.ref.trim(), receipt: normLink(d.receipt), note: d.note.trim(), by: Store.currentUser().id });
    p.amountPaid += amt;
    const before = p.status; p.status = paymentStatus(p);
    Store.log('Payment recorded', `${inr(amt)} from ${Store.clientName(p.clientId)} via ${d.mode}${d.ref ? ' (' + d.ref.trim() + ')' : ''} — ${p.invoiceNo} ${before} → ${p.status}`, { entity: 'payment', entityId: p.id, clientId: p.clientId });
    Store.save(); Modal.close();
    toast(p.status === 'Paid' ? `${p.invoiceNo} fully paid` : `Saved — ${inr(balance(p))} still due`);
    Router.render();
  };
}

function openPaymentDetail(p) {
  const c = Store.client(p.clientId) || {};
  const edit = Perm.canEditPayments();
  const m = Modal.open({ title: `Invoice ${p.invoiceNo}`, size: 'lg',
    body: `<div class="summary-box"><div><span class="muted small">Client</span><b>${esc(c.company)}</b></div><div><span class="muted small">Period</span><b>${fmtMonth(p.month)}</b></div><div><span class="muted small">Status</span>${badge(p.status)}</div></div>
      ${p.dispute && p.dispute.open ? `<div class="alert alert-bad">${icon('flag')} In dispute: ${esc(p.dispute.reason)}</div>` : ''}
      <dl class="dl">
        <div class="dl-row"><dt>Taxable value</dt><dd>${inr(p.subtotal)}</dd></div>
        <div class="dl-row"><dt>GST @ ${p.gstRate}%</dt><dd>${p.igst ? `IGST ${inr(p.igst)}` : `CGST ${inr(p.cgst)} + SGST ${inr(p.sgst)}`}</dd></div>
        <div class="dl-row"><dt>Invoice total</dt><dd><b>${inr(p.amountDue)}</b></dd></div>
        <div class="dl-row"><dt>Terms</dt><dd>${esc(p.terms)}</dd></div>
        <div class="dl-row"><dt>Schedule</dt><dd>${p.schedule.map((s) => `<span class="chip">${esc(s.label)}: ${inr(s.amount)} by ${fmtShortDate(s.due)}</span>`).join(' ')}</dd></div>
        <div class="dl-row"><dt>Paid / balance</dt><dd>${inr(p.amountPaid)} / <b>${inr(balance(p))}</b></dd></div>
      </dl>
      <h3 class="form-section">Payment log</h3>
      ${p.transactions.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Mode</th><th>Transaction ID</th><th class="num">Amount</th><th></th></tr></thead><tbody>
        ${p.transactions.map((t) => `<tr><td>${fmtDate(t.date)}</td><td>${esc(t.mode)}</td><td>${esc(t.ref) || '—'}${t.receipt ? ` · ${linkHtml(t.receipt, 'receipt')}` : ''}${t.note ? `<div class="muted small">${esc(t.note)}</div>` : ''}</td><td class="num">${inr(t.amount)}</td>
          <td class="actions-col"><div class="row-actions"><button class="icon-btn" data-rcpt="${t.id}" title="Payment receipt" aria-label="Payment receipt">${icon('print')}</button>${edit ? `<button class="icon-btn" data-undo="${t.id}" title="Remove entry" aria-label="Remove entry">${icon('trash')}</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No payments yet.</p>'}`,
    footer: `${edit ? `<button class="btn" id="dispute">${icon('flag')}${p.dispute && p.dispute.open ? 'Resolve dispute' : 'Mark in dispute'}</button><span class="spacer"></span>` : ''}<button class="btn" id="dPrint">${icon('print')}Invoice PDF</button>${edit && balance(p) ? `<button class="btn btn-primary" id="dPay">${icon('rupee')}Record payment</button>` : ''}` });
  $$('[data-rcpt]', m).forEach((b) => (b.onclick = () => openReceipt(p, p.transactions.find((t) => t.id === b.dataset.rcpt))));
  $$('[data-undo]', m).forEach((b) => (b.onclick = async () => {
    const t = p.transactions.find((x) => x.id === b.dataset.undo);
    if (!(await confirmDialog('Remove payment entry?', `Remove ${inr(t.amount)} from ${fmtDate(t.date)}? Only to correct mistakes — this is logged.`, 'Remove', true))) return;
    p.transactions = p.transactions.filter((x) => x.id !== t.id);
    p.amountPaid = sum(p.transactions, (x) => x.amount); p.status = paymentStatus(p);
    Store.log('Payment entry removed', `${inr(t.amount)} removed from ${p.invoiceNo} (${Store.clientName(p.clientId)})`, { entity: 'payment', entityId: p.id, clientId: p.clientId });
    Store.save(); Router.render(); openPaymentDetail(p);
  }));
  $('#dPrint', m).onclick = () => openInvoice(p);
  if ($('#dPay', m)) $('#dPay', m).onclick = () => openRecordPayment(p);
  if ($('#dispute', m)) $('#dispute', m).onclick = () => {
    if (p.dispute && p.dispute.open) {
      p.dispute.open = false; p.dispute.resolvedAt = Date.now();
      Store.log('Dispute resolved', `${p.invoiceNo} (${Store.clientName(p.clientId)})`, { entity: 'payment', entityId: p.id, clientId: p.clientId });
      p.status = paymentStatus(p); Store.save(); Router.render(); openPaymentDetail(p); return;
    }
    const mm = Modal.open({ title: 'Mark invoice in dispute', body: `<form id="dsp">${field('What is the client disputing?', textareaEl('reason', '', { rows: 3 }), { full: true })}<p class="form-error" hidden></p></form>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="dspSave">Mark in dispute</button>` });
    $('#dspSave', mm).onclick = () => {
      const r = $('[name=reason]', mm).value.trim();
      if (!r) { const e = $('.form-error', mm); e.textContent = 'Add a reason.'; e.hidden = false; return; }
      p.dispute = { open: true, reason: r, raisedAt: Date.now(), by: Store.currentUser().id };
      p.status = paymentStatus(p);
      Store.log('Invoice disputed', `${p.invoiceNo} (${Store.clientName(p.clientId)}) — ${r}`, { entity: 'payment', entityId: p.id, clientId: p.clientId });
      Store.save(); Router.render(); openPaymentDetail(p);
    };
  };
}

/* ---------- One-off invoice ---------- */
function openManualInvoice(clientId = '') {
  const clients = Perm.visibleClients().filter((c) => c.status !== 'Lead');
  const m = Modal.open({ title: 'One-off invoice',
    body: `<p class="muted small">Monthly retainers are invoiced automatically. Use this for extra work — e.g. billable revisions, an extra shoot, or a missed month.</p>
      <form id="miForm" class="form-grid">
      ${field('Client', selectEl('clientId', clientOptions(clients), clientId, { placeholder: 'Select client' }), { required: true, full: true })}
      ${field('Description', inputEl('desc', '', { placeholder: 'e.g. 3 extra reel revisions' }), { full: true, required: true })}
      ${field('Amount before GST (₹)', inputEl('amount', '', { type: 'number', attrs: 'min="1"' }), { required: true })}
      ${field('Billing month', inputEl('month', monthKey(), { type: 'month' }))}
      <p class="form-error full" hidden></p></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="miSave">Create invoice</button>` });
  $('#miSave', m).onclick = () => {
    const d = formData($('#miForm', m)), err = $('.form-error', m);
    if (!d.clientId || !(Number(d.amount) > 0) || !d.desc.trim()) { err.textContent = 'Choose a client, add a description and an amount.'; err.hidden = false; return; }
    const c = Store.client(d.clientId);
    const p = makeInvoice(Store.data, c, { mk: d.month || monthKey(), issueDate: todayISO(), subtotal: Number(d.amount), description: d.desc.trim(), manual: true });
    p.status = paymentStatus(p);
    Store.payments.push(p);
    Store.log('Invoice created', `${p.invoiceNo} for ${c.company} — ${inr(p.amountDue)} incl. GST (${p.description})`, { entity: 'payment', entityId: p.id, clientId: c.id });
    Store.save(); Modal.close(); toast('Invoice created'); Router.render();
  };
}

/* ---------- Reminder templates ---------- */
function reminderTexts(p) {
  const c = Store.client(p.clientId) || {};
  const me = Store.currentUser() || { name: Store.settings.agencyName };
  return { ...reminderMessage(p, c, Store.settings, me.name), c };
}
function openReminder(p, key) {
  const { whatsapp, email, subject, c } = reminderTexts(p);
  let marked = false;
  const m = Modal.open({ title: `Reminder — ${c.company}`, size: 'lg', onClose: () => { if (marked) Router.render(); },
    body: `<div class="tabs small-tabs"><button class="on" data-t="wa">${icon('whatsapp')}WhatsApp</button><button data-t="em">${icon('mail')}Email</button></div>
      <div data-pane="wa"><textarea class="reminder-text" id="waText" rows="11">${esc(whatsapp)}</textarea>
        <div class="row-actions pad-top"><button class="btn btn-primary" id="copyWa">${icon('copy')}Copy</button>${c.whatsapp ? `<a class="btn btn-wa" id="openWa" target="_blank" rel="noopener">${icon('whatsapp')}Open in WhatsApp</a>` : ''}</div></div>
      <div data-pane="em" hidden>${field('Subject', `<input id="emSubj" value="${esc(subject)}">`, { full: true })}<textarea class="reminder-text" id="emText" rows="13">${esc(email)}</textarea>
        <div class="row-actions pad-top"><button class="btn btn-primary" id="copyEm">${icon('copy')}Copy</button>${c.email ? `<a class="btn" id="openEm">${icon('mail')}Open in email app</a>` : ''}</div></div>` });
  $$('[data-t]', m).forEach((b) => (b.onclick = () => { $$('[data-t]', m).forEach((x) => x.classList.toggle('on', x === b)); $$('[data-pane]', m).forEach((pn) => (pn.hidden = pn.dataset.pane !== b.dataset.t)); }));
  const done = (ch) => { marked = true; const k = key || (remindersDue([p])[0] || {}).key; if (k) markReminder(p, k, ch); else Store.log('Reminder sent', `${ch} reminder for ${p.invoiceNo} (${c.company})`, { entity: 'payment', entityId: p.id, clientId: p.clientId }); Store.save(); };
  $('#copyWa', m).onclick = () => { copyText($('#waText', m).value, 'WhatsApp message copied'); done('WhatsApp'); };
  $('#copyEm', m).onclick = () => { copyText(`Subject: ${$('#emSubj', m).value}\n\n${$('#emText', m).value}`, 'Email copied'); done('email'); };
  const wa = $('#openWa', m); if (wa) wa.onclick = () => { wa.href = `https://wa.me/${c.whatsapp}?text=${encodeURIComponent($('#waText', m).value)}`; done('WhatsApp'); };
  const em = $('#openEm', m); if (em) em.onclick = () => { em.href = `mailto:${c.email}?subject=${encodeURIComponent($('#emSubj', m).value)}&body=${encodeURIComponent($('#emText', m).value)}`; done('email'); };
}

/* ---------- Printable documents ---------- */
function numberToWordsIN(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : ''));
  const three = (n) => (n >= 100 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
  const parts = [];
  const cr = Math.floor(num / 1e7); num %= 1e7;
  const lk = Math.floor(num / 1e5); num %= 1e5;
  const th = Math.floor(num / 1e3); num %= 1e3;
  if (cr) parts.push(three(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (num) parts.push(three(num));
  return parts.join(' ');
}
const DOC_CSS = `*{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1f24;margin:0;padding:36px;font-size:13px;line-height:1.5}
  .doc{max-width:780px;margin:0 auto}.top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #4f46e5;padding-bottom:16px}
  h1{margin:0;font-size:24px;letter-spacing:.5px;color:#4f46e5}.muted{color:#6b7280}.meta{text-align:right}.meta div{margin:2px 0}
  .two{display:flex;justify-content:space-between;margin:20px 0;gap:24px}.label{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-top:8px}th{background:#f3f4f6;text-align:left;padding:9px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#4b5563}
  td{padding:10px 9px;border-bottom:1px solid #e5e7eb;vertical-align:top}.num{text-align:right;white-space:nowrap}
  .totals{margin-left:auto;width:320px;margin-top:12px}.totals div{display:flex;justify-content:space-between;padding:5px 10px}
  .grand{background:#eef2ff;font-weight:700;font-size:15px;border-radius:6px}.words{margin-top:10px;font-style:italic}
  .status{display:inline-block;padding:3px 10px;border-radius:99px;font-weight:600;font-size:12px;background:#f3f4f6}.Paid{background:#dcfce7;color:#166534}.Overdue{background:#fee2e2;color:#991b1b}
  .foot{margin-top:28px;display:flex;justify-content:space-between;gap:24px;border-top:1px solid #e5e7eb;padding-top:14px}.thanks{text-align:center;margin-top:24px;color:#6b7280}
  @media print{body{padding:0}.noprint{display:none}}.noprint{display:flex;justify-content:flex-end;max-width:780px;margin:0 auto 14px}.noprint{color:#6b7280;font-size:12px}`;
function invoiceHTML(p) {
  const c = Store.client(p.clientId) || {};
  const s = Store.settings;
  const desc = p.description || `Digital marketing retainer — ${c.package ? esc(c.package.name) + ' package, ' : ''}${fmtMonth(p.month)}`;
  const q = c.package ? QUOTA_TYPES.filter((x) => c.package.quotas[x.key]).map((x) => `${c.package.quotas[x.key]} ${x.short.toLowerCase()}`).join(', ') : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.invoiceNo)} — ${esc(c.company)}</title><style>${DOC_CSS}</style></head><body>
  <div class="noprint">Press Ctrl + P (⌘ + P on Mac) to print or save as PDF</div><div class="doc">
  <div class="top"><div><b style="font-size:17px">${esc(s.agencyName)}</b><div class="muted">${esc(s.agencyAddress)}</div><div class="muted">${esc(s.agencyEmail)} · ${esc(s.agencyPhone)}</div><div class="muted">GSTIN: ${esc(s.gstin)}</div></div>
    <div class="meta"><h1>TAX INVOICE</h1><div><b>${esc(p.invoiceNo)}</b></div><div>Date: ${fmtDate(p.issueDate)}</div><div>Due: ${fmtDate(p.dueDate)}</div><div><span class="status ${p.status.split(' ')[0]}">${esc(p.status)}</span></div></div></div>
  <div class="two"><div><div class="label">Bill to</div><b>${esc(c.company)}</b><div>Attn: ${esc(c.contact)}</div><div class="muted">${esc(c.address)}</div>${c.gstin ? `<div>GSTIN: ${esc(c.gstin)}</div>` : ''}</div>
    <div style="text-align:right"><div class="label">Place of supply</div><b>${p.igst ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</b><div class="label" style="margin-top:8px">Terms</div>${esc(p.terms)}</div></div>
  <table><thead><tr><th>#</th><th>Description</th><th>SAC</th><th class="num">Amount</th></tr></thead>
    <tbody><tr><td>1</td><td><b>${desc}</b>${q && !p.description ? `<div class="muted">Deliverables: ${esc(q)}</div>` : ''}</td><td>${esc(s.sac || '998361')}</td><td class="num">${inr(p.subtotal)}</td></tr></tbody></table>
  <div class="totals"><div><span>Taxable value</span><span>${inr(p.subtotal)}</span></div>
    ${p.igst ? `<div><span>IGST @ ${p.gstRate}%</span><span>${inr(p.igst)}</span></div>` : `<div><span>CGST @ ${p.gstRate / 2}%</span><span>${inr(p.cgst)}</span></div><div><span>SGST @ ${p.gstRate / 2}%</span><span>${inr(p.sgst)}</span></div>`}
    <div><b>Invoice total</b><b>${inr(p.amountDue)}</b></div><div><span>Amount paid</span><span>− ${inr(p.amountPaid)}</span></div><div class="grand"><span>Balance due</span><span>${inr(balance(p))}</span></div></div>
  <div class="words">Amount in words: Indian Rupees ${numberToWordsIN(p.amountDue)} Only</div>
  ${p.schedule.length > 1 ? `<div style="margin-top:14px"><div class="label">Payment schedule</div>${p.schedule.map((m) => `<div>${esc(m.label)} — ${inr(m.amount)} by ${fmtDate(m.due)}</div>`).join('')}</div>` : ''}
  <div class="foot"><div><div class="label">Pay to</div>${s.upiId ? `<div>UPI: <b>${esc(s.upiId)}</b></div>` : ''}<div>${esc(s.bankDetails)}</div></div><div style="text-align:right"><div class="label">For ${esc(s.agencyName)}</div><div style="margin-top:34px">Authorised signatory</div></div></div>
  <div class="thanks">Thank you for your business! This is a computer-generated invoice.</div></div></body></html>`;
}
function receiptHTML(p, t) {
  const c = Store.client(p.clientId) || {};
  const s = Store.settings;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(p.invoiceNo)}</title><style>${DOC_CSS}</style></head><body>
  <div class="noprint">Press Ctrl + P (⌘ + P on Mac) to print or save as PDF</div><div class="doc">
  <div class="top"><div><b style="font-size:17px">${esc(s.agencyName)}</b><div class="muted">${esc(s.agencyAddress)}</div><div class="muted">GSTIN: ${esc(s.gstin)}</div></div>
    <div class="meta"><h1>PAYMENT RECEIPT</h1><div>Receipt no: <b>RCPT-${esc(t.id.slice(-6).toUpperCase())}</b></div><div>Date: ${fmtDate(t.date)}</div></div></div>
  <p style="margin-top:24px">Received with thanks from <b>${esc(c.company)}</b> the sum of <b>${inr(t.amount)}</b> (Indian Rupees ${numberToWordsIN(t.amount)} Only)
  against invoice <b>${esc(p.invoiceNo)}</b> for ${fmtMonth(p.month)}.</p>
  <table><tbody><tr><td>Payment mode</td><td>${esc(t.mode)}</td></tr><tr><td>Transaction ID</td><td>${esc(t.ref) || '—'}</td></tr><tr><td>Invoice total</td><td>${inr(p.amountDue)}</td></tr><tr><td>Balance after this payment</td><td>${inr(Math.max(0, p.amountDue - sum(p.transactions.slice(0, p.transactions.indexOf(t) + 1), (x) => x.amount)))}</td></tr></tbody></table>
  <div class="foot"><div></div><div style="text-align:right"><div class="label">For ${esc(s.agencyName)}</div><div style="margin-top:34px">Authorised signatory</div></div></div></div></body></html>`;
}
function openDocModal(title, html, filename) {
  const m = Modal.open({ title, size: 'xl', body: '<iframe class="invoice-frame" title="Document preview"></iframe>',
    footer: `<button class="btn" id="docDl">${icon('download')}Download file</button><button class="btn btn-primary" id="docPrint">${icon('print')}Print / Save as PDF</button>` });
  const f = $('.invoice-frame', m);
  f.srcdoc = html;
  $('#docPrint', m).onclick = () => { f.contentWindow.focus(); f.contentWindow.print(); };
  $('#docDl', m).onclick = () => downloadBlob(html, filename, 'text/html');
}
function openInvoice(p) { openDocModal(`Invoice ${p.invoiceNo}`, invoiceHTML(p), `${p.invoiceNo.replace(/\//g, '-')}-${Store.clientName(p.clientId).replace(/[^\w]+/g, '-')}.html`); }
function openReceipt(p, t) { openDocModal('Payment receipt', receiptHTML(p, t), `receipt-${p.invoiceNo.replace(/\//g, '-')}-${t.date}.html`); }
