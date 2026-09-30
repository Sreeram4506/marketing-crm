/* ==========================================================================
   workspace.js — Employee daily workspace: clock in/out, breaks, task timer,
   mandatory EOD report on clock-out, leave requests
   ========================================================================== */

let wsTicker = null;
window.addEventListener('hashchange', () => { if (wsTicker) { clearInterval(wsTicker); wsTicker = null; } });

async function captureIp() {
  if (Api.mode === 'server' || !Store.settings.captureIp) return ''; // in server mode the API records the real IP
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 3000);
    const r = await fetch('https://api.ipify.org?format=json', { signal: ctl.signal });
    return (await r.json()).ip || '';
  } catch (e) { return 'unavailable'; }
}

function runningTimer(u) { return u.timer && u.timer.taskId ? u.timer : null; }
function stopTimer(u, reason = '') {
  const tm = runningTimer(u);
  if (!tm) return;
  const t = Store.task(tm.taskId);
  if (t) { t.timeLogs = t.timeLogs || []; t.timeLogs.push({ userId: u.id, start: tm.start, end: Date.now() }); }
  u.timer = null;
  if (t && reason) Store.log('Timer stopped', `${t.title} — ${fmtHours(Date.now() - tm.start)} (${reason})`, { entity: 'task', entityId: t.id, clientId: t.clientId });
}
function taskTime(t, userId) { return sum((t.timeLogs || []).filter((l) => !userId || l.userId === userId), (l) => l.end - l.start); }

