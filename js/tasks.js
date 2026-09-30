/* ==========================================================================
   tasks.js — production board, calendar, list, task modal, shoot schedule
   Hierarchy: Client ➔ Campaign (month) ➔ Task
   ========================================================================== */

const taskState = { view: 'board', month: '', client: '', assignee: '', type: '', priority: '', status: '', lateOnly: false, mine: null };

Views.tasks = function (main, _id, params) {
  const st = taskState;
  const u = Store.currentUser();
  if (!st.month) st.month = monthKey();
  if (st.mine === null) st.mine = ['creative', 'shoot'].includes(u.role);
  if (params.client) st.client = params.client;
  if (params.assignee) { st.assignee = params.assignee; st.mine = false; st.view = 'list'; }
  if (params.late) { st.lateOnly = true; st.view = 'list'; }
  if (params.client || params.late || params.assignee) history.replaceState(null, '', '#/tasks');

  main.innerHTML = setTitle('<h1>Tasks & production board</h1><p class="muted">Client ➔ campaign ➔ task · drag cards between stages</p>',
    Perm.canCreateTasks() ? `<button class="btn btn-primary" id="addTask">${icon('plus')}New task</button>` : '') + `
    <div class="toolbar">
      <div class="seg views">
        <button data-v="board" class="${st.view === 'board' ? 'on' : ''}">${icon('kanban')}Board</button>
        <button data-v="calendar" class="${st.view === 'calendar' ? 'on' : ''}">${icon('calendar')}Calendar</button>
        <button data-v="list" class="${st.view === 'list' ? 'on' : ''}">${icon('list')}List</button>
      </div>
      <div class="month-nav"><button class="icon-btn" id="pm" aria-label="Previous month">${icon('chevronL')}</button><b>${fmtMonth(st.month)}</b><button class="icon-btn" id="nm" aria-label="Next month">${icon('chevronR')}</button></div>
    </div>
    <div class="toolbar filters">
      ${selectEl('f_client', clientOptions(Perm.visibleClients()), st.client, { placeholder: 'All clients', attrs: 'aria-label="Client"' })}
      ${selectEl('f_assignee', [{ value: '_none', label: 'Unassigned' }, ...userOptions(['creative', 'shoot', 'pm', 'admin'])], st.assignee, { placeholder: 'Anyone', attrs: 'aria-label="Assignee"' })}
      ${selectEl('f_type', TASK_TYPES.map((t) => ({ value: t.key, label: t.label })), st.type, { placeholder: 'All types', attrs: 'aria-label="Type"' })}
      ${selectEl('f_priority', PRIORITIES, st.priority, { placeholder: 'Any priority', attrs: 'aria-label="Priority"' })}
      ${st.view === 'list' ? selectEl('f_status', TASK_STATUSES, st.status, { placeholder: 'All stages', attrs: 'aria-label="Stage"' }) : ''}
      <label class="check"><input type="checkbox" id="f_mine" ${st.mine ? 'checked' : ''}> My tasks</label>
      <label class="check"><input type="checkbox" id="f_late" ${st.lateOnly ? 'checked' : ''}> Late / at risk</label>
    </div>
    <div class="legend-row small"><span><i class="dot tone-bad"></i>Late</span><span><i class="dot tone-warn"></i>At risk (due ≤ 2 days, still early)</span><span>↻ revisions used / allowed</span></div>
    <div id="taskBody"></div>`;

  $$('.views button', main).forEach((b) => (b.onclick = () => { st.view = b.dataset.v; Router.render(); }));
  $('#pm').onclick = () => { st.month = addMonths(st.month, -1); Router.render(); };
  $('#nm').onclick = () => { st.month = addMonths(st.month, 1); Router.render(); };
  ['client', 'assignee', 'type', 'priority', 'status'].forEach((k) => { const el = $(`[name=f_${k}]`, main); if (el) el.onchange = () => { st[k] = el.value; draw(); }; });
  $('#f_mine').onchange = (e) => { st.mine = e.target.checked; draw(); };
  $('#f_late').onchange = (e) => { st.lateOnly = e.target.checked; draw(); };
  if ($('#addTask')) $('#addTask').onclick = () => openTaskModal(null, { clientId: st.client, campaign: st.month, dueDate: st.month === monthKey() ? todayISO() : st.month + '-01' });

  function filtered({ carry = false } = {}) {
    return Perm.visibleTasks().filter((t) => {
      const inMonth = taskCampaign(t) === st.month;
      const carried = carry && st.month === monthKey() && isLate(t) && taskCampaign(t) < st.month;
      if (!inMonth && !carried) return false;
      if (st.client && t.clientId !== st.client) return false;
      if (st.assignee === '_none' ? t.assigneeId : st.assignee && t.assigneeId !== st.assignee) return false;
      if (st.type && t.type !== st.type) return false;
      if (st.priority && t.priority !== st.priority) return false;
      if (st.status && st.view === 'list' && t.status !== st.status) return false;
      if (st.mine && !(t.assigneeId === u.id || t.reviewerId === u.id || (t.shoot && t.shoot.crewIds.includes(u.id)))) return false;
      if (st.lateOnly && !(isLate(t) || isAtRisk(t))) return false;
      return true;
    });
  }
  function draw() {
    const body = $('#taskBody');
    if (st.view === 'board') renderBoard(body, filtered({ carry: true }));
    else if (st.view === 'calendar') renderTaskCalendar(body, filtered(), st.month);
    else {
      const items = filtered({ carry: true }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      body.innerHTML = `<section class="card flush">${taskTable(items)}</section><p class="muted small pad-top">${items.length} task${items.length === 1 ? '' : 's'} · <button class="linkish" id="expTasks">Export CSV</button></p>`;
      bindTaskTable(body);
      $('#expTasks').onclick = () => exportCSV(taskRows(items), `tasks-${st.month}`);
    }
  }
  draw();
};

function taskRows(items) {
  return [['Client', 'Campaign', 'Title', 'Type', 'Priority', 'Assignee', 'Reviewer', 'Due date', 'Publish date', 'Stage', 'Revisions', 'Billable revision', 'Completed on', 'Link', 'Late'],
    ...items.map((t) => [Store.clientName(t.clientId), fmtMonth(taskCampaign(t)), t.title, taskType(t.type).label, t.priority, Store.userName(t.assigneeId), Store.userName(t.reviewerId), t.dueDate, t.publishDate || '', t.status, `${t.revisions}/${t.maxRevisions}`, t.billable ? 'Yes' : '', t.completedAt ? toISO(new Date(t.completedAt)) : '', t.link || '', isLate(t) ? 'Yes' : ''])];
}
function riskClass(t) { return isLate(t) ? 'is-late' : isAtRisk(t) ? 'is-risk' : ''; }
function dueLabel(t) {
  if (DONE_STATUSES.includes(t.status)) return `<span class="muted">Done${t.completedAt ? ' ' + fmtShortDate(toISO(new Date(t.completedAt))) : ''}</span>`;
  if (isLate(t)) { const d = daysBetween(t.dueDate, todayISO()); return `<span class="text-bad">${d} day${d === 1 ? '' : 's'} late</span>`; }
  const d = daysBetween(todayISO(), t.dueDate);
  if (isAtRisk(t)) return `<span class="text-warn">${d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due in ${d} days`}</span>`;
  return `<span class="muted">Due ${fmtShortDate(t.dueDate)}</span>`;
}
function revChip(t) {
  if (!t.revisions && !t.billable) return '';
  return `<span class="chip ${t.revisions > t.maxRevisions ? 'tone-bad' : t.revisions === t.maxRevisions ? 'tone-warn' : ''}" title="Client revisions used / allowed">↻ ${t.revisions}/${t.maxRevisions}${t.billable ? ' · billable' : ''}</span>`;
}

/* ---------- List ---------- */
function taskTable(items, { showClient = true } = {}) {
  if (!items.length) return emptyState('No tasks', Perm.canCreateTasks() ? 'Create one, or use “Plan month from quota” on a client.' : 'Nothing assigned to you here.');
  return `<div class="table-wrap"><table class="table clickable"><thead><tr><th>Task</th>${showClient ? '<th>Client</th>' : ''}<th class="hide-sm">Assignee / reviewer</th><th>Due</th><th>Stage</th><th class="hide-sm">Priority</th></tr></thead>
    <tbody>${items.map((t) => `<tr data-task="${t.id}" class="${riskClass(t)}">
      <td><b>${esc(t.title)}</b>${t.link ? ` ${linkHtml(t.link, '', { cls: 'inline-link', iconOnly: true })}` : ''}<div class="muted small">${esc(taskType(t.type).label)} ${revChip(t)}</div></td>
      ${showClient ? `<td>${esc(Store.clientName(t.clientId))}<div class="muted small">${fmtMonthShort(taskCampaign(t))} campaign</div></td>` : ''}
      <td class="hide-sm">${t.assigneeId ? avatar(Store.userName(t.assigneeId), 'sm') + ' ' + esc(Store.userName(t.assigneeId).split(' ')[0]) : '<span class="muted">Unassigned</span>'}${t.reviewerId ? `<div class="muted small">Review: ${esc(Store.userName(t.reviewerId).split(' ')[0])}</div>` : ''}</td>
      <td class="nowrap">${fmtShortDate(t.dueDate)}<div class="small">${dueLabel(t)}</div></td>
      <td>${badge(t.status)}</td><td class="hide-sm">${badge(t.priority)}</td></tr>`).join('')}</tbody></table></div>`;
}
function bindTaskTable(root) { $$('tr[data-task]', root).forEach((tr) => (tr.onclick = () => openTaskModal(Store.task(tr.dataset.task)))); }

/* ---------- Board ---------- */
function renderBoard(body, items) {
  body.innerHTML = `<div class="board">${TASK_STATUSES.map((s, si) => {
    const col = items.filter((t) => t.status === s).sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.dueDate.localeCompare(b.dueDate));
    return `<div class="col" data-status="${esc(s)}"><div class="col-head">${badge(s)}<span class="muted small">${col.length}</span></div><div class="col-body">
      ${col.map((t) => { const can = Perm.canEditTask(t); const nextS = TASK_STATUSES[si + 1]; return `<div class="kcard ${riskClass(t)}" data-task="${t.id}" ${can ? 'draggable="true"' : ''} tabindex="0">
        <div class="kcard-top"><span class="kcard-client">${esc(Store.clientName(t.clientId))}</span>${t.priority === 'Urgent' || t.priority === 'High' ? badge(t.priority) : ''}</div>
        <div class="kcard-title">${t.type === 'shoot' ? icon('camera', 'xs') + ' ' : ''}${esc(t.title)}</div>
        <div class="kcard-meta"><span class="chip">${esc(taskType(t.type).label)}</span>${revChip(t)}<span class="small">${dueLabel(t)}</span>${t.assigneeId ? avatar(Store.userName(t.assigneeId), 'sm') : ''}</div>
        ${can && nextS ? `<button class="kcard-next" data-next="${t.id}" title="Move to ${esc(nextS)}">${esc(nextS)} ${icon('chevronR')}</button>` : ''}</div>`; }).join('') || '<div class="col-empty">Drop here</div>'}
    </div></div>`;
  }).join('')}</div>`;
  $$('.kcard', body).forEach((card) => {
    card.onclick = (e) => { if (!e.target.closest('[data-next]')) openTaskModal(Store.task(card.dataset.task)); };
    card.onkeydown = (e) => { if (e.key === 'Enter') openTaskModal(Store.task(card.dataset.task)); };
    card.ondragstart = (e) => { e.dataTransfer.setData('text/plain', card.dataset.task); card.classList.add('dragging'); };
    card.ondragend = () => card.classList.remove('dragging');
  });
  $$('[data-next]', body).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const t = Store.task(b.dataset.next); setTaskStatus(t, TASK_STATUSES[TASK_STATUSES.indexOf(t.status) + 1]); }));
  $$('.col', body).forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('drop'); };
    col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); };
    col.ondrop = (e) => { e.preventDefault(); col.classList.remove('drop'); const t = Store.task(e.dataTransfer.getData('text/plain')); if (t && t.status !== col.dataset.status) setTaskStatus(t, col.dataset.status); };
  });
}

function applyStatus(t, status) {
  const before = t.status;
  t.status = status;
  t.updatedAt = Date.now();
  if (DONE_STATUSES.includes(status) && !DONE_STATUSES.includes(before)) { t.completedAt = Date.now(); t.completedBy = Store.currentUser().id; }
  if (!DONE_STATUSES.includes(status)) { t.completedAt = null; t.completedBy = ''; }
  Store.log(status === 'Ready to Publish' && before === 'Client Approval' ? 'Deliverable approved' : 'Task status changed', `${t.title} (${Store.clientName(t.clientId)}) ${before} → ${status}`, { entity: 'task', entityId: t.id, clientId: t.clientId });
}
function setTaskStatus(t, status) {
  if (!Perm.canEditTask(t)) return toast('You can only move your own tasks', 'warn');
  const block = statusBlocker(t, status);
  if (block) { toast(block, 'warn'); openTaskModal(t); return; }
  applyStatus(t, status);
  Store.save(); toast(`Moved to ${status}`); Router.render();
}

/* ---------- Calendar ---------- */
function renderTaskCalendar(body, items, mk) {
  const [y, m] = mk.split('-').map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const days = daysInMonth(mk), today = todayISO();
  const byDay = {};
  items.forEach((t) => (byDay[t.dueDate] = byDay[t.dueDate] || []).push(t));
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell out"></div>');
  for (let d = 1; d <= days; d++) {
    const iso = mk + '-' + pad(d), list = byDay[iso] || [];
    cells.push(`<div class="cal-cell ${iso === today ? 'today' : ''}" data-day="${iso}"><div class="cal-date">${d}</div>
      ${list.slice(0, 4).map((t) => `<button class="cal-item st-${TASK_STATUSES.indexOf(t.status)} ${riskClass(t)}" data-task="${t.id}" title="${esc(Store.clientName(t.clientId) + ' — ' + t.title + ' (' + t.status + ')')}">${t.type === 'shoot' ? '📷 ' : ''}${esc(Store.clientName(t.clientId).split(' ')[0])}: ${esc(t.title)}</button>`).join('')}
      ${list.length > 4 ? `<button class="cal-more" data-more="${iso}">+${list.length - 4} more</button>` : ''}</div>`);
  }
  while (cells.length % 7) cells.push('<div class="cal-cell out"></div>');
  const agenda = Object.keys(byDay).sort().map((iso) => `<div class="agenda-day ${iso === today ? 'today' : ''}"><div class="agenda-date">${parseISO(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
    ${byDay[iso].map((t) => `<button class="agenda-item ${riskClass(t)}" data-task="${t.id}"><span><b>${esc(t.title)}</b><span class="muted small">${esc(Store.clientName(t.clientId))} · ${esc(taskType(t.type).label)}</span></span>${badge(t.status)}</button>`).join('')}</div>`).join('');
  body.innerHTML = `<section class="card flush calendar"><div class="cal-grid cal-head">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div>${d}</div>`).join('')}</div><div class="cal-grid">${cells.join('')}</div></section>
    <section class="agenda">${agenda || emptyState('Nothing scheduled this month')}</section>
    <div class="legend-row small pad-top">${TASK_STATUSES.map((s, n) => `<span><i class="dot st-${n}"></i>${s}</span>`).join('')}</div>`;
  $$('[data-task]', body).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openTaskModal(Store.task(b.dataset.task)); }));
  $$('[data-more]', body).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const mm = Modal.open({ title: fmtDate(b.dataset.more), body: taskMiniList(byDay[b.dataset.more]) });
    bindTaskMini(mm);
  }));
  if (Perm.canCreateTasks()) $$('.cal-cell[data-day]', body).forEach((cell) => (cell.ondblclick = () => openTaskModal(null, { clientId: taskState.client, campaign: mk, dueDate: cell.dataset.day })));
}

