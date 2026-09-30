/* ==========================================================================
   dashboard.js — executive overview (role-aware) + shared revenue maths
   ========================================================================== */

/* Revenue for a month (amounts include GST). "Expected" also counts active
   clients whose billing day hasn't come yet this month. */
function revenueSummary(mk, payments = Perm.visiblePayments(), clients = Perm.visibleClients()) {
  const inv = payments.filter((p) => p.month === mk && !p.manual);
  const extra = payments.filter((p) => p.month === mk && p.manual);
  const billed = sum(inv.concat(extra), (p) => p.amountDue);
  const collected = sum(inv.concat(extra), (p) => p.amountPaid);
  const rate = Number(Store.settings.gstRate) || 0;
  const upcoming = mk < monthKey() ? [] : clients.filter((c) => c.status === 'Active' && !c.archived && c.package.monthlyFee && c.package.startDate
    && monthOf(c.package.startDate) <= mk && (!c.package.endDate || monthOf(c.package.endDate) >= mk) && !inv.some((p) => p.clientId === c.id));
  const upcomingAmt = sum(upcoming, (c) => Math.round(c.package.monthlyFee * (1 + rate / 100)));
  const overdue = payments.filter((p) => p.status === 'Overdue');
  return {
    expected: billed + upcomingAmt, billed, collected, upcomingAmt, upcomingCount: upcoming.length,
    pending: Math.max(0, billed + upcomingAmt - collected), rate: billed ? Math.round((collected / billed) * 100) : 0,
    outstanding: sum(payments, balance), overdueCount: overdue.length, overdueAmt: sum(overdue, balance),
    disputed: payments.filter((p) => p.status === 'In Dispute'),
  };
}

/* Clients needing attention, most urgent first */
function flaggedClients(mk = monthKey()) {
  const out = [];
  const today = todayISO();
  Perm.visibleClients().forEach((c) => {
    const reasons = [];
    let score = 0;
    if (Perm.canSeeMoney()) {
      const od = Store.payments.filter((p) => p.clientId === c.id && p.status === 'Overdue');
      if (od.length) { const d = Math.max(...od.map(daysOverdue)); reasons.push({ tone: 'bad', text: `${inr(sum(od, balance))} overdue · ${d}d` }); score += 50 + d; }
      if (Store.payments.some((p) => p.clientId === c.id && p.status === 'In Dispute')) { reasons.push({ tone: 'violet', text: 'Invoice in dispute' }); score += 40; }
    }
    if (c.status === 'Active') {
      const br = burnRate(c, mk);
      if (br.tone === 'bad' || br.tone === 'warn') { reasons.push({ tone: br.tone, text: `Quota ${br.q.pct}% (expected ~${br.exp}%)` }); score += br.exp - br.q.pct; }
      if (br.q.late) { reasons.push({ tone: 'bad', text: `${br.q.late} late task${br.q.late > 1 ? 's' : ''}` }); score += br.q.late * 2; }
      const endIn = c.package.endDate ? daysBetween(today, c.package.endDate) : 999;
      if (endIn <= 30) { reasons.push({ tone: 'warn', text: endIn < 0 ? 'Contract expired' : `Renewal in ${endIn}d` }); score += 30; }
    }
    if (['At-Risk', 'Critical'].includes(c.sentiment) && ['Active', 'Onboarding'].includes(c.status)) { reasons.push({ tone: c.sentiment === 'Critical' ? 'bad' : 'warn', text: `Sentiment: ${c.sentiment}` }); score += c.sentiment === 'Critical' ? 60 : 35; }
    if (c.status === 'Onboarding') {
      const done = c.onboarding.filter((s) => s.done).length;
      reasons.push({ tone: 'info', text: `Onboarding ${done}/${ONBOARDING_STEPS.length}` }); score += 5;
    }
    if (reasons.length) out.push({ client: c, reasons, score });
  });
  return out.sort((a, b) => b.score - a.score);
}

function presenceSummary() {
  const people = Store.activeUsers();
  const st = people.map((u) => ({ u, s: liveStatus(u.id) }));
  const count = (k) => st.filter((x) => x.s.key === k).length;
  return { st, total: people.length, working: count('working'), onBreak: count('break'), done: count('done'), leave: count('leave'), absent: count('absent'), present: count('working') + count('break') + count('done') };
}

