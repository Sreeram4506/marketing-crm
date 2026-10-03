/* ==========================================================================
   hr.js — Team directory, employee profiles, attendance matrix, leave
   approvals, workload heatmap, EOD reports, payroll / salary slips
   ========================================================================== */

const teamState = { tab: 'directory', month: '', eodDate: '' };

Views.team = function (main, id, params) {
  if (id) return renderEmployee(main, id);
  const st = teamState;
  const tabs = [['directory', 'Directory'], ['attendance', 'Attendance'], ...(Perm.canApproveLeave() || Perm.is('finance') ? [['leave', 'Leave']] : []), ...(Perm.is('admin', 'pm') ? [['workload', 'Workload'], ['eod', 'EOD reports']] : [])];
  st.tab = tabs.some((t) => t[0] === params.tab) ? params.tab : 'directory';
  if (!st.month) st.month = monthKey();
  const pend = pendingLeavesFor(Store.currentUser()).length;
  main.innerHTML = setTitle('<h1>Team & HR</h1><p class="muted">People, attendance, leave and workload</p>', Perm.canManageHR() ? `<button class="btn btn-primary" id="addEmp">${icon('plus')}Add employee</button>` : '') + `
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/team?tab=${k}" class="${st.tab === k ? 'on' : ''}">${l}${k === 'leave' && pend ? ` <span class="count bad">${pend}</span>` : ''}</a>`).join('')}</div><div id="teamBody"></div>`;
  if ($('#addEmp')) $('#addEmp').onclick = () => openEmployeeForm();
  ({ directory: teamDirectory, attendance: teamAttendance, leave: teamLeave, workload: teamWorkload, eod: teamEod })[st.tab]($('#teamBody'));
};

function teamDirectory(body) {
  const people = Store.users.filter((u) => u.role !== 'client').sort((a, b) => Object.keys(ROLES).indexOf(a.role) - Object.keys(ROLES).indexOf(b.role));
  body.innerHTML = `<div class="role-cards">${Object.entries(ROLES).filter(([k]) => k !== 'client').map(([k, r]) => `<div class="role-card"><b>${r.label}</b><span class="muted small">${r.desc}</span><span class="small">${Store.users.filter((u) => u.role === k && u.status !== 'Inactive').length} people</span></div>`).join('')}</div>
    <section class="card flush"><div class="table-wrap"><table class="table clickable"><thead><tr><th>Name</th><th>Role</th><th class="hide-sm">Department</th><th class="hide-sm">Work arrangement</th><th>Today</th><th class="hide-sm">Status</th></tr></thead><tbody>
    ${people.map((u) => { const s = liveStatus(u.id); return `<tr data-u="${u.id}"><td>${avatar(u.name, 'sm')} <b>${esc(u.name)}</b><div class="muted small">${esc(u.designation)}</div></td>
      <td>${badge(ROLES[u.role].label, { admin: 'violet', pm: 'info', creative: 'teal', shoot: 'warn', finance: 'neutral' }[u.role])}</td><td class="hide-sm">${esc(u.department)}</td><td class="hide-sm">${esc(u.workArrangement)}</td>
      <td><span class="chip tone-${s.tone}">${esc(s.label)}</span></td><td class="hide-sm">${badge(u.status)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
  $$('tr[data-u]', body).forEach((tr) => (tr.onclick = () => (location.hash = '#/team/' + tr.dataset.u)));
}

/* Monthly matrix: Present / Late / Half-day / Leave / Absent + active hours */
function teamAttendance(body) {
  const st = teamState;
  const mk = st.month;
  const days = dateRange(mk + '-01', mk + '-' + pad(daysInMonth(mk)));
  const people = Store.activeUsers();
  const rows = people.map((u) => {
    const cells = days.map((d) => ({ d, s: dayStatus(u.id, d), a: attendanceFor(u.id, d) }));
    const cnt = (code) => cells.filter((c) => c.s.code === code).length;
    return { u, cells, P: cnt('P'), L: cnt('L'), H: cnt('H'), LV: cnt('LV') + cnt('HL') * 0.5, A: cnt('A'), hrs: sum(cells, (c) => workedMs(c.a)) / 3600000 };
  });
  body.innerHTML = `<div class="toolbar"><div class="month-nav"><button class="icon-btn" id="pm" aria-label="Previous month">${icon('chevronL')}</button><b>${fmtMonth(mk)}</b><button class="icon-btn" id="nm" aria-label="Next month">${icon('chevronR')}</button></div>
      <span class="spacer"></span><button class="btn btn-sm" id="expAtt">${icon('download')}Export</button></div>
    <div class="legend-row small"><span><i class="dot tone-good"></i>P present</span><span><i class="dot tone-warn"></i>L late · H half-day</span><span><i class="dot tone-info"></i>LV leave</span><span><i class="dot tone-bad"></i>A absent</span><span><i class="dot tone-muted"></i>WO week off</span></div>
    <section class="card flush"><div class="table-wrap"><table class="table att-matrix"><thead><tr><th class="sticky-col">Employee</th>${days.map((d) => `<th class="${isWeekOff(d) ? 'wo' : ''} ${d === todayISO() ? 'is-today' : ''}">${parseISO(d).getDate()}<small>${'SMTWTFS'[parseISO(d).getDay()]}</small></th>`).join('')}<th class="num">P</th><th class="num">Late</th><th class="num">Leave</th><th class="num">Abs</th><th class="num">Hours</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td class="sticky-col"><a href="#/team/${r.u.id}"><b>${esc(r.u.name)}</b></a></td>${r.cells.map((c) => `<td class="att tone-${c.s.tone}" title="${esc(r.u.name)} · ${fmtDate(c.d)} · ${esc(c.s.label)}${c.a && c.a.clockIn ? ` · in ${fmtTime(c.a.clockIn)}${c.a.clockOut ? ', out ' + fmtTime(c.a.clockOut) : ''} · ${fmtHours(workedMs(c.a))}` : ''}">${esc(c.s.code)}</td>`).join('')}
      <td class="num">${r.P + r.L + r.H}</td><td class="num ${r.L ? 'text-warn' : ''}">${r.L}</td><td class="num">${r.LV}</td><td class="num ${r.A ? 'text-bad' : ''}">${r.A}</td><td class="num"><b>${r.hrs.toFixed(1)}</b></td></tr>`).join('')}</tbody></table></div></section>`;
  $('#pm').onclick = () => { st.month = addMonths(st.month, -1); Router.render(); };
  $('#nm').onclick = () => { st.month = addMonths(st.month, 1); Router.render(); };
  $('#expAtt').onclick = () => exportExcel([['Employee', ...days, 'Present', 'Late', 'Half-day', 'Leave', 'Absent', 'Active hours'], ...rows.map((r) => [r.u.name, ...r.cells.map((c) => c.s.code), r.P, r.L, r.H, r.LV, r.A, r.hrs.toFixed(2)])], `attendance-${mk}`, 'Attendance');
}

function decideLeave(id, decision) {
  const l = Store.data.leaves.find((x) => x.id === id);
  const me = Store.currentUser();
  if (!l || l.userId === me.id) return;
  l.status = decision; l.decidedBy = me.id; l.decidedAt = Date.now();
  Store.log(decision === 'Approved' ? 'Leave approved' : 'Leave rejected', `${Store.userName(l.userId)} — ${LEAVE_TYPES.find((t) => t.key === l.type).label}, ${fmtDate(l.from)}${l.to !== l.from ? ' to ' + fmtDate(l.to) : ''} (${leaveDays(l)} day(s))`, { entity: 'leave', entityId: l.id });
  Store.save(); toast(`Leave ${decision.toLowerCase()}`); Router.render();
}
function teamLeave(body) {
  const me = Store.currentUser();
  const pend = pendingLeavesFor(me);
  const all = Store.data.leaves.slice().sort((a, b) => b.from.localeCompare(a.from));
  const row = (l, actions) => `<tr><td><b>${esc(Store.userName(l.userId))}</b><div class="muted small">${esc((Store.user(l.userId) || {}).designation || '')}</div></td><td>${esc(LEAVE_TYPES.find((t) => t.key === l.type).label)}${l.halfDay ? ' (half)' : ''}</td>
    <td class="nowrap">${fmtShortDate(l.from)}${l.to !== l.from ? ' – ' + fmtShortDate(l.to) : ''}<div class="muted small">${leaveDays(l)} day(s)</div></td><td class="hide-sm">${esc(l.reason)}${l.backupId ? `<div class="muted small">Backup: ${esc(Store.userName(l.backupId))}</div>` : ''}</td>
    <td>${actions ? `<div class="row-actions"><button class="btn btn-sm" data-leave="${l.id}" data-d="Rejected">Reject</button><button class="btn btn-sm btn-primary" data-leave="${l.id}" data-d="Approved">Approve</button></div>` : `${badge(l.status)}${l.decidedBy ? `<div class="muted small">by ${esc(Store.userName(l.decidedBy).split(' ')[0])}</div>` : ''}`}</td></tr>`;
  const bal = Store.activeUsers().map((u) => ({ u, b: leaveBalance(u) }));
  body.innerHTML = `<section class="card flush"><div class="card-head pad-card"><h2>Awaiting approval</h2><span class="muted small">${pend.length}</span></div>
      ${pend.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th class="hide-sm">Reason</th><th></th></tr></thead><tbody>${pend.map((l) => row(l, true)).join('')}</tbody></table></div>` : `<div class="pad-card">${emptyState('No pending requests')}</div>`}</section>
    <section class="card flush"><div class="card-head pad-card"><h2>Leave balances ${new Date().getFullYear()}</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Employee</th>${LEAVE_TYPES.map((t) => `<th class="num">${t.label}</th>`).join('')}</tr></thead><tbody>
      ${bal.map(({ u, b }) => `<tr><td>${esc(u.name)}</td>${b.map((x) => `<td class="num">${x.key === 'unpaid' ? x.used || '—' : `<b class="${x.left <= 1 ? 'text-warn' : ''}">${x.left}</b><span class="muted small">/${x.quota}</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
    <section class="card flush"><div class="card-head pad-card"><h2>All requests</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th class="hide-sm">Reason</th><th>Status</th></tr></thead><tbody>${all.map((l) => row(l, false)).join('')}</tbody></table></div></section>`;
  $$('[data-leave]', body).forEach((b) => (b.onclick = () => decideLeave(b.dataset.leave, b.dataset.d)));
}

function teamWorkload(body) {
  const thr = Number(Store.settings.overloadThreshold) || 8;
  const rows = workloadRows();
  const weeks = [0, 1, 2, 3].map((w) => ({ from: addDays(todayISO(), w * 7 - ((new Date().getDay() + 6) % 7)), label: w === 0 ? 'This week' : w === 1 ? 'Next week' : `+${w} weeks` }));
  body.innerHTML = `<p class="muted">Open tasks per person. <b>${thr}+</b> active tasks = overloaded (change in Settings). Columns show tasks due each week.</p>
    <section class="card flush"><div class="table-wrap"><table class="table heat"><thead><tr><th>Team member</th><th class="num">Open</th><th class="num">Late</th>${weeks.map((w) => `<th class="num">${w.label}</th>`).join('')}<th>Load</th></tr></thead><tbody>
    ${rows.map((r) => { const open = Store.tasks.filter((t) => t.assigneeId === r.u.id && !DONE_STATUSES.includes(t.status)); return `<tr><td><b>${esc(r.u.name)}</b><div class="muted small">${esc(r.u.designation)} · ${esc(liveStatus(r.u.id).label)}</div></td>
      <td class="num"><span class="heat-cell tone-${r.tone}">${r.n}</span></td><td class="num ${r.late ? 'text-bad' : ''}">${r.late || '—'}</td>
      ${weeks.map((w) => { const n = open.filter((t) => t.dueDate >= w.from && t.dueDate < addDays(w.from, 7)).length; return `<td class="num"><span class="heat-cell tone-${n >= thr / 2 ? 'bad' : n >= thr / 4 ? 'warn' : n ? 'good' : 'muted'}">${n}</span></td>`; }).join('')}
      <td style="min-width:140px">${progressBar(Math.min(100, Math.round((r.n / thr) * 100)), { tone: r.tone === 'muted' ? 'good' : r.tone })}<span class="small">${r.label}</span> <a class="small" href="#/tasks?assignee=${r.u.id}">View tasks</a></td></tr>`; }).join('')}</tbody></table></div></section>`;
}

function teamEod(body) {
  const st = teamState;
  if (!st.eodDate) st.eodDate = Store.data.eod.map((e) => e.date).sort().pop() || todayISO();
  const staff = Store.activeUsers().filter((u) => ['creative', 'shoot'].includes(u.role));
  const list = Store.data.eod.filter((e) => e.date === st.eodDate);
  body.innerHTML = `<div class="toolbar"><label class="inline-field">Date <input type="date" id="eodDate" value="${st.eodDate}"></label></div>
    <section class="card flush"><div class="table-wrap"><table class="table"><thead><tr><th>Team member</th><th>Completed</th><th class="hide-sm">Pending</th><th>Blockers</th></tr></thead><tbody>
    ${staff.map((u) => { const e = list.find((x) => x.userId === u.id); const s = dayStatus(u.id, st.eodDate); return `<tr><td><b>${esc(u.name)}</b><div class="muted small">${esc(s.label)}</div></td>
      ${e ? `<td>${esc(e.completedSummary)}</td><td class="hide-sm">${e.pending.map((p) => { const t = Store.task(p.taskId); return t ? `<div class="small">${esc(t.title)} — ${esc(p.reason || '…')} <span class="muted">(ETA ${fmtShortDate(p.eta)})</span></div>` : ''; }).join('') || '—'}</td><td>${e.blockers ? `<span class="text-warn">${esc(e.blockers)}</span>` : '—'}</td>`
        : `<td colspan="3" class="muted">${['LV', 'WO', 'HL'].includes(s.code) ? 'Not working' : 'No EOD submitted'}</td>`}</tr>`; }).join('')}</tbody></table></div></section>`;
  $('#eodDate').onchange = (e) => { st.eodDate = e.target.value; Router.render(); };
}

/* ---------- Employee profile ---------- */
function renderEmployee(main, id) {
  const u = Store.user(id);
  if (!u) { main.innerHTML = emptyState('Employee not found'); return; }
  const sens = Perm.canSeeSensitiveHR();
  const s = liveStatus(u.id);
  const open = Store.tasks.filter((t) => t.assigneeId === u.id && !DONE_STATUSES.includes(t.status));
  const row = (k, v) => `<div class="dl-row"><dt>${k}</dt><dd>${v || '<span class="muted">—</span>'}</dd></div>`;
  const link = (x, t) => (x ? linkHtml(x, t) : '<span class="text-warn">Not uploaded</span>');
  main.innerHTML = `<a class="back" href="#/team">${icon('chevronL')} Team</a>
    <div class="profile-head card"><div class="profile-id"><span class="avatar lg">${esc(initials(u.name))}</span><div><h1>${esc(u.name)} ${badge(u.status)}</h1>
      <p class="muted">${esc(u.designation)} · ${esc(u.department)} · ${esc(ROLES[u.role].label)}</p><p><span class="chip tone-${s.tone}">${esc(s.label)}</span></p></div></div>
      <div class="page-actions">${Perm.canManageHR() && Api.mode === 'server' && u.id !== Store.currentUser().id ? `<button class="btn" id="endSess" title="Lost laptop or leaving? End all their sessions">${icon('logout')}End sessions</button>${u.twoFactor ? `<button class="btn" id="reset2fa">${icon('shield')}Reset 2FA</button>` : ''}` : ''}${Perm.canManageHR() ? `<button class="btn" id="editEmp">${icon('edit')}Edit</button>` : ''}${Perm.canRunPayroll() && u.ctc ? `<button class="btn" id="slip">${icon('wallet')}Salary slip</button>` : ''}</div></div>
    <div class="grid-2"><div class="stack">
      <section class="card"><div class="card-head"><h2>Profile</h2></div><dl class="dl">
        ${row('Email', `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>`)}${row('Phone', esc(u.phone))}${row('Emergency contact', [u.emergencyContact.name, u.emergencyContact.phone].filter(Boolean).map(esc).join(' · '))}
        ${row('Date of joining', fmtDate(u.joinDate))}${row('Work arrangement', esc(u.workArrangement))}</dl></section>
      ${sens ? `<section class="card"><div class="card-head"><h2>${icon('shield')} Compensation & documents</h2><span class="muted small">Admin & finance only</span></div><dl class="dl">
        ${row('CTC (annual)', u.ctc ? inr(u.ctc) + ` <span class="muted small">(${inr(u.ctc / 12)}/month)</span>` : '')}
        ${row('Bank account', [u.bank.holder, u.bank.account, u.bank.ifsc].filter(Boolean).map(esc).join(' · '))}
        ${row('Government ID', `${esc(u.idProof.type)} ${esc(u.idProof.number)} ${u.idProof.verified ? '<span class="chip tone-good">Verified</span>' : '<span class="chip tone-warn">Not verified</span>'}`)}
        ${row('Signed NDA', link(u.docs.nda, 'View NDA'))}${row('Contract', link(u.docs.contract, 'View contract'))}${row('ID proof copy', link((u.docs || {}).idCopy, 'View ID'))}</dl></section>` : ''}
      <section class="card"><div class="card-head"><h2>Leave balance</h2></div><div class="deliv-summary">${leaveBalance(u).map((b) => `<div><span class="muted small">${b.label}</span><b>${b.key === 'unpaid' ? b.used : b.left}</b><span class="dim small">${b.key === 'unpaid' ? 'days taken' : `of ${b.quota}`}</span></div>`).join('')}</div></section>
    </div><div class="stack">
      <section class="card"><div class="card-head"><h2>Attendance — ${fmtMonth(monthKey())}</h2></div>${myMonthStrip(u)}</section>
      <section class="card"><div class="card-head"><h2>Open tasks (${open.length})</h2><a class="link" href="#/tasks?assignee=${u.id}">All</a></div>${taskMiniList(open.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8))}</section>
      <section class="card"><div class="card-head"><h2>Recent EOD reports</h2></div>${myEods(u)}</section>
    </div></div>`;
  bindTaskMini(main);
  $$('[data-eod]', main).forEach((b) => (b.onclick = () => showEod(Store.data.eod.find((e) => e.id === b.dataset.eod))));
  if ($('#editEmp')) $('#editEmp').onclick = () => openEmployeeForm(u);
  if ($('#endSess')) $('#endSess').onclick = async () => { if (await confirmDialog('End all sessions?', `${u.name} will be signed out on every device.`, 'End sessions', true)) { try { await Api.req('POST', `/users/${u.id}/logout`); toast('Sessions ended'); } catch (x) { toast(x.message, 'error'); } } };
  if ($('#reset2fa')) $('#reset2fa').onclick = async () => { if (await confirmDialog('Reset two-factor?', `${u.name} will sign in with just their password until they set up 2FA again.`, 'Reset 2FA', true)) { try { await Api.req('POST', `/users/${u.id}/reset-2fa`); toast('2FA reset'); await Store.load(); Router.render(); } catch (x) { toast(x.message, 'error'); } } };
  if ($('#slip')) $('#slip').onclick = () => openSlip(u, addMonths(monthKey(), -1));
}

function openEmployeeForm(user) {
  const isNew = !user;
  const u = user ? clone(user) : { name: '', email: '', phone: '', role: 'creative', designation: '', department: 'Design', workArrangement: WORK_ARRANGEMENTS[0], status: 'Active', joinDate: todayISO(),
    emergencyContact: { name: '', phone: '' }, ctc: 0, bank: { holder: '', account: '', ifsc: '' }, idProof: { type: 'PAN', number: '', verified: false }, docs: { nda: '', contract: '' }, leaveQuota: { casual: 12, sick: 8, pto: 12 } };
  const isSelf = user && user.id === Store.currentUser().id;
  const m = Modal.open({ title: isNew ? 'Add employee' : `Edit ${user.name}`, size: 'lg',
    body: `<form id="empForm" class="form-grid">
      <h3 class="full form-section">Basic info</h3>
      ${field('Full name', inputEl('name', u.name), { required: true })}${field('Designation', inputEl('designation', u.designation, { placeholder: 'e.g. Video Editor' }))}
      ${field('Role (access level)', selectEl('role', Object.entries(ROLES).filter(([k]) => k !== 'client').map(([k, r]) => ({ value: k, label: r.label })), u.role, { attrs: isSelf ? 'disabled' : '' }), { hint: isSelf ? 'You can’t change your own role' : '' })}
      ${field('Department', selectEl('department', DEPARTMENTS, u.department))}
      ${field('Email', inputEl('email', u.email, { type: 'email' }), { required: true })}${field('Phone', inputEl('phone', u.phone, { type: 'tel' }))}
      ${field('Emergency contact name', inputEl('ec_name', u.emergencyContact.name))}${field('Emergency contact phone', inputEl('ec_phone', u.emergencyContact.phone, { type: 'tel' }))}
      ${field('Date of joining', inputEl('joinDate', u.joinDate, { type: 'date' }))}${field('Work arrangement', selectEl('workArrangement', WORK_ARRANGEMENTS, u.workArrangement))}
      ${field('Employment status', selectEl('status', EMPLOYEE_STATUSES, u.status, { attrs: isSelf ? 'disabled' : '' }))}
      ${Api.mode === 'server' && isNew && Api.info.emailEnabled ? '<label class="check full"><input type="checkbox" name="invite" checked> Email them an invite to choose their own password (recommended)</label>' : ''}
      ${Api.mode === 'server' && !isSelf ? field(isNew ? 'Or set a login password now' : 'Set a new login password', inputEl('password', '', { type: 'password', attrs: 'autocomplete="new-password" minlength="8"' }), { hint: isNew ? '8+ characters. Share it privately; they can change it after signing in.' : 'Leave blank to keep their current password' }) : ''}
      <h3 class="full form-section">Compensation & documents</h3>
      ${field('CTC per year (₹)', inputEl('ctc', u.ctc, { type: 'number', attrs: 'min="0" step="1000"' }))}
      ${field('Bank account holder', inputEl('b_holder', u.bank.holder))}${field('Account number', inputEl('b_acc', u.bank.account))}${field('IFSC', inputEl('b_ifsc', u.bank.ifsc, { attrs: 'style="text-transform:uppercase"' }))}
      ${field('Government ID type', selectEl('id_type', ['Aadhaar', 'PAN', 'Passport', 'Voter ID', 'Driving licence'], u.idProof.type))}
      ${field('ID number', inputEl('id_no', u.idProof.number, { placeholder: 'Store only the last 4 digits of Aadhaar' }))}
      <label class="check full"><input type="checkbox" name="id_ok" ${u.idProof.verified ? 'checked' : ''}> ID verified against original document</label>
      ${field('Signed NDA', linkField('nda', u.docs.nda, { scope: 'hr' }))}${field('Contract', linkField('contract', u.docs.contract, { scope: 'hr' }))}${field('ID proof copy', linkField('idcopy', (u.docs || {}).idCopy || '', { scope: 'hr' }), { full: true })}
      <h3 class="full form-section">Leave allowance per year</h3>
      ${field('Casual', inputEl('lq_casual', u.leaveQuota.casual, { type: 'number', attrs: 'min="0"' }))}${field('Sick', inputEl('lq_sick', u.leaveQuota.sick, { type: 'number', attrs: 'min="0"' }))}${field('Paid time off', inputEl('lq_pto', u.leaveQuota.pto, { type: 'number', attrs: 'min="0"' }))}
      <p class="form-error full" hidden></p></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="empSave">${isNew ? 'Add employee' : 'Save'}</button>` });
  $('#empSave', m).onclick = async () => {
    const d = formData($('#empForm', m)), err = $('.form-error', m);
    if (Api.mode === 'server' && d.password && (d.password.length < 10 || !/\d|[^a-z0-9]/i.test(d.password))) { err.textContent = PASSWORD_RULE + '.'; err.hidden = false; return; }
    if (Api.mode === 'server' && isNew && !d.password && !d.invite) { err.textContent = 'Send an invite or set a password so they can sign in.'; err.hidden = false; return; }
    if (!d.name.trim() || !/^\S+@\S+\.\S+$/.test(d.email.trim())) { err.textContent = 'Add a name and a valid email.'; err.hidden = false; return; }
    if (Store.users.some((x) => x.email.toLowerCase() === d.email.trim().toLowerCase() && x.id !== (user && user.id))) { err.textContent = 'Another employee already uses that email.'; err.hidden = false; return; }
    const next = { name: d.name.trim(), designation: d.designation.trim(), role: isSelf ? user.role : d.role, department: d.department, email: d.email.trim(), phone: d.phone.trim(),
      emergencyContact: { name: d.ec_name.trim(), phone: d.ec_phone.trim() }, joinDate: d.joinDate, workArrangement: d.workArrangement, status: isSelf ? user.status : d.status,
      ctc: Number(d.ctc) || 0, bank: { holder: d.b_holder.trim(), account: d.b_acc.trim(), ifsc: d.b_ifsc.trim().toUpperCase() },
      idProof: { type: d.id_type, number: d.id_no.trim(), verified: !!d.id_ok }, docs: { nda: normLink(d.nda), contract: normLink(d.contract), idCopy: normLink(d.idcopy) },
      leaveQuota: { casual: Number(d.lq_casual) || 0, sick: Number(d.lq_sick) || 0, pto: Number(d.lq_pto) || 0 } };
    let savedId = user && user.id;
    if (isNew) { const nu = { id: uid('u'), ...next }; savedId = nu.id; Store.users.push(nu); Store.log('Employee added', `${nu.name} — ${nu.designation} (${ROLES[nu.role].label})`, { entity: 'employee', entityId: nu.id }); }
    else {
      const ch = [];
      if (user.role !== next.role) ch.push(`role ${ROLES[user.role].label} → ${ROLES[next.role].label}`);
      if (user.status !== next.status) ch.push(`status ${user.status} → ${next.status}`);
      if (user.ctc !== next.ctc) ch.push('compensation changed');
      if (!user.idProof.verified && next.idProof.verified) ch.push('ID verified');
      Object.assign(user, next);
      Store.log('Employee updated', `${user.name}${ch.length ? ' — ' + ch.join(', ') : ''}`, { entity: 'employee', entityId: user.id });
    }
    Store.save();
    if (Api.mode === 'server' && (d.password || d.invite)) {
      try {
        await Api.flush();
        if (d.password) await Api.req('POST', `/users/${savedId}/password`, { password: d.password });
        if (d.invite) await Api.req('POST', `/users/${savedId}/invite`);
        toast(d.invite ? 'Saved — invite emailed' : 'Saved — login password set');
      } catch (x) { toast('Saved, but: ' + x.message, 'error'); }
    } else toast('Saved');
    Modal.close(); Router.render();
  };
}

/* ---------- Payroll ---------- */
const payrollState = { month: '' };
Views.payroll = function (main, _id, params = {}) {
  if (/^\d{4}-\d{2}$/.test(params.month || '')) { payrollState.month = params.month; history.replaceState(null, '', '#/payroll'); } // e.g. opened by the AI co-founder
  if (!payrollState.month) payrollState.month = addMonths(monthKey(), -1);
  const mk = payrollState.month;
  const people = Store.users.filter((u) => u.role !== 'client' && u.status !== 'Inactive' && u.ctc && (!u.joinDate || u.joinDate <= mk + '-31'));
  const rows = people.map((u) => ({ u, p: payslip(u, mk) }));
  main.innerHTML = setTitle('<h1>Payroll</h1><p class="muted">Salary estimates from CTC and attendance — review before paying</p>', `<button class="btn" id="expPay">${icon('download')}Export</button>`) + `
    <div class="toolbar"><div class="month-nav"><button class="icon-btn" id="pm" aria-label="Previous month">${icon('chevronL')}</button><b>${fmtMonth(mk)}</b><button class="icon-btn" id="nm" aria-label="Next month">${icon('chevronR')}</button></div>
      ${mk >= monthKey() ? '<span class="chip tone-warn">Month in progress — figures will change</span>' : ''}</div>
    <section class="kpis compact"><div class="kpi"><span class="kpi-label">Gross payroll</span><span class="kpi-value">${inrShort(sum(rows, (r) => r.p.monthly))}</span></div>
      <div class="kpi"><span class="kpi-label">Deductions</span><span class="kpi-value">${inrShort(sum(rows, (r) => r.p.deductions))}</span></div>
      <div class="kpi kpi-good"><span class="kpi-label">Net payout</span><span class="kpi-value">${inrShort(sum(rows, (r) => r.p.net))}</span></div></section>
    <section class="card flush"><div class="table-wrap"><table class="table"><thead><tr><th>Employee</th><th class="num">Gross</th><th class="num">LOP days</th><th class="num hide-sm">LOP</th><th class="num hide-sm">PF</th><th class="num hide-sm">PT / TDS</th><th class="num">Net pay</th><th></th></tr></thead><tbody>
    ${rows.map(({ u, p }) => `<tr><td><b>${esc(u.name)}</b><div class="muted small">${esc(u.designation)}${p.freelancer ? ' · contractor' : ''}</div></td><td class="num">${inr(p.monthly)}</td><td class="num ${p.lop ? 'text-warn' : ''}">${p.lop}</td>
      <td class="num hide-sm">${p.lopAmt ? '− ' + inr(p.lopAmt) : '—'}</td><td class="num hide-sm">${p.pf ? '− ' + inr(p.pf) : '—'}</td><td class="num hide-sm">${p.pt || p.tds ? '− ' + inr(p.pt + p.tds) : '—'}</td><td class="num"><b>${inr(p.net)}</b></td>
      <td class="actions-col"><button class="btn btn-sm" data-slip="${u.id}">${icon('print')}Slip</button></td></tr>`).join('')}</tbody></table></div></section>
    <p class="muted small pad-top">Salary = CTC ÷ 12, split 50% basic / 20% HRA / 30% special. LOP (loss of pay) = unpaid leave + absent working days + ½ per half-day. PF 12% of basic (capped at ₹15,000) ${Store.settings.pfEnabled ? 'is on' : 'is off'} in Settings; professional tax ₹200; contractors get 10% TDS instead. Check with your CA before paying.</p>`;
  $('#pm').onclick = () => { payrollState.month = addMonths(mk, -1); Router.render(); };
  $('#nm').onclick = () => { payrollState.month = addMonths(mk, 1); Router.render(); };
  $$('[data-slip]', main).forEach((b) => (b.onclick = () => openSlip(Store.user(b.dataset.slip), mk)));
  $('#expPay').onclick = () => exportExcel([['Employee', 'Designation', 'Gross', 'Basic', 'HRA', 'Special', 'Working days', 'LOP days', 'LOP amount', 'PF', 'Professional tax', 'TDS', 'Net pay', 'Bank account', 'IFSC'],
    ...rows.map(({ u, p }) => [u.name, u.designation, p.monthly, p.basic, p.hra, p.special, p.workDays, p.lop, p.lopAmt, p.pf, p.pt, p.tds, p.net, u.bank.account, u.bank.ifsc])], `payroll-${mk}`, 'Payroll');
};
function openSlip(u, mk) {
  const p = payslip(u, mk), s = Store.settings;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Salary slip — ${esc(u.name)} — ${fmtMonth(mk)}</title><style>${DOC_CSS} .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}</style></head><body>
    <div class="noprint">Press Ctrl + P (⌘ + P on Mac) to print or save as PDF</div><div class="doc">
    <div class="top"><div><b style="font-size:17px">${esc(s.agencyName)}</b><div class="muted">${esc(s.agencyAddress)}</div></div><div class="meta"><h1>SALARY SLIP</h1><div>${fmtMonth(mk)}</div></div></div>
    <table style="margin-top:18px"><tbody><tr><td>Employee</td><td><b>${esc(u.name)}</b></td><td>Designation</td><td>${esc(u.designation)}</td></tr>
      <tr><td>Department</td><td>${esc(u.department)}</td><td>Date of joining</td><td>${fmtDate(u.joinDate)}</td></tr>
      <tr><td>Bank account</td><td>${esc(u.bank.account)} · ${esc(u.bank.ifsc)}</td><td>Working days / LOP</td><td>${p.workDays} / ${p.lop}</td></tr></tbody></table>
    <div class="grid" style="margin-top:14px"><table><thead><tr><th>Earnings</th><th class="num">₹</th></tr></thead><tbody><tr><td>Basic</td><td class="num">${inr(p.basic)}</td></tr><tr><td>HRA</td><td class="num">${inr(p.hra)}</td></tr><tr><td>Special allowance</td><td class="num">${inr(p.special)}</td></tr><tr><td><b>Gross</b></td><td class="num"><b>${inr(p.monthly)}</b></td></tr></tbody></table>
      <table><thead><tr><th>Deductions</th><th class="num">₹</th></tr></thead><tbody><tr><td>Loss of pay (${p.lop} days)</td><td class="num">${inr(p.lopAmt)}</td></tr><tr><td>Provident fund</td><td class="num">${inr(p.pf)}</td></tr><tr><td>Professional tax</td><td class="num">${inr(p.pt)}</td></tr><tr><td>TDS</td><td class="num">${inr(p.tds)}</td></tr><tr><td><b>Total</b></td><td class="num"><b>${inr(p.deductions)}</b></td></tr></tbody></table></div>
    <div class="totals"><div class="grand"><span>Net pay</span><span>${inr(p.net)}</span></div></div>
    <div class="words">Indian Rupees ${numberToWordsIN(p.net)} Only</div>
    <p class="muted" style="margin-top:28px">This is a computer-generated salary slip.</p></div></body></html>`;
  openDocModal(`Salary slip — ${u.name}`, html, `salary-slip-${u.name.replace(/\s+/g, '-')}-${mk}.html`);
  Store.log('Salary slip generated', `${u.name} — ${fmtMonth(mk)} (net ${inr(p.net)})`, { entity: 'employee', entityId: u.id });
  Store.save();
}