Views.workspace = function (main) {
  if (wsTicker) { clearInterval(wsTicker); wsTicker = null; }
  const u = Store.currentUser();
  const today = todayISO();
  const a = attendanceFor(u.id, today);
  const s = liveStatus(u.id);
  const brk = openBreak(a);
  const lv = leaveOn(u.id, today);
  const stale = Store.data.attendance.find((x) => x.userId === u.id && x.date < today && x.clockIn && !x.clockOut);
  const tm = runningTimer(u);
  const mine = Store.tasks.filter((t) => t.assigneeId === u.id && !DONE_STATUSES.includes(t.status));
  const todayList = mine.filter((t) => t.dueDate <= today || ['Design / Editing', 'Scripting / Brief'].includes(t.status) && t.dueDate <= addDays(today, 2)).sort((x, y) => x.dueDate.localeCompare(y.dueDate));
  const pendingBucket = mine.filter((t) => !todayList.includes(t)).sort((x, y) => x.dueDate.localeCompare(y.dueDate));
  const reviewing = Store.tasks.filter((t) => t.reviewerId === u.id && t.status === 'Internal Review');
  const doneToday = Store.tasks.filter((t) => t.completedBy === u.id && t.completedAt && toISO(new Date(t.completedAt)) === today);

  let actions = '';
  if (!a || !a.clockIn) actions = `<button class="btn btn-primary btn-lg" id="clockIn">${icon('play')}Clock in</button>`;
  else if (!a.clockOut) actions = brk
    ? `<button class="btn btn-primary btn-lg" id="endBreak">${icon('play')}End ${esc(brk.type.toLowerCase())}</button>`
    : `${BREAK_TYPES.map((b) => `<button class="btn btn-lg" data-break="${b}">${icon('coffee')}${b}</button>`).join('')}<button class="btn btn-danger btn-lg" id="clockOut">${icon('stop')}Clock out</button>`;

  main.innerHTML = setTitle(`<h1>My Day</h1><p class="muted">${parseISO(today).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>`, `<button class="btn" id="reqLeave">${icon('calendar')}Request leave</button>`) + `
    ${stale ? `<div class="alert alert-warn">${icon('alert')} You didn’t clock out on ${fmtDate(stale.date)}. <label class="inline-field">Clock-out time <input type="time" id="staleTime" value="${Store.settings.workEnd}"></label><button class="btn btn-sm" id="fixStale">Save</button></div>` : ''}
    <section class="card clock-card">
      <div class="clock-main">
        <div><span class="kpi-label">Status</span><div class="clock-status"><span class="dot-live tone-${s.tone}"></span>${esc(lv && !(a && a.clockIn) ? 'On leave today' : s.label)}</div>
          <div class="muted small">${a && a.clockIn ? `In at ${fmtTime(a.clockIn)}${a.clockOut ? ` · out at ${fmtTime(a.clockOut)}` : ''}${a.ip ? ` · IP ${esc(a.ip)}` : ''}` : `Office hours ${esc(Store.settings.workStart)}–${esc(Store.settings.workEnd)}`}</div></div>
        <div class="clock-hours"><span class="kpi-label">Active hours</span><b id="activeHrs">${fmtHours(workedMs(a))}</b><span class="muted small">breaks ${fmtHours(a ? breakMs(a) : 0)}</span></div>
      </div>
      <div class="clock-actions">${lv && !(a && a.clockIn) ? '<span class="muted">Enjoy your day off!</span>' : actions}</div>
      ${a && a.breaks.length ? `<div class="break-log">${a.breaks.map((b) => `<span class="chip">${icon('coffee', 'xs')} ${esc(b.type)} ${fmtTime(b.start)}–${b.end ? fmtTime(b.end) : 'now'}</span>`).join('')}</div>` : ''}
    </section>
    ${tm ? `<div class="alert alert-info timer-bar">${icon('clock')} Timer running on <b>${esc((Store.task(tm.taskId) || {}).title || '')}</b> · <span id="timerVal">${fmtHours(Date.now() - tm.start)}</span><span class="spacer"></span><button class="btn btn-sm" id="stopTimer">${icon('stop')}Stop</button></div>` : ''}
    <div class="grid-2">
      <section class="card"><div class="card-head"><h2>My tasks today</h2><span class="muted small">${todayList.length} to focus on</span></div>${wsTaskList(todayList, u, tm)}</section>
      <div class="stack">
        ${reviewing.length ? `<section class="card"><div class="card-head"><h2>Waiting for my review</h2></div>${wsTaskList(reviewing, u, tm, false)}</section>` : ''}
        <section class="card"><div class="card-head"><h2>Done today</h2><span class="muted small">${doneToday.length}</span></div>${doneToday.length ? `<div class="mini-list">${doneToday.map((t) => `<div class="mini-row"><div><b>${esc(t.title)}</b><span class="muted small">${esc(Store.clientName(t.clientId))}</span></div>${badge(t.status)}</div>`).join('')}</div>` : '<p class="muted small">Move a task to Ready to Publish and it shows here — it’s pulled into your EOD report automatically.</p>'}</section>
        <section class="card"><div class="card-head"><h2>Pending bucket</h2><span class="muted small">${pendingBucket.length}</span></div>${wsTaskList(pendingBucket.slice(0, 12), u, tm)}</section>
      </div>
    </div>
    <div class="grid-2">
      <section class="card"><div class="card-head"><h2>Leave balance ${new Date().getFullYear()}</h2></div>
        <div class="deliv-summary">${leaveBalance(u).filter((b) => b.key !== 'unpaid' || b.used).map((b) => `<div><span class="muted small">${b.label}</span><b>${b.key === 'unpaid' ? b.used + ' used' : `${b.left} left`}</b>${b.key !== 'unpaid' ? `<span class="dim small">${b.used} of ${b.quota} used</span>` : ''}</div>`).join('')}</div>
        <h3 class="form-section">My requests</h3>${myLeaves(u)}</section>
      <section class="card"><div class="card-head"><h2>My attendance — ${fmtMonth(monthKey())}</h2></div>${myMonthStrip(u)}
        <h3 class="form-section">Recent EOD reports</h3>${myEods(u)}</section>
    </div>`;

  const save = () => { Store.save(); Router.render(); };
  if ($('#clockIn')) $('#clockIn').onclick = async () => {
    const ip = await captureIp();
    const rec = attendanceFor(u.id, today) || { id: uid('att'), userId: u.id, date: today, clockIn: null, clockOut: null, breaks: [], ip: '', eodId: '' };
    rec.clockIn = Date.now(); rec.ip = ip;
    if (!Store.data.attendance.includes(rec)) Store.data.attendance.push(rec);
    const late = rec.clockIn > atTime(today, Store.settings.workStart) + (Number(Store.settings.graceMinutes) || 0) * 60000;
    Store.log('Clocked in', `${u.name} at ${fmtTime(rec.clockIn)}${late ? ' (late)' : ''}${ip ? ' · IP ' + ip : ''}`, { entity: 'attendance', entityId: rec.id });
    toast(late ? 'Clocked in — marked late' : 'Clocked in. Have a great day!', late ? 'warn' : 'ok'); save();
  };
  $$('[data-break]', main).forEach((b) => (b.onclick = () => {
    stopTimer(u, 'break');
    a.breaks.push({ type: b.dataset.break, start: Date.now(), end: null });
    Store.log('Break started', `${u.name} — ${b.dataset.break}`, { entity: 'attendance', entityId: a.id }); save();
  }));
  if ($('#endBreak')) $('#endBreak').onclick = () => { brk.end = Date.now(); Store.log('Break ended', `${u.name} — ${brk.type} (${fmtHours(brk.end - brk.start)})`, { entity: 'attendance', entityId: a.id }); save(); };
  if ($('#clockOut')) $('#clockOut').onclick = () => openEodModal(u, a);
  if ($('#stopTimer')) $('#stopTimer').onclick = () => { stopTimer(u, 'stopped'); save(); };
  if ($('#reqLeave')) $('#reqLeave').onclick = () => openLeaveRequest(u);
  if ($('#fixStale')) $('#fixStale').onclick = () => {
    const [h, m] = $('#staleTime').value.split(':').map(Number);
    const d = parseISO(stale.date); d.setHours(h, m, 0, 0);
    if (d.getTime() <= stale.clockIn) return toast('Clock-out must be after clock-in', 'warn');
    stale.clockOut = d.getTime(); (stale.breaks || []).forEach((b) => { if (!b.end) b.end = Math.min(b.start + 30 * 60000, stale.clockOut); });
    Store.log('Attendance corrected', `${u.name} set missed clock-out for ${fmtDate(stale.date)} to ${fmtTime(stale.clockOut)}`, { entity: 'attendance', entityId: stale.id }); save();
  };
  $$('[data-timer]', main).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    if (!a || !a.clockIn || a.clockOut) return toast('Clock in first to track time', 'warn');
    if (openBreak(a)) return toast('End your break first', 'warn');
    const id = b.dataset.timer;
    const wasMine = tm && tm.taskId === id;
    stopTimer(u, 'switched');
    if (!wasMine) { u.timer = { taskId: id, start: Date.now() }; const t = Store.task(id); if (t.status === 'Backlog' || t.status === 'Scripting / Brief') applyStatus(t, 'Design / Editing'); }
    save();
  }));
  $$('[data-adv]', main).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const t = Store.task(b.dataset.adv); setTaskStatus(t, TASK_STATUSES[TASK_STATUSES.indexOf(t.status) + 1]); }));
  $$('.ws-task', main).forEach((r) => (r.onclick = () => openTaskModal(Store.task(r.dataset.id))));
  $$('[data-cancel-leave]', main).forEach((b) => (b.onclick = () => {
    const l = Store.data.leaves.find((x) => x.id === b.dataset.cancelLeave);
    Store.data.leaves = Store.data.leaves.filter((x) => x !== l);
    Store.log('Leave request withdrawn', `${u.name} — ${fmtDate(l.from)}`, { entity: 'leave', entityId: l.id }); save();
  }));
  $$('[data-eod]', main).forEach((b) => (b.onclick = () => showEod(Store.data.eod.find((e) => e.id === b.dataset.eod))));
  if (a && a.clockIn && !a.clockOut) wsTicker = setInterval(() => {
    const el = $('#activeHrs'); if (!el) return clearInterval(wsTicker);
    el.textContent = fmtHours(workedMs(a));
    const tv = $('#timerVal'); if (tv && u.timer) tv.textContent = fmtHours(Date.now() - u.timer.start);
  }, 20000);
};