function workloadRows() {
  const thr = Number(Store.settings.overloadThreshold) || 8;
  return Store.activeUsers().filter((u) => ['creative', 'shoot'].includes(u.role)).map((u) => {
    const open = Store.tasks.filter((t) => t.assigneeId === u.id && !DONE_STATUSES.includes(t.status));
    const late = open.filter((t) => isLate(t)).length;
    const n = open.length;
    return { u, n, late, tone: n >= thr ? 'bad' : n >= thr * 0.6 ? 'warn' : n === 0 ? 'muted' : 'good', label: n >= thr ? 'Overloaded' : n >= thr * 0.6 ? 'Busy' : n === 0 ? 'Free' : 'Available' };
  }).sort((a, b) => b.n - a.n);
}

Views.dashboard = function (main) {
  const u = Store.currentUser();
  if (u.role === 'creative' || u.role === 'shoot') return personalDashboard(main, u);
  const mk = monthKey();
  const money = Perm.canSeeMoney();
  const clients = Perm.visibleClients();
  const active = clients.filter((c) => c.status === 'Active');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  let html = setTitle(`<h1>${greet}, ${esc(firstName(u.name))}</h1><p class="muted">${u.role === 'admin' ? 'Executive overview' : u.role === 'pm' ? 'Your accounts' : 'Finance overview'} · ${fmtMonth(mk)}</p>`,
    Perm.canEditClients() ? `<a class="btn btn-primary" href="#/clients?new=1">${icon('plus')}Add client</a>` : '');

  /* First steps for a brand-new workspace */
  if (u.role === 'admin' && Store.clients.length < 3) {
    const st = Store.settings;
    const steps = [
      [!!(st.gstin && st.bankDetails), 'Add your GSTIN and bank / UPI details', '#/settings'],
      [Store.users.filter((x) => x.role !== 'client').length > 1, 'Add your team (they get an invite or a password)', '#/team'],
      [Store.clients.some((c) => c.status === 'Active'), 'Add your first client with its package and quotas', '#/clients?new=1'],
      [Store.tasks.length > 0, 'Plan a month of deliverables (Client → Deliverables → Plan month)', '#/clients'],
      [(st.require2fa || []).includes('admin') || (Api.me || {}).twoFactor, 'Turn on two-factor authentication (shield icon, bottom left)', '#/settings'],
    ];
    html += `<section class="card"><div class="card-head"><h2>${icon('sparkle')} Getting started</h2><span class="muted small">${steps.filter((s) => s[0]).length}/${steps.length} done</span></div>
      <ol class="steps">${steps.map(([done, text, href]) => `<li class="${done ? 'done' : ''}"><a href="${href}">${done ? icon('check') + ' ' : ''}<span>${esc(text)}</span></a></li>`).join('')}</ol></section>`;
  }

  /* Flags */
  const flags = flaggedClients(mk);
  html += flags.length ? `<section class="card flags"><div class="card-head"><h2>${icon('alert')} Needs attention</h2><span class="muted small">${flags.length} client${flags.length > 1 ? 's' : ''}</span></div>
    <div class="flag-list">${flags.slice(0, 8).map((f) => `<a class="flag-row" href="#/clients/${f.client.id}"><span class="flag-name">${esc(f.client.company)} ${badge(f.client.status)}</span>
      <span class="flag-reasons">${f.reasons.map((r) => `<span class="chip tone-${r.tone}">${esc(r.text)}</span>`).join('')}</span>${icon('chevronR', 'dim')}</a>`).join('')}</div></section>`
    : `<section class="card flags ok"><div class="card-head"><h2>${icon('check')} All accounts on track</h2></div></section>`;

  /* KPIs */
  const tiles = [];
  const pres = presenceSummary();
  const quotaAll = active.map((c) => quotaStatus(c, mk));
  const qTotal = sum(quotaAll, (q) => q.quota), qDone = sum(quotaAll, (q) => q.completed);
  const qPct = qTotal ? Math.round((qDone / qTotal) * 100) : 0;
  if (u.role !== 'finance') tiles.push({ label: 'Active clients', value: active.length, sub: `${clients.filter((c) => c.status === 'Onboarding').length} onboarding · ${clients.filter((c) => c.status === 'Lead').length} leads`, href: '#/clients' });
  let rev;
  if (money) {
    rev = revenueSummary(mk);
    tiles.push({ label: 'Revenue collected', value: inrShort(rev.collected), title: inr(rev.collected), sub: `of ${inrShort(rev.expected)} expected (incl. GST)`, tone: 'good', href: '#/payments' });
    tiles.push({ label: 'Pending collections', value: inrShort(rev.outstanding), title: inr(rev.outstanding), sub: `${rev.overdueCount} overdue · ${inrShort(rev.overdueAmt)}`, tone: rev.overdueCount ? 'bad' : '', href: '#/payments?tab=overdue' });
  }
  if (u.role !== 'finance') tiles.push({ label: 'Deliverables health', value: `${qPct}%`, sub: `${qDone}/${qTotal} delivered · expected ~${expectedPct(mk)}%`, bar: qPct, href: '#/tasks' });
  tiles.push({ label: 'In today', value: `${pres.present}<small>/${pres.total}</small>`, sub: `${pres.onBreak} on break · ${pres.leave} on leave`, href: Perm.canSeeAttendance() ? '#/team?tab=attendance' : '#/workspace' });
  html += `<section class="kpis">${tiles.map((t) => `<a class="kpi ${t.tone ? 'kpi-' + t.tone : ''}" href="${t.href}" ${t.title ? `title="${esc(t.title)}"` : ''}>
    <span class="kpi-label">${esc(t.label)}</span><span class="kpi-value">${t.value}</span>${t.bar !== undefined ? progressBar(t.bar, { tone: t.bar >= expectedPct(mk) - 10 ? 'good' : t.bar >= expectedPct(mk) - 30 ? 'warn' : 'bad' }) : ''}<span class="kpi-sub">${esc(t.sub)}</span></a>`).join('')}</section>`;

  html += '<div class="grid-2">';
  if (money) {
    html += `<section class="card"><div class="card-head"><h2>Revenue — last 6 months</h2><div class="legend"><span><i class="sw sw-1"></i>Invoiced</span><span><i class="sw sw-2"></i>Collected</span></div></div><div id="revChart" class="chart"></div></section>`;
  }
  if (u.role !== 'finance') {
    const rows = active.map((c) => ({ c, br: burnRate(c, mk) })).filter((r) => r.br.q.quota).sort((a, b) => a.br.q.pct - b.br.q.pct);
    html += `<section class="card"><div class="card-head"><h2>Quota progress — ${fmtMonth(mk).split(' ')[0]}</h2><span class="muted small">Expected by today ≈ ${expectedPct(mk)}%</span></div>
      <div class="prog-list">${rows.map(({ c, br }) => `<a class="prog-row" href="#/clients/${c.id}?tab=quota">
        <div class="prog-top"><span>${esc(c.company)}</span><span class="small">${br.q.completed}/${br.q.quota} · ${br.q.pct}% <span class="chip tone-${br.tone}">${br.label}</span></span></div>
        ${progressBar(br.q.pct, { tone: br.tone === 'muted' ? 'good' : br.tone })}</a>`).join('') || emptyState('No active quotas')}</div></section>`;
  }
  // Team today
  html += `<section class="card"><div class="card-head"><h2>Team today</h2><span class="muted small">${pres.working} working · ${pres.onBreak} on break · ${pres.done} done · ${pres.leave} leave</span></div>
    <div class="presence">${pres.st.map(({ u: p, s }) => `<div class="presence-row">${avatar(p.name, 'sm')}<span class="grow"><b>${esc(p.name)}</b><span class="muted small">${esc(p.designation || '')}</span></span><span class="chip tone-${s.tone}">${esc(s.label)}</span></div>`).join('')}</div></section>`;
  if (u.role !== 'finance') {
    const wl = workloadRows();
    html += `<section class="card"><div class="card-head"><h2>${icon('heat')} Workload</h2><a class="link" href="#/team?tab=workload">Details</a></div>
      <div class="heat-list">${wl.map((w) => `<div class="heat-row"><span class="grow">${esc(w.u.name)}<span class="muted small"> · ${esc(w.u.designation)}</span></span>
        <span class="heat-cell tone-${w.tone}" title="${w.n} open tasks">${w.n}</span><span class="small muted" style="width:86px">${w.label}${w.late ? ` · <b class="text-bad">${w.late} late</b>` : ''}</span></div>`).join('')}</div></section>`;
  }
  if (Perm.canApproveLeave()) {
    const pend = pendingLeavesFor(u);
    html += `<section class="card"><div class="card-head"><h2>Leave requests</h2><a class="link" href="#/team?tab=leave">Review</a></div>
      ${pend.length ? `<div class="mini-list">${pend.slice(0, 4).map((l) => `<div class="mini-row"><div><b>${esc(Store.userName(l.userId))}</b><span class="muted small">${esc(LEAVE_TYPES.find((t) => t.key === l.type).label)} · ${fmtShortDate(l.from)}${l.to !== l.from ? ' – ' + fmtShortDate(l.to) : ''} · ${leaveDays(l)} day(s)</span></div>
        <div class="row-actions"><button class="btn btn-sm" data-leave="${l.id}" data-d="Rejected">Reject</button><button class="btn btn-sm btn-primary" data-leave="${l.id}" data-d="Approved">Approve</button></div></div>`).join('')}</div>` : emptyState('No pending requests')}</section>`;
  }
  if (money) {
    const due = remindersDue(Perm.visiblePayments());
    html += `<section class="card"><div class="card-head"><h2>Payment reminders due</h2><a class="link" href="#/payments?tab=reminders">Open queue</a></div>
      ${due.length ? `<div class="mini-list">${due.slice(0, 5).map((r) => `<div class="mini-row"><div><b>${esc(Store.clientName(r.p.clientId))}</b><span class="muted small">${esc(r.p.invoiceNo)} · ${esc(r.milestone.label)}</span></div><div class="right"><b>${inr(balance(r.p))}</b><span class="small ${r.kind === 'overdue' ? 'text-bad' : 'text-warn'}">${esc(r.label)}</span></div></div>`).join('')}</div>` : emptyState('Nothing to send today')}</section>`;
  }
  html += '</div>';
  main.innerHTML = html;
  if (money) drawRevenueChart($('#revChart'));
  $$('[data-leave]', main).forEach((b) => (b.onclick = () => decideLeave(b.dataset.leave, b.dataset.d)));
};