/* ---------- Task modal ---------- */
function openTaskModal(task, defaults = {}) {
  if (!task && !Perm.canCreateTasks()) return;
  const isNew = !task;
  const full = Perm.canCreateTasks() && (isNew || Perm.canEditTask(task)); // PM/admin: every field
  const can = isNew || Perm.canEditTask(task);                              // assignee: stage, link, notes, checklist
  const client0 = Store.client(defaults.clientId || (task && task.clientId));
  const t = task ? clone(task) : newTask({ clientId: defaults.clientId || '', campaign: defaults.campaign || monthOf(defaults.dueDate || todayISO()), type: defaults.type || 'poster', dueDate: defaults.dueDate || todayISO(), reviewerId: client0 ? client0.managerId : '' });
  if (t.type === 'shoot' && !t.shoot) t.shoot = defaultShoot(client0);
  const F = full ? '' : 'disabled', C = can ? '' : 'disabled';
  const staff = userOptions(['creative', 'shoot', 'pm', 'admin']);
  const shootHtml = (sh) => `<div id="shootBox" class="full shoot-box">
      <h3 class="form-section">${icon('camera')} Shoot details</h3>
      <div class="form-grid">
        ${field('Shoot date', inputEl('sh_date', sh.date || t.dueDate, { type: 'date', attrs: F }))}
        ${field('Call time', inputEl('sh_time', sh.time, { type: 'time', attrs: F }))}
        ${field('Location type', selectEl('sh_loc', SHOOT_LOCATIONS, sh.locationType, { attrs: F }))}
        ${field('Crew', `<select name="sh_crew" multiple size="3" ${F}>${userOptions(['shoot', 'creative']).map((o) => `<option value="${o.value}" ${sh.crewIds.includes(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`, { hint: 'Ctrl/⌘-click for several' })}
        ${field('Address / meeting point', inputEl('sh_addr', sh.address, { attrs: F }), { full: true })}
      </div>
      <div class="field"><span class="field-label">Equipment checklist <span class="muted small">— required before the shoot moves past Scripting / Brief</span></span>
        <div class="checks">${SHOOT_CHECKLIST.map((k) => `<label class="check pill"><input type="checkbox" name="ck_${k.key}" ${sh.checklist[k.key] ? 'checked' : ''} ${C}> ${esc(k.label)}</label>`).join('')}</div></div>
      ${field('Raw file handoff', linkField('sh_raw', sh.rawLink, { placeholder: 'Drive / Dropbox / NAS folder with raw footage', attrs: C }), { full: true })}
    </div>`;
  const m = Modal.open({
    title: isNew ? 'New task' : full ? 'Edit task' : 'Task', size: 'lg',
    body: `${!isNew && (isLate(task) || isAtRisk(task)) ? `<div class="alert ${isLate(task) ? 'alert-bad' : 'alert-warn'}">${icon('alert')} ${isLate(task) ? 'Past due and not yet delivered.' : 'Due soon and still early in the pipeline.'}</div>` : ''}
      <form id="taskForm" class="form-grid">
        ${field('Title', inputEl('title', t.title, { required: true, placeholder: 'e.g. Reel #4 on root canal awareness', attrs: F }), { full: true, required: true })}
        ${field('Client', selectEl('clientId', clientOptions(Perm.visibleClients()), t.clientId, { placeholder: 'Select client', attrs: F }), { required: true })}
        ${field('Campaign (month)', inputEl('campaign', t.campaign || monthOf(t.dueDate), { type: 'month', attrs: F }), { hint: 'Counts towards this month’s quota' })}
        ${field('Deliverable type', selectEl('type', TASK_TYPES.map((x) => ({ value: x.key, label: x.label + (x.quota ? '' : ' (not in quota)') })), t.type, { attrs: F }))}
        ${field('Priority', selectEl('priority', PRIORITIES, t.priority, { attrs: F }))}
        ${field('Assignee', selectEl('assigneeId', staff, t.assigneeId, { placeholder: 'Unassigned', attrs: F }))}
        ${field('Reviewer', selectEl('reviewerId', staff, t.reviewerId, { placeholder: 'None', attrs: F }))}
        ${field('Due date', inputEl('dueDate', t.dueDate, { type: 'date', attrs: F }), { required: true })}
        ${field('Publishing date', inputEl('publishDate', t.publishDate, { type: 'date', attrs: F }))}
        ${field('Stage', selectEl('status', TASK_STATUSES, t.status, { attrs: C }))}
        ${field('Asset (link or upload)', linkField('link', t.link, { placeholder: 'https://drive.google.com/… or upload', attrs: C }), { full: true })}
        ${field('Brief / description', textareaEl('description', t.description, { rows: 2 }).replace('<textarea', `<textarea ${C}`), { full: true })}
        <div class="field full"><span class="field-label">Client revisions</span>
          <div class="rev-row"><span class="rev-count ${t.revisions > t.maxRevisions ? 'text-bad' : ''}"><b id="revN">${t.revisions}</b> of <input name="maxRevisions" type="number" min="0" max="10" value="${t.maxRevisions}" ${F} aria-label="Revisions allowed"> allowed</span>
          ${can && !isNew ? `<button type="button" class="btn btn-sm" id="revAdd">${icon('plus')}Log client revision</button>` : ''}
          <label class="check"><input type="checkbox" name="billable" ${t.billable ? 'checked' : ''} ${F}> Extra revisions are billable</label></div>
          <span class="field-hint" id="revHint">${t.revisions >= t.maxRevisions ? 'Revision limit reached — further changes should be billed as extra.' : ''}</span></div>
        ${(t.clientComments || []).length ? `<div class="field full"><span class="field-label">Client feedback</span>${commentThread(t)}</div>` : ''}
        <div id="shootSlot" class="full">${t.type === 'shoot' ? shootHtml(t.shoot) : ''}</div>
        <p class="form-error full" hidden></p>
      </form>
      ${!isNew ? `<p class="muted small">Created ${fmtDateTime(task.createdAt)} · updated ${timeAgo(task.updatedAt)}${task.completedAt ? ` · completed ${fmtDateTime(task.completedAt)} by ${esc(Store.userName(task.completedBy))}` : ''}</p>` : ''}`,
    footer: can ? `${!isNew && full ? `<button class="btn btn-ghost-danger" id="tDel">${icon('trash')}Delete</button><span class="spacer"></span>` : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="tSave">${isNew ? 'Create task' : 'Save'}</button>` : '<button class="btn" data-close>Close</button>',
  });
  if (!can) return;
  let revisions = t.revisions;
  const typeSel = $('[name=type]', m), clientSel = $('[name=clientId]', m);
  typeSel.onchange = () => { $('#shootSlot', m).innerHTML = typeSel.value === 'shoot' ? shootHtml(t.shoot || defaultShoot(Store.client(clientSel.value))) : ''; };
  clientSel.onchange = () => { const c = Store.client(clientSel.value); if (c && !$('[name=reviewerId]', m).value) $('[name=reviewerId]', m).value = c.managerId; };
  $('[name=dueDate]', m).onchange = (e) => { if (isNew) $('[name=campaign]', m).value = monthOf(e.target.value); };
  if ($('#revAdd', m)) $('#revAdd', m).onclick = () => {
    revisions += 1;
    const max = Number($('[name=maxRevisions]', m).value) || 0;
    $('#revN', m).textContent = revisions;
    if (revisions > max) {
      $('[name=billable]', m).checked = true;
      $('#revHint', m).innerHTML = `<b class="text-bad">Over the limit (${revisions}/${max}) — this revision is billable.</b> Finance will see it in the audit trail.`;
    } else $('#revHint', m).textContent = revisions === max ? 'Revision limit reached — the next one will be billable.' : '';
  };
  $('#tSave', m).onclick = () => {
    const d = formData($('#taskForm', m));
    const err = $('.form-error', m);
    const val = (k) => (full ? d[k] : t[k]);
    if (full && (!d.title.trim() || !d.clientId || !d.dueDate)) { err.textContent = 'Add a title, client and due date.'; err.hidden = false; return; }
    const type = val('type');
    let shoot = t.shoot;
    if (type === 'shoot') {
      shoot = { ...(t.shoot || defaultShoot(Store.client(val('clientId')))) };
      if (full) Object.assign(shoot, { date: d.sh_date, time: d.sh_time, locationType: d.sh_loc, address: d.sh_addr, crewIds: $$('[name=sh_crew] option:checked', m).map((o) => o.value) });
      shoot.checklist = {}; SHOOT_CHECKLIST.forEach((k) => (shoot.checklist[k.key] = !!d['ck_' + k.key]));
      shoot.rawLink = normLink(d.sh_raw);
    }
    let link = (d.link || '').trim(); if (link && !isFileRef(link) && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    const next = {
      title: full ? d.title.trim() : t.title, clientId: val('clientId'), campaign: full ? (d.campaign || monthOf(d.dueDate)) : t.campaign, type,
      priority: val('priority'), assigneeId: val('assigneeId'), reviewerId: val('reviewerId'), dueDate: val('dueDate'), publishDate: val('publishDate'),
      link, description: d.description.trim(), revisions, maxRevisions: full ? Math.max(0, Number(d.maxRevisions) || 0) : t.maxRevisions,
      billable: full ? !!d.billable : (t.billable || revisions > t.maxRevisions), shoot: type === 'shoot' ? shoot : null,
    };
    const probe = { ...t, ...next };
    const block = statusBlocker(probe, d.status);
    if (block) { err.textContent = block; err.hidden = false; return; }
    if (isNew) {
      const nt = { ...t, ...next, id: uid('tsk'), status: 'Backlog', createdAt: Date.now(), updatedAt: Date.now() };
      Store.tasks.push(nt);
      if (d.status !== 'Backlog') applyStatus(nt, d.status);
      Store.log('Task created', `${nt.title} (${taskType(nt.type).label}) for ${Store.clientName(nt.clientId)} — ${Store.userName(nt.assigneeId)}, due ${fmtDate(nt.dueDate)}`, { entity: 'task', entityId: nt.id, clientId: nt.clientId });
      toast('Task created');
    } else {
      const changes = [];
      if (task.assigneeId !== next.assigneeId) changes.push(`assigned to ${Store.userName(next.assigneeId)}`);
      if (task.dueDate !== next.dueDate) changes.push(`due ${fmtDate(next.dueDate)}`);
      if (task.priority !== next.priority) changes.push(`priority ${next.priority}`);
      if (task.link !== next.link) changes.push('asset link updated');
      if (next.shoot && task.shoot && JSON.stringify(task.shoot.checklist) !== JSON.stringify(next.shoot.checklist)) changes.push(`checklist ${SHOOT_CHECKLIST.filter((k) => next.shoot.checklist[k.key]).length}/${SHOOT_CHECKLIST.length}`);
      if (next.shoot && task.shoot && task.shoot.rawLink !== next.shoot.rawLink && next.shoot.rawLink) changes.push('raw files handed off');
      if (revisions > task.revisions) Store.log(revisions > next.maxRevisions ? 'Billable revision' : 'Client revision logged', `${task.title} (${Store.clientName(task.clientId)}) — revision ${revisions}/${next.maxRevisions}${revisions > next.maxRevisions ? ' — over limit, bill as extra' : ''}`, { entity: 'task', entityId: task.id, clientId: task.clientId });
      const statusChanged = task.status !== d.status;
      Object.assign(task, next, { updatedAt: Date.now() });
      if (statusChanged) applyStatus(task, d.status);
      if (changes.length) Store.log('Task updated', `${task.title} (${Store.clientName(task.clientId)}) — ${changes.join(', ')}`, { entity: 'task', entityId: task.id, clientId: task.clientId });
      toast('Saved');
    }
    Store.save(); Modal.close(); Router.render();
  };
  if ($('#tDel', m)) $('#tDel', m).onclick = async () => {
    if (!(await confirmDialog('Delete task?', `“${task.title}” will be removed. This is recorded in the audit trail.`, 'Delete', true))) return;
    Store.data.tasks = Store.tasks.filter((x) => x.id !== task.id);
    Store.log('Task deleted', `${task.title} (${Store.clientName(task.clientId)})`, { entity: 'task', entityId: task.id, clientId: task.clientId });
    Store.save(); toast('Task deleted'); Router.render();
  };
}

/* ---------- Shoot schedule ---------- */
function shootTable(list) {
  if (!list.length) return emptyState('No shoots scheduled');
  return `<div class="table-wrap"><table class="table clickable"><thead><tr><th>Shoot</th><th>When</th><th class="hide-sm">Where</th><th class="hide-sm">Crew</th><th>Kit</th><th>Stage</th></tr></thead><tbody>
    ${list.map((t) => { const sh = t.shoot || {}; const ck = SHOOT_CHECKLIST.filter((k) => (sh.checklist || {})[k.key]).length; return `<tr data-task="${t.id}" class="${riskClass(t)}">
      <td><b>${esc(t.title)}</b><div class="muted small">${esc(Store.clientName(t.clientId))}</div></td>
      <td class="nowrap">${fmtDate(sh.date || t.dueDate)}<div class="muted small">${esc(sh.time || '')}</div></td>
      <td class="hide-sm">${esc(sh.locationType || '')}<div class="muted small">${esc(sh.address || '')}</div></td>
      <td class="hide-sm">${(sh.crewIds || []).map((id) => avatar(Store.userName(id), 'sm')).join(' ') || '—'}</td>
      <td><span class="chip ${ck === SHOOT_CHECKLIST.length ? 'tone-good' : 'tone-warn'}">${ck}/${SHOOT_CHECKLIST.length}</span>${sh.rawLink ? `<div class="small">${linkHtml(sh.rawLink, 'Raw files')}</div>` : ''}</td>
      <td>${badge(t.status)}</td></tr>`; }).join('')}</tbody></table></div>`;
}
Views.shoots = function (main) {
  const u = Store.currentUser();
  const all = Store.tasks.filter((t) => t.type === 'shoot' && (u.role !== 'pm' || Perm.visibleClientIds().has(t.clientId)));
  const today = todayISO();
  const upcoming = all.filter((t) => !DONE_STATUSES.includes(t.status)).sort((a, b) => (a.shoot?.date || a.dueDate).localeCompare(b.shoot?.date || b.dueDate));
  const past = all.filter((t) => DONE_STATUSES.includes(t.status)).sort((a, b) => b.dueDate.localeCompare(a.dueDate)).slice(0, 20);
  const noKit = upcoming.filter((t) => !shootChecklistDone(t) && (t.shoot?.date || t.dueDate) <= addDays(today, 3));
  const noRaw = all.filter((t) => DONE_STATUSES.includes(t.status) && !(t.shoot && t.shoot.rawLink));
  main.innerHTML = setTitle('<h1>Shoot schedule</h1><p class="muted">Upcoming shoots, equipment checklists and raw file handoffs</p>', Perm.canCreateTasks() ? `<button class="btn btn-primary" id="addShoot">${icon('plus')}Schedule shoot</button>` : '') + `
    ${noKit.length ? `<div class="alert alert-warn">${icon('alert')} ${noKit.length} shoot${noKit.length > 1 ? 's' : ''} in the next 3 days with an incomplete equipment checklist.</div>` : ''}
    ${noRaw.length ? `<div class="alert alert-bad">${icon('alert')} ${noRaw.length} completed shoot${noRaw.length > 1 ? 's are' : ' is'} missing the raw file handoff link.</div>` : ''}
    <section class="card flush"><div class="card-head pad-card"><h2>Upcoming (${upcoming.length})</h2></div>${shootTable(upcoming)}</section>
    <section class="card flush"><div class="card-head pad-card"><h2>Completed</h2></div>${shootTable(past)}</section>`;
  bindTaskTable(main);
  if ($('#addShoot')) $('#addShoot').onclick = () => openTaskModal(null, { type: 'shoot', dueDate: addDays(today, 3) });
};