function wsTaskList(list, u, tm, showTimer = true) {
  if (!list.length) return '<p class="muted small">Nothing here.</p>';
  return `<div class="mini-list">${list.map((t) => { const running = tm && tm.taskId === t.id; const nextS = TASK_STATUSES[TASK_STATUSES.indexOf(t.status) + 1]; const spent = taskTime(t, u.id); return `<div class="mini-row ws-task ${riskClass(t)}" data-id="${t.id}" role="button" tabindex="0">
    <div><b>${esc(t.title)}</b><span class="muted small">${esc(Store.clientName(t.clientId))} · ${esc(taskType(t.type).label)} · ${badge(t.priority)}${spent ? ` · ${fmtHours(spent)} logged` : ''}</span><span class="small">${badge(t.status)} ${dueLabel(t)}</span></div>
    <div class="row-actions">${showTimer ? `<button class="btn btn-sm ${running ? 'btn-danger' : ''}" data-timer="${t.id}" title="${running ? 'Stop timer' : 'Start timer'}">${icon(running ? 'pause' : 'play')}${running ? 'Stop' : 'Start'}</button>` : ''}
      ${nextS ? `<button class="btn btn-sm" data-adv="${t.id}" title="Move to ${esc(nextS)}">${esc(nextS.split(' /')[0])} ${icon('chevronR')}</button>` : ''}</div></div>`; }).join('')}</div>`;
}