/* Creative & shoot crew home: their own work and attendance */
function personalDashboard(main, u) {
  const tasks = Perm.visibleTasks().filter((t) => t.assigneeId === u.id || (t.shoot && t.shoot.crewIds.includes(u.id)));
  const open = tasks.filter((t) => !DONE_STATUSES.includes(t.status));
  const late = open.filter((t) => isLate(t));
  const mk = monthKey();
  const doneMonth = tasks.filter((t) => DONE_STATUSES.includes(t.status) && t.completedAt && monthKey(new Date(t.completedAt)) === mk).length;
  const days = dateRange(mk + '-01', todayISO()).map((d) => dayStatus(u.id, d));
  const present = days.filter((d) => ['P', 'L', 'H'].includes(d.code)).length, lates = days.filter((d) => d.code === 'L').length;
  const s = liveStatus(u.id);
  const shoots = Store.tasks.filter((t) => t.type === 'shoot' && t.shoot && (t.shoot.crewIds.includes(u.id) || t.assigneeId === u.id) && !DONE_STATUSES.includes(t.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  main.innerHTML = setTitle(`<h1>Hi ${esc(firstName(u.name))}</h1><p class="muted">${esc(u.designation)} · ${fmtDate(todayISO())}</p>`, `<a class="btn btn-primary" href="#/workspace">${icon('clock')}Open My Day</a>`) + `
    <section class="kpis">
      <a class="kpi" href="#/workspace"><span class="kpi-label">Today</span><span class="kpi-value" style="font-size:18px">${esc(s.label)}</span><span class="kpi-sub">Clock in / out on My Day</span></a>
      <a class="kpi" href="#/tasks"><span class="kpi-label">Open tasks</span><span class="kpi-value">${open.length}</span><span class="kpi-sub">${open.filter((t) => t.dueDate <= addDays(todayISO(), 2)).length} due in 2 days</span></a>
      <a class="kpi ${late.length ? 'kpi-bad' : 'kpi-good'}" href="#/tasks?late=1"><span class="kpi-label">Late</span><span class="kpi-value">${late.length}</span><span class="kpi-sub">past due, not delivered</span></a>
      <div class="kpi kpi-good"><span class="kpi-label">Delivered this month</span><span class="kpi-value">${doneMonth}</span></div>
      <div class="kpi"><span class="kpi-label">Attendance this month</span><span class="kpi-value">${present}<small>/${days.filter((d) => !['WO', ''].includes(d.code)).length}</small></span><span class="kpi-sub">${lates} late arrival${lates === 1 ? '' : 's'}</span></div>
    </section>
    <div class="grid-2">
      <section class="card"><div class="card-head"><h2>Due soon</h2><a class="link" href="#/tasks">Board</a></div>${taskMiniList(open.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8))}</section>
      ${shoots.length ? `<section class="card"><div class="card-head"><h2>${icon('camera')} Upcoming shoots</h2><a class="link" href="#/shoots">Schedule</a></div>${taskMiniList(shoots.slice(0, 5))}</section>` : ''}
    </div>`;
  bindTaskMini(main);
}

function taskMiniList(list) {
  if (!list.length) return emptyState('Nothing here', 'You’re all caught up.');
  return `<div class="mini-list">${list.map((t) => `<button class="mini-row as-btn" data-task="${t.id}"><div><b>${esc(t.title)}</b><span class="muted small">${esc(Store.clientName(t.clientId))} · ${esc(taskType(t.type).label)}</span></div>
    <div class="right">${badge(t.status)}<span class="small">${dueLabel(t)}</span></div></button>`).join('')}</div>`;
}
function bindTaskMini(root) { $$('[data-task]', root).forEach((b) => (b.onclick = () => openTaskModal(Store.task(b.dataset.task)))); }

function activityRow(a) {
  return `<div class="tl-row"><span class="tl-dot"></span><div><div><b>${esc(a.userName)}</b> · ${esc(a.action)}</div><div class="muted small">${esc(a.details)}</div><div class="dim small">${timeAgo(a.ts)}</div></div></div>`;
}

/* Grouped bar chart: invoiced vs collected by invoice month */
function drawRevenueChart(host) {
  const cur = monthKey();
  const months = Array.from({ length: 6 }, (_, i) => addMonths(cur, i - 5));
  const data = months.map((mk) => { const r = revenueSummary(mk); return { mk, expected: r.expected, collected: r.collected }; });
  const max = Math.max(1, ...data.map((d) => d.expected));
  const niceMax = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
  const W = 560, H = 220, L = 52, R = 8, T = 10, B = 26;
  const cw = (W - L - R) / months.length, bw = Math.min(22, cw / 3);
  const y = (v) => T + (H - T - B) * (1 - v / niceMax);
  const bar = (x, v, cls) => {
    const top = y(v), base = y(0), h = Math.max(0, base - top);
    if (h < 1) return '';
    const r = Math.min(4, h, bw / 2);
    return `<path class="${cls}" d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z"/>`;
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Invoiced versus collected revenue for the last six months">`;
  [0, 0.25, 0.5, 0.75, 1].forEach((f) => { const t = niceMax * f; svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${inrShort(t)}</text>`; });
  data.forEach((d, i) => {
    const cx = L + cw * i + cw / 2;
    svg += bar(cx - bw - 1, d.expected, 'bar-1') + bar(cx + 1, d.collected, 'bar-2');
    svg += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${fmtMonthShort(d.mk)}</text><rect class="hit" data-i="${i}" x="${L + cw * i}" y="${T}" width="${cw}" height="${H - T - B}"/>`;
  });
  host.innerHTML = svg + '</svg><div class="tip" hidden></div>';
  const tip = $('.tip', host);
  $$('.hit', host).forEach((r) => {
    const show = () => {
      const d = data[r.dataset.i];
      tip.innerHTML = `<b>${fmtMonth(d.mk)}</b><div><i class="sw sw-1"></i>Invoiced <b>${inr(d.expected)}</b></div><div><i class="sw sw-2"></i>Collected <b>${inr(d.collected)}</b></div><div class="muted">${d.expected ? Math.round((d.collected / d.expected) * 100) : 0}% collected</div>`;
      tip.hidden = false;
      const hb = host.getBoundingClientRect(), rb = r.getBoundingClientRect();
      tip.style.left = Math.max(0, Math.min(hb.width - tip.offsetWidth, rb.left - hb.left + rb.width / 2 - tip.offsetWidth / 2)) + 'px';
      tip.style.top = '0px';
      $$('.hit', host).forEach((h) => h.classList.toggle('on', h === r));
    };
    r.addEventListener('mouseenter', show); r.addEventListener('click', show);
  });
  host.addEventListener('mouseleave', () => { tip.hidden = true; $$('.hit', host).forEach((h) => h.classList.remove('on')); });
}
