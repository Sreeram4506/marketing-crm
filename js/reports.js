/* ==========================================================================
   reports.js — revenue by client, deliverables (proof of work), GST register
   ========================================================================== */

const reportState = { tab: '', from: '', to: '', client: '', month: '' };

Views.reports = function (main, _id, params) {
  const st = reportState;
  const tabs = [...(Perm.canSeeMoney() ? [['revenue', 'Revenue by client'], ['gst', 'GST register']] : []), ...(Perm.is('admin', 'pm') ? [['delivery', 'Deliverables']] : [])];
  if (params.tab) st.tab = params.tab;
  if (!tabs.some((t) => t[0] === st.tab)) st.tab = tabs[0][0];
  if (!st.to) { st.to = monthKey(); st.from = addMonths(st.to, -2); st.month = monthKey(); }
  main.innerHTML = setTitle('<h1>Reports</h1><p class="muted">Export for your records or share with clients</p>') +
    `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/reports?tab=${k}" class="${st.tab === k ? 'on' : ''}">${l}</a>`).join('')}</div><div id="repBody"></div>`;
  ({ revenue: revenueReport, gst: gstReport, delivery: deliveryReport })[st.tab]($('#repBody'));
};
function monthsBetween(from, to) { const out = []; for (let m = from, g = 0; m <= to && g < 60; m = addMonths(m, 1), g++) out.push(m); return out; }
function rangeBar(st, extra = '') {
  return `<div class="toolbar"><label class="inline-field">From <input type="month" id="rFrom" value="${st.from}"></label><label class="inline-field">To <input type="month" id="rTo" value="${st.to}"></label>
    <span class="spacer"></span>${extra}<button class="btn btn-sm" id="rCsv">${icon('download')}CSV</button><button class="btn btn-sm" id="rXls">${icon('download')}Excel</button></div>`;
}
function bindRange(body, st, draw, name) {
  $('#rFrom', body).onchange = (e) => { if (e.target.value) { st.from = e.target.value; draw(); } };
  $('#rTo', body).onchange = (e) => { if (e.target.value) { st.to = e.target.value; draw(); } };
  $('#rCsv', body).onclick = () => exportCSV(st._rows, `${name}-${st.from}-to-${st.to}`);
  $('#rXls', body).onclick = () => exportExcel(st._rows, `${name}-${st.from}-to-${st.to}`, name);
}

function revenueReport(body) {
  const st = reportState;
  body.innerHTML = rangeBar(st) + '<section class="card flush" id="repTable"></section><p class="muted small pad-top">Amounts include GST, grouped by the month each invoice covers.</p>';
  const draw = () => {
    if (st.from > st.to) [st.from, st.to] = [st.to, st.from];
    const months = monthsBetween(st.from, st.to);
    const pays = Perm.visiblePayments().filter((p) => p.month >= st.from && p.month <= st.to);
    const rows = Perm.visibleClients({ includeArchived: true }).map((c) => {
      const cp = pays.filter((p) => p.clientId === c.id);
      const inv = sum(cp, (p) => p.amountDue), col = sum(cp, (p) => p.amountPaid);
      return { c, inv, col, out: inv - col, rate: inv ? Math.round((col / inv) * 100) : 0, overdue: cp.filter((p) => p.status === 'Overdue').length,
        byMonth: months.map((mk) => { const ps = cp.filter((x) => x.month === mk); return ps.length ? { due: sum(ps, (x) => x.amountDue), paid: sum(ps, (x) => x.amountPaid), st: ps.some((x) => x.status === 'Overdue') ? 'Overdue' : ps.every((x) => x.status === 'Paid') ? 'Paid' : '' } : null; }) };
    }).filter((r) => r.inv > 0).sort((a, b) => b.inv - a.inv);
    const T = { inv: sum(rows, (r) => r.inv), col: sum(rows, (r) => r.col) };
    $('#repTable').innerHTML = rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Client</th>${months.map((mk) => `<th class="num hide-sm">${fmtMonthShort(mk)} ${mk.slice(2, 4)}</th>`).join('')}<th class="num">Invoiced</th><th class="num">Collected</th><th class="num">Outstanding</th><th class="num">Rate</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><b>${esc(r.c.company)}</b>${r.overdue ? `<div class="text-bad small">${r.overdue} overdue</div>` : ''}</td>
        ${r.byMonth.map((x) => `<td class="num hide-sm">${x ? `${inrShort(x.paid)}<div class="small ${x.st === 'Paid' ? 'text-good' : x.st === 'Overdue' ? 'text-bad' : 'muted'}">of ${inrShort(x.due)}</div>` : '<span class="muted">—</span>'}</td>`).join('')}
        <td class="num">${inr(r.inv)}</td><td class="num">${inr(r.col)}</td><td class="num ${r.out ? 'text-bad' : ''}">${inr(r.out)}</td><td class="num">${r.rate}%</td></tr>`).join('')}</tbody>
      <tfoot><tr><td><b>Total</b></td>${months.map((mk) => `<td class="num hide-sm"><b>${inrShort(sum(pays.filter((p) => p.month === mk), (p) => p.amountPaid))}</b></td>`).join('')}<td class="num"><b>${inr(T.inv)}</b></td><td class="num"><b>${inr(T.col)}</b></td><td class="num"><b>${inr(T.inv - T.col)}</b></td><td class="num"><b>${T.inv ? Math.round((T.col / T.inv) * 100) : 0}%</b></td></tr></tfoot></table></div>` : emptyState('No invoices in this period');
    st._rows = [['Client', ...months.flatMap((mk) => [`${fmtMonth(mk)} invoiced`, `${fmtMonth(mk)} collected`]), 'Total invoiced', 'Total collected', 'Outstanding', 'Collection %'],
      ...rows.map((r) => [r.c.company, ...r.byMonth.flatMap((x) => (x ? [x.due, x.paid] : ['', ''])), r.inv, r.col, r.out, r.rate])];
  };
  draw(); bindRange(body, st, draw, 'revenue-by-client');
}

function gstReport(body) {
  const st = reportState;
  body.innerHTML = rangeBar(st) + '<section class="card flush" id="repTable"></section><p class="muted small pad-top">Outward supplies by invoice — hand this to your CA for GSTR-1. Place of supply is decided from the first two digits of each GSTIN.</p>';
  const draw = () => {
    if (st.from > st.to) [st.from, st.to] = [st.to, st.from];
    const list = Perm.visiblePayments().filter((p) => p.month >= st.from && p.month <= st.to).sort((a, b) => a.issueDate.localeCompare(b.issueDate));
    const T = { sub: sum(list, (p) => p.subtotal), cg: sum(list, (p) => p.cgst), sg: sum(list, (p) => p.sgst), ig: sum(list, (p) => p.igst), tot: sum(list, (p) => p.amountDue) };
    $('#repTable').innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Date</th><th>Client / GSTIN</th><th class="num">Taxable</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">IGST</th><th class="num">Total</th></tr></thead><tbody>
      ${list.map((p) => { const c = Store.client(p.clientId) || {}; return `<tr><td>${esc(p.invoiceNo)}</td><td class="nowrap">${fmtShortDate(p.issueDate)}</td><td>${esc(c.company)}<div class="muted small">${esc(c.gstin || 'Unregistered')}</div></td><td class="num">${inr(p.subtotal)}</td><td class="num">${inr(p.cgst)}</td><td class="num">${inr(p.sgst)}</td><td class="num">${inr(p.igst)}</td><td class="num">${inr(p.amountDue)}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td colspan="3"><b>Total</b></td><td class="num"><b>${inr(T.sub)}</b></td><td class="num"><b>${inr(T.cg)}</b></td><td class="num"><b>${inr(T.sg)}</b></td><td class="num"><b>${inr(T.ig)}</b></td><td class="num"><b>${inr(T.tot)}</b></td></tr></tfoot></table></div>` : emptyState('No invoices in this period');
    st._rows = [['Invoice #', 'Invoice date', 'Client', 'Client GSTIN', 'Place of supply', 'SAC', 'Taxable value', 'GST rate %', 'CGST', 'SGST', 'IGST', 'Invoice value'],
      ...list.map((p) => { const c = Store.client(p.clientId) || {}; return [p.invoiceNo, p.issueDate, c.company, c.gstin || '', stateCode(c.gstin) || stateCode(Store.settings.gstin), Store.settings.sac, p.subtotal, p.gstRate, p.cgst, p.sgst, p.igst, p.amountDue]; })];
  };
  draw(); bindRange(body, st, draw, 'gst-register');
}

function deliveryReport(body) {
  const st = reportState;
  const clients = Perm.visibleClients({ includeArchived: true });
  body.innerHTML = `<div class="toolbar"><label class="inline-field">Month <input type="month" id="dMonth" value="${st.month}"></label>
      ${selectEl('dClient', clientOptions(clients), st.client, { placeholder: 'All clients (summary)', attrs: 'aria-label="Client"' })}
      <span class="spacer"></span><button class="btn btn-sm" id="dCsv">${icon('download')}CSV</button><button class="btn btn-sm" id="dXls">${icon('download')}Excel</button>
      <button class="btn btn-sm btn-primary" id="dPrint" hidden>${icon('print')}Print for client</button></div><div id="dBody"></div>`;
  const draw = () => {
    const mk = st.month;
    $('#dPrint').hidden = !st.client;
    if (!st.client) {
      const rows = clients.filter((c) => c.status === 'Active' && !c.archived).map((c) => ({ c, q: quotaStatus(c, mk) })).filter((r) => r.q.quota);
      $('#dBody').innerHTML = rows.length ? `<section class="card flush"><div class="table-wrap"><table class="table clickable"><thead><tr><th>Client</th><th class="num">Quota</th><th class="num">Done</th><th class="num">Review</th><th class="num">Late</th><th style="min-width:150px">Progress</th></tr></thead><tbody>
        ${rows.map(({ c, q }) => `<tr data-c="${c.id}"><td><b>${esc(c.company)}</b><div class="muted small">${q.rows.map((r) => `${r.completed}/${r.quota} ${r.short.toLowerCase()}`).join(' · ')}</div></td><td class="num">${q.quota}</td><td class="num">${q.completed}</td><td class="num">${q.inReview}</td><td class="num ${q.late ? 'text-bad' : ''}">${q.late || '—'}</td><td>${progressBar(q.pct)}<span class="small muted">${q.pct}%</span></td></tr>`).join('')}</tbody></table></div></section>
        <p class="muted small pad-top">Pick a client for the detailed, printable proof-of-work report.</p>` : emptyState('No quotas this month');
      $$('tr[data-c]', $('#dBody')).forEach((tr) => (tr.onclick = () => { st.client = tr.dataset.c; $('[name=dClient]').value = st.client; draw(); }));
      st._rows = [['Client', 'Month', ...QUOTA_TYPES.flatMap((q) => [`${q.short} quota`, `${q.short} done`]), 'Total quota', 'Total done', 'Progress %', 'Late'],
        ...rows.map(({ c, q }) => [c.company, fmtMonth(mk), ...QUOTA_TYPES.flatMap((x) => { const r = q.rows.find((y) => y.key === x.key); return r ? [r.quota, r.completed] : [0, 0]; }), q.quota, q.completed, q.pct, q.late])];
    } else {
      const c = Store.client(st.client);
      const q = quotaStatus(c, mk);
      $('#dBody').innerHTML = `<section class="card"><div class="card-head"><h2>${esc(c.company)} — ${fmtMonth(mk)}</h2><span class="muted small">${q.completed}/${q.quota} · ${q.pct}%</span></div>${progressBar(q.pct)}
        <div class="deliv-summary pad-top">${q.rows.map((r) => `<div><span class="muted small">${r.label}</span><b>${r.completed}/${r.quota}</b></div>`).join('')}</div>
        <div class="pad-top">${taskTable(q.tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate)), { showClient: false })}</div></section>`;
      bindTaskTable($('#dBody'));
      st._rows = taskRows(q.tasks).map((r) => r.slice(1));
    }
  };
  draw();
  $('#dMonth').onchange = (e) => { if (e.target.value) { st.month = e.target.value; draw(); } };
  $('[name=dClient]', body).onchange = (e) => { st.client = e.target.value; draw(); };
  const fname = () => `deliverables-${st.client ? Store.clientName(st.client).replace(/[^\w]+/g, '-') : 'all'}-${st.month}`;
  $('#dCsv').onclick = () => exportCSV(st._rows, fname());
  $('#dXls').onclick = () => exportExcel(st._rows, fname(), 'Deliverables');
  $('#dPrint').onclick = () => printDeliveryReport(st.client, st.month);
}

/* Client-facing proof-of-work report */
function printDeliveryReport(clientId, mk) {
  const c = Store.client(clientId), s = Store.settings, q = quotaStatus(c, mk);
  const done = q.tasks.filter((t) => DONE_STATUSES.includes(t.status) && taskType(t.type).quota), open = q.tasks.filter((t) => !DONE_STATUSES.includes(t.status) && taskType(t.type).quota);
  const row = (t) => `<tr><td>${esc(t.title)}</td><td>${esc(taskType(t.type).label)}</td><td>${esc(t.status)}</td><td>${t.completedAt ? fmtDate(toISO(new Date(t.completedAt))) : '—'}</td><td>${t.publishDate ? fmtDate(t.publishDate) : '—'}</td><td>${safeUrl(t.link) ? `<a href="${esc(safeUrl(t.link))}">View</a>` : isFileRef(t.link) ? esc(fileRefName(t.link)) : '—'}</td></tr>`;
  const thead = '<thead><tr><th>Deliverable</th><th>Type</th><th>Status</th><th>Completed</th><th>Publish date</th><th>Link</th></tr></thead>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Deliverables — ${esc(c.company)} — ${fmtMonth(mk)}</title><style>${DOC_CSS}
    .stats{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.stat{border:1px solid #e5e7eb;border-radius:10px;padding:8px 12px;min-width:110px}.stat b{display:block;font-size:18px}
    .bar{height:10px;background:#eef2ff;border-radius:99px;overflow:hidden;margin:8px 0 16px}.bar div{height:100%;background:#4f46e5}h2{font-size:15px;margin:20px 0 6px}a{color:#4f46e5}</style></head><body>
    <div class="noprint">Press Ctrl + P (⌘ + P on Mac) to print or save as PDF</div><div class="doc">
    <div class="top"><div><h1 style="font-size:20px">Monthly deliverables report</h1><div class="muted">${esc(c.company)} · ${fmtMonth(mk)} · ${esc(c.package.name)} package</div></div><div class="meta"><b>${esc(s.agencyName)}</b><div class="muted">Prepared ${fmtDate(todayISO())}</div></div></div>
    <p style="margin-top:16px"><b>${q.completed}</b> of <b>${q.quota}</b> committed deliverables completed (${q.pct}%)${q.inReview ? ` · ${q.inReview} awaiting approval` : ''}</p><div class="bar"><div style="width:${q.pct}%"></div></div>
    <div class="stats">${q.rows.map((r) => `<div class="stat"><span class="muted">${esc(r.label)}</span><b>${r.completed} / ${r.quota}</b>${r.rolled ? `<span class="muted">incl. ${r.rolled} carried over</span>` : ''}</div>`).join('')}</div>
    <h2>Delivered (${done.length})</h2>${done.length ? `<table>${thead}<tbody>${done.map(row).join('')}</tbody></table>` : '<p class="muted">Nothing delivered yet.</p>'}
    ${open.length ? `<h2>In progress (${open.length})</h2><table>${thead}<tbody>${open.map(row).join('')}</tbody></table>` : ''}
    <p class="muted" style="margin-top:24px">Thank you for partnering with ${esc(s.agencyName)}. Questions? Contact ${esc(Store.userName(c.managerId))}.</p></div></body></html>`;
  openDocModal(`Deliverables report — ${c.company}`, html, `deliverables-${c.company.replace(/[^\w]+/g, '-')}-${mk}.html`);
}