function myLeaves(u) {
  const list = Store.data.leaves.filter((l) => l.userId === u.id).sort((a, b) => b.from.localeCompare(a.from)).slice(0, 6);
  if (!list.length) return '<p class="muted small">No leave requests yet.</p>';
  return `<div class="mini-list">${list.map((l) => `<div class="mini-row"><div><b>${esc(LEAVE_TYPES.find((t) => t.key === l.type).label)} · ${leaveDays(l)} day(s)</b><span class="muted small">${fmtShortDate(l.from)}${l.to !== l.from ? ' – ' + fmtShortDate(l.to) : ''} · ${esc(l.reason)}</span></div>
    <div class="row-actions">${badge(l.status)}${l.status === 'Pending' ? `<button class="btn btn-sm" data-cancel-leave="${l.id}">Withdraw</button>` : ''}</div></div>`).join('')}</div>`;
}
function myMonthStrip(u) {
  const mk = monthKey();
  const days = dateRange(mk + '-01', mk + '-' + pad(daysInMonth(mk)));
  const st = days.map((d) => ({ d, s: dayStatus(u.id, d) }));
  const c = (code) => st.filter((x) => x.s.code === code).length;
  return `<div class="att-strip">${st.map(({ d, s }) => `<span class="att-cell tone-${s.tone}" title="${fmtDate(d)}: ${esc(s.label || 'Upcoming')}${attendanceFor(u.id, d) ? ' · ' + fmtHours(workedMs(attendanceFor(u.id, d))) : ''}">${esc(s.code)}<small>${parseISO(d).getDate()}</small></span>`).join('')}</div>
    <p class="muted small pad-top">${c('P')} present · ${c('L')} late · ${c('H')} half-day · ${c('LV') + c('HL')} leave · ${c('A')} absent</p>`;
}
function myEods(u) {
  const list = Store.data.eod.filter((e) => e.userId === u.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  if (!list.length) return '<p class="muted small">Your end-of-day reports will show here.</p>';
  return `<div class="mini-list">${list.map((e) => `<button class="mini-row as-btn" data-eod="${e.id}"><div><b>${fmtDate(e.date)}</b><span class="muted small">${esc(e.completedSummary).slice(0, 90)}</span></div><span class="small muted">${e.pending.length} pending</span></button>`).join('')}</div>`;
}

/* ---------- EOD (required to clock out) ---------- */
function openEodModal(u, a) {
  const today = todayISO();
  const doneToday = Store.tasks.filter((t) => t.completedBy === u.id && t.completedAt && toISO(new Date(t.completedAt)) === today);
  const open = Store.tasks.filter((t) => t.assigneeId === u.id && !DONE_STATUSES.includes(t.status) && t.dueDate <= addDays(today, 3)).sort((x, y) => x.dueDate.localeCompare(y.dueDate));
  const m = Modal.open({ title: 'End-of-day report', size: 'lg',
    body: `<p class="muted">Submit your EOD to clock out. Worked today: <b>${fmtHours(workedMs(a))}</b> (breaks ${fmtHours(breakMs(a))}).</p>
      <form id="eodForm">
        <h3 class="form-section">What did you complete today?</h3>
        ${doneToday.length ? `<div class="checks stacked">${doneToday.map((t) => `<label class="check"><input type="checkbox" name="done" value="${t.id}" checked> ${esc(t.title)} <span class="muted small">· ${esc(Store.clientName(t.clientId))}</span></label>`).join('')}</div><p class="muted small">Pulled automatically from tasks you moved to Ready to Publish / Published today.</p>` : '<p class="muted small">No tasks were completed on the board today.</p>'}
        ${field('Other work done', textareaEl('summary', '', { rows: 2, placeholder: 'Revisions, research, calls, edits in progress…' }), { full: true })}
        <h3 class="form-section">Pending / blocked</h3>
        ${open.length ? `<div class="eod-pending">${open.map((t) => `<div class="eod-row"><div><b>${esc(t.title)}</b><span class="muted small">${esc(Store.clientName(t.clientId))} · ${dueLabel(t)}</span></div>
          <input name="reason_${t.id}" placeholder="Status / blocker${isLate(t) ? ' (required)' : ''}" aria-label="Reason for ${esc(t.title)}"><input type="date" name="eta_${t.id}" value="${t.dueDate < today ? addDays(today, 1) : t.dueDate}" aria-label="Expected completion"></div>`).join('')}</div>` : '<p class="muted small">Nothing due in the next 3 days.</p>'}
        ${field('Blockers for your manager', textareaEl('blockers', '', { rows: 2, placeholder: 'Waiting on assets, approvals, access…' }), { full: true })}
        <p class="form-error" hidden></p></form>`,
    footer: `<button class="btn" data-close>Keep working</button><button class="btn btn-danger" id="eodSubmit">${icon('stop')}Submit & clock out</button>` });
  $('#eodSubmit', m).onclick = () => {
    const d = formData($('#eodForm', m));
    const err = $('.form-error', m);
    const doneIds = [].concat(d.done || []);
    if (!doneIds.length && !d.summary.trim()) { err.textContent = 'Tell us what you worked on today.'; err.hidden = false; return; }
    const missing = open.filter((t) => isLate(t) && !(d['reason_' + t.id] || '').trim());
    if (missing.length) { err.textContent = `Add a status or blocker for late task${missing.length > 1 ? 's' : ''}: ${missing.map((t) => t.title).join(', ')}.`; err.hidden = false; return; }
    stopTimer(u, 'clock-out');
    const bk = openBreak(a); if (bk) bk.end = Date.now();
    a.clockOut = Date.now();
    const doneTasks = doneIds.map((id) => Store.task(id)).filter(Boolean);
    const e = { id: uid('eod'), userId: u.id, date: today, completedIds: doneIds,
      completedSummary: [doneTasks.map((t) => `${t.title} (${Store.clientName(t.clientId)})`).join('; '), d.summary.trim()].filter(Boolean).join(' · '),
      pending: open.filter((t) => (d['reason_' + t.id] || '').trim() || isLate(t)).map((t) => ({ taskId: t.id, reason: (d['reason_' + t.id] || '').trim(), eta: d['eta_' + t.id] })),
      blockers: d.blockers.trim(), loggedAt: Date.now() };
    Store.data.eod.push(e); a.eodId = e.id;
    Store.log('Clocked out', `${u.name} at ${fmtTime(a.clockOut)} · ${fmtHours(workedMs(a))} active · EOD: ${doneTasks.length} done, ${e.pending.length} pending${e.blockers ? ' · blocker reported' : ''}`, { entity: 'attendance', entityId: a.id });
    Store.save(); Modal.close(); toast('EOD submitted — see you tomorrow!'); Router.render();
  };
}
function showEod(e) {
  const u = Store.user(e.userId) || {};
  Modal.open({ title: `EOD — ${u.name} · ${fmtDate(e.date)}`, size: 'lg',
    body: `<h3 class="form-section">Completed</h3><p>${esc(e.completedSummary) || '<span class="muted">—</span>'}</p>
      <h3 class="form-section">Pending</h3>${e.pending.length ? `<div class="mini-list">${e.pending.map((p) => { const t = Store.task(p.taskId) || { title: '(deleted task)', clientId: '' }; return `<div class="mini-row"><div><b>${esc(t.title)}</b><span class="muted small">${esc(Store.clientName(t.clientId))} · ${esc(p.reason || 'No note')}</span></div><span class="small">ETA ${fmtShortDate(p.eta)}</span></div>`; }).join('')}</div>` : '<p class="muted">None</p>'}
      ${e.blockers ? `<h3 class="form-section">Blockers</h3><div class="alert alert-warn">${esc(e.blockers)}</div>` : ''}
      <p class="muted small">Submitted ${fmtDateTime(e.loggedAt)}</p>` });
}

/* ---------- Leave ---------- */
function openLeaveRequest(u) {
  const bal = leaveBalance(u);
  const m = Modal.open({ title: 'Request leave',
    body: `<form id="lvForm" class="form-grid">
      ${field('Leave type', selectEl('type', LEAVE_TYPES.map((t) => { const b = bal.find((x) => x.key === t.key); return { value: t.key, label: t.key === 'unpaid' ? t.label : `${t.label} (${b.left} left)` }; }), 'casual'))}
      <label class="check" style="align-self:end"><input type="checkbox" name="halfDay"> Half day</label>
      ${field('From', inputEl('from', addDays(todayISO(), 1), { type: 'date' }), { required: true })}
      ${field('To', inputEl('to', addDays(todayISO(), 1), { type: 'date' }), { required: true })}
      ${field('Reason', inputEl('reason', ''), { full: true, required: true })}
      ${field('Backup person (covers your work)', selectEl('backupId', Store.activeUsers().filter((x) => x.id !== u.id).map((x) => ({ value: x.id, label: `${x.name} — ${x.designation}` })), '', { placeholder: 'Choose a colleague' }), { full: true })}
      <p class="form-error full" hidden></p></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="lvSave">Submit request</button>` });
  $('#lvSave', m).onclick = () => {
    const d = formData($('#lvForm', m));
    const err = $('.form-error', m);
    const l = { id: uid('lv'), userId: u.id, type: d.type, from: d.from, to: d.halfDay ? d.from : d.to, halfDay: !!d.halfDay, reason: d.reason.trim(), backupId: d.backupId, status: 'Pending', decidedBy: '', decidedAt: null, createdAt: Date.now() };
    const days = leaveDays(l);
    const b = bal.find((x) => x.key === d.type);
    const clash = Store.data.leaves.some((x) => x.userId === u.id && x.status !== 'Rejected' && x.from <= l.to && x.to >= l.from);
    const problems = [];
    if (!l.from || !l.to || l.to < l.from) problems.push('valid dates');
    if (!l.reason) problems.push('a reason');
    if (problems.length) { err.textContent = 'Please add ' + problems.join(' and ') + '.'; err.hidden = false; return; }
    if (!days) { err.textContent = 'Those dates are all week-offs.'; err.hidden = false; return; }
    if (clash) { err.textContent = 'You already have leave on some of these dates.'; err.hidden = false; return; }
    if (d.type !== 'unpaid' && days > b.left) { err.textContent = `Only ${b.left} ${b.label.toLowerCase()} day(s) left — choose Unpaid for the rest.`; err.hidden = false; return; }
    Store.data.leaves.push(l);
    Store.log('Leave requested', `${u.name} — ${b.label} ${days} day(s), ${fmtDate(l.from)}${l.to !== l.from ? ' to ' + fmtDate(l.to) : ''}${l.backupId ? ' · backup ' + Store.userName(l.backupId) : ''}`, { entity: 'leave', entityId: l.id });
    Store.save(); Modal.close(); toast('Leave request sent for approval'); Router.render();
  };
}
