/* ==========================================================================
   clients.js — portfolio master, add/edit, Client 360° view
   ========================================================================== */

const clientListState = { q: '', status: '', category: '', burn: '', payment: '', csat: '', archived: false, sort: 'company', dir: 'asc' };

function latestFeedback(c) { return (c.feedback || []).slice().sort((a, b) => b.month.localeCompare(a.month))[0]; }
function stars(n, max = 5) { return `<span class="stars" aria-label="${n} of ${max}">${'★'.repeat(n)}<span class="dim">${'★'.repeat(Math.max(0, max - n))}</span></span>`; }
function paymentAlert(c) {
  const ps = Store.payments.filter((p) => p.clientId === c.id);
  if (ps.some((p) => p.status === 'Overdue')) return { key: 'overdue', label: 'Overdue', tone: 'bad' };
  if (ps.some((p) => p.status === 'In Dispute')) return { key: 'dispute', label: 'In dispute', tone: 'violet' };
  if (ps.some((p) => balance(p) > 0)) return { key: 'due', label: 'Due', tone: 'neutral' };
  return { key: 'clear', label: 'Clear', tone: 'good' };
}

Views.clients = function (main, id, params) {
  if (id) return renderClient360(main, id, params);
  const st = clientListState;
  const money = Perm.canSeeMoney();
  const sel = (name, opts, val, ph) => selectEl(name, opts, val, { placeholder: ph, attrs: `aria-label="${ph}"` });
  main.innerHTML = setTitle('<h1>Client portfolio</h1><p class="muted">Every account, its package, delivery health and payments</p>',
    Perm.canEditClients() ? `<button class="btn btn-primary" id="addClient">${icon('plus')}Add client</button>` : '') + `
    <div class="toolbar">
      <div class="search">${icon('search')}<input id="cq" type="search" placeholder="Search company, contact, phone…" value="${esc(st.q)}" aria-label="Search clients"></div>
      ${sel('f_status', CLIENT_STATUSES, st.status, 'All statuses')}
      ${sel('f_category', CATEGORIES, st.category, 'All categories')}
      ${sel('f_burn', [{ value: 'good', label: 'On track' }, { value: 'warn', label: 'Behind' }, { value: 'bad', label: 'At risk' }], st.burn, 'Any quota burn')}
      ${money ? sel('f_payment', [{ value: 'overdue', label: 'Overdue' }, { value: 'dispute', label: 'In dispute' }, { value: 'due', label: 'Due (not late)' }, { value: 'clear', label: 'All paid' }], st.payment, 'Any payment status') : ''}
      ${sel('f_csat', [{ value: 'low', label: 'CSAT ≤ 3' }, { value: 'high', label: 'CSAT 4–5' }, { value: 'none', label: 'No rating' }], st.csat, 'Any CSAT')}
      <label class="check"><input type="checkbox" id="showArchived" ${st.archived ? 'checked' : ''}> Archived</label>
    </div><section class="card flush" id="clientTable"></section><p class="muted small pad-top" id="clientCount"></p>`;

  const draw = () => {
    const q = st.q.trim().toLowerCase();
    const mk = monthKey();
    let list = Perm.visibleClients({ includeArchived: true }).filter((c) => (st.archived ? c.archived : !c.archived));
    if (st.status) list = list.filter((c) => c.status === st.status);
    if (st.category) list = list.filter((c) => c.category === st.category);
    if (q) list = list.filter((c) => [c.company, c.contact, c.phone, c.email, c.category, (c.services || []).join(' '), Store.userName(c.managerId)].join(' ').toLowerCase().includes(q));
    let rows = list.map((c) => {
      const br = burnRate(c, mk), pa = paymentAlert(c), fb = latestFeedback(c);
      return { c, br, pa, fb, company: c.company, manager: Store.userName(c.managerId), fee: Number(c.package.monthlyFee) || 0, status: c.status, pct: c.status === 'Active' ? br.q.pct : -1, csat: fb ? fb.csat : 0, due: sum(Store.payments.filter((p) => p.clientId === c.id), balance) };
    });
    if (st.burn) rows = rows.filter((r) => r.c.status === 'Active' && r.br.tone === st.burn);
    if (st.payment) rows = rows.filter((r) => r.pa.key === st.payment);
    if (st.csat) rows = rows.filter((r) => (st.csat === 'none' ? !r.fb : st.csat === 'low' ? r.fb && r.fb.csat <= 3 : r.fb && r.fb.csat >= 4));
    rows = sortRows(rows, st.sort, st.dir);
    const th = (key, label, cls = '') => `<th class="${cls} sortable ${st.sort === key ? 'sorted-' + st.dir : ''}" data-sort="${key}">${label}</th>`;
    $('#clientTable').innerHTML = rows.length ? `<div class="table-wrap"><table class="table clickable">
      <thead><tr>${th('company', 'Client')}${th('status', 'Status')}${th('manager', 'Manager', 'hide-sm')}${money ? th('fee', 'Package', 'num hide-sm') : ''}${th('pct', 'Quota burn (this month)', 'hide-sm')}${money ? th('due', 'Payments', 'num') : ''}${th('csat', 'CSAT', 'hide-sm')}</tr></thead>
      <tbody>${rows.map(({ c, br, pa, fb, due }) => `<tr data-id="${c.id}">
        <td><b>${esc(c.company)}</b> ${c.archived ? badge('Archived') : ''}<div class="muted small">${esc(c.category || '')} · ${esc(c.contact)}</div></td>
        <td>${badge(c.status)}${c.sentiment && c.sentiment !== 'Neutral' ? `<div class="pad-xs">${badge(c.sentiment)}</div>` : ''}</td>
        <td class="hide-sm">${avatar(Store.userName(c.managerId), 'sm')} ${esc(Store.userName(c.managerId).split(' ')[0])}</td>
        ${money ? `<td class="num hide-sm">${inr(c.package.monthlyFee)}<div class="muted small">${esc(c.package.name)}</div></td>` : ''}
        <td class="hide-sm" style="min-width:170px">${c.status === 'Active' && br.q.quota ? `${progressBar(br.q.pct, { tone: br.tone })}<span class="small">${br.q.completed}/${br.q.quota} · <span class="text-${br.tone === 'good' ? 'good' : br.tone === 'warn' ? 'warn' : 'bad'}">${br.label}</span></span>` : c.status === 'Onboarding' ? `<span class="small muted">Onboarding ${c.onboarding.filter((s) => s.done).length}/${ONBOARDING_STEPS.length}</span>` : '<span class="muted small">—</span>'}</td>
        ${money ? `<td class="num">${due ? inr(due) : '—'}<div class="small"><span class="chip tone-${pa.tone}">${pa.label}</span></div></td>` : ''}
        <td class="hide-sm">${fb ? `${stars(fb.csat)}<div class="muted small">NPS ${fb.nps}</div>` : '<span class="muted small">—</span>'}</td>
      </tr>`).join('')}</tbody></table></div>` : emptyState('No clients match', 'Try clearing a filter.');
    $('#clientCount').textContent = `${rows.length} client${rows.length === 1 ? '' : 's'}`;
    $$('#clientTable tbody tr').forEach((tr) => (tr.onclick = () => (location.hash = '#/clients/' + tr.dataset.id)));
    $$('#clientTable th[data-sort]').forEach((h) => (h.onclick = () => { if (st.sort === h.dataset.sort) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = h.dataset.sort; st.dir = 'asc'; } draw(); }));
  };
  draw();
  $('#cq').oninput = (e) => { st.q = e.target.value; draw(); };
  ['status', 'category', 'burn', 'payment', 'csat'].forEach((k) => { const el = $(`[name=f_${k}]`, main); if (el) el.onchange = () => { st[k] = el.value; draw(); }; });
  $('#showArchived').onchange = (e) => { st.archived = e.target.checked; draw(); };
  if ($('#addClient')) $('#addClient').onclick = () => openClientForm();
  if (params.new && Perm.canEditClients()) { history.replaceState(null, '', '#/clients'); openClientForm(); }
};

/* ---------- Add / edit ---------- */
function openClientForm(client) {
  const isNew = !client;
  const u = Store.currentUser();
  const c = client ? clone(client) : {
    company: '', contact: '', email: '', phone: '', whatsapp: '', secondaryContact: { name: '', phone: '', email: '' }, whatsappGroup: '', address: '', gstin: '',
    category: '', status: 'Lead', managerId: u.role === 'pm' ? u.id : '', services: [], notes: '', sentiment: 'Neutral', referredBy: null,
    assets: { logo: '', guidelines: '', fonts: '' },
    package: { name: '', monthlyFee: '', billingCycle: '1', billingDay: 1, paymentTerms: '100% Advance', startDate: todayISO(), endDate: '', quotas: {}, shootType: 'NONE', shootsPerMonth: 0, shootLocation: SHOOT_LOCATIONS[0], rawFootageLink: '', metaAdBudget: 0, googleAdBudget: 0, rollover: false },
  };
  const pk = c.package;
  const refVal = c.referredBy ? (c.referredBy.type === 'client' ? c.referredBy.clientId : '_partner') : '';
  const body = `<form id="clientForm" class="form-grid" novalidate>
    <h3 class="full form-section">Business & contacts</h3>
    ${field('Business name', inputEl('company', c.company, { required: true }), { required: true })}
    ${field('Category', selectEl('category', CATEGORIES, c.category, { placeholder: 'Select category' }))}
    ${field('Brand POC name', inputEl('contact', c.contact, { required: true }), { required: true })}
    ${field('Email', inputEl('email', c.email, { type: 'email' }))}
    ${field('Phone', inputEl('phone', c.phone, { type: 'tel' }))}
    ${field('WhatsApp number', inputEl('whatsapp', c.whatsapp, { type: 'tel', placeholder: '919876543210' }), { hint: 'With country code, for one-click chat' })}
    ${field('Secondary contact', inputEl('sec_name', c.secondaryContact.name, { placeholder: 'Name' }))}
    ${field('Secondary phone / email', inputEl('sec_phone', [c.secondaryContact.phone, c.secondaryContact.email].filter(Boolean).join(' / '), { placeholder: 'Phone or email' }))}
    ${field('WhatsApp group link', inputEl('whatsappGroup', c.whatsappGroup, { type: 'url', placeholder: 'https://chat.whatsapp.com/…' }))}
    ${field('GSTIN', inputEl('gstin', c.gstin, { placeholder: '36AAACA1111B1Z2', attrs: 'maxlength="15" style="text-transform:uppercase"' }), { hint: 'Decides CGST+SGST vs IGST on invoices' })}
    ${field('Address', textareaEl('address', c.address, { rows: 2 }), { full: true })}

    <h3 class="full form-section">Account</h3>
    ${field('Status', selectEl('status', CLIENT_STATUSES, c.status))}
    ${field('Sentiment', selectEl('sentiment', SENTIMENTS, c.sentiment))}
    ${field('Account manager', selectEl('managerId', userOptions(['admin', 'pm']), c.managerId, { placeholder: 'Select', attrs: u.role === 'pm' ? 'disabled' : '' }))}
    ${field('Referred by', selectEl('referredBy', [{ value: '_partner', label: 'Partner / other (type name →)' }, ...Store.clients.filter((x) => x.id !== client?.id).map((x) => ({ value: x.id, label: x.company }))], refVal, { placeholder: 'Nobody' }))}
    ${field('Partner name', inputEl('referredName', c.referredBy && c.referredBy.type === 'partner' ? c.referredBy.name : '', { placeholder: 'If referred by a partner' }))}
    <div class="field full"><span class="field-label">Services</span><div class="checks">${SERVICES.map((s) => `<label class="check pill"><input type="checkbox" name="services" value="${esc(s)}" ${(c.services || []).includes(s) ? 'checked' : ''}> ${esc(s)}</label>`).join('')}</div></div>

    <h3 class="full form-section">Retainer package</h3>
    ${field('Package name', inputEl('pk_name', pk.name, { placeholder: 'e.g. Growth' }))}
    ${field('Monthly fee (₹, before GST)', inputEl('pk_fee', pk.monthlyFee, { type: 'number', attrs: 'min="0" step="500"' }), { required: true })}
    ${field('Billing cycle', selectEl('pk_cycle', BILLING_CYCLES, pk.billingCycle || String(pk.billingDay)))}
    ${field('Custom billing day', inputEl('pk_day', pk.billingDay, { type: 'number', attrs: 'min="1" max="31"' }), { hint: 'Used when the cycle is “Custom day”' })}
    ${field('Payment terms', selectEl('pk_terms', PAYMENT_TERMS, pk.paymentTerms))}
    ${field('Contract start', inputEl('pk_start', pk.startDate, { type: 'date' }), { hint: 'Invoices start from this date' })}
    ${field('Contract end', inputEl('pk_end', pk.endDate, { type: 'date' }))}
    <label class="check full"><input type="checkbox" name="pk_rollover" ${pk.rollover ? 'checked' : ''}> Unused deliverables roll over to next month (otherwise they expire at month-end)</label>
    <div class="field full"><span class="field-label">Monthly deliverable quotas</span><div class="deliv-grid">
      ${QUOTA_TYPES.map((q) => `<label class="deliv"><span>${q.label}</span><input type="number" min="0" name="q_${q.key}" value="${Number(pk.quotas[q.key]) || 0}" inputmode="numeric"></label>`).join('')}
    </div></div>
    <h3 class="full form-section">Shoot scope & ads</h3>
    ${field('Shoot type', selectEl('pk_shootType', SHOOT_TYPES, pk.shootType))}
    ${field('Location', selectEl('pk_shootLocation', SHOOT_LOCATIONS, pk.shootLocation))}
    ${field('Raw footage folder', linkField('pk_raw', pk.rawFootageLink, { placeholder: 'Google Drive / Dropbox / NAS link' }), { full: true })}
    ${field('Meta Ads budget / month (₹)', inputEl('pk_meta', pk.metaAdBudget, { type: 'number', attrs: 'min="0"' }), { hint: 'Client’s ad spend we manage (not billed)' })}
    ${field('Google Ads budget / month (₹)', inputEl('pk_google', pk.googleAdBudget, { type: 'number', attrs: 'min="0"' }))}
    <h3 class="full form-section">Brand assets</h3>
    ${field('Logo files', linkField('as_logo', c.assets.logo))}
    ${field('Brand guidelines', linkField('as_guide', c.assets.guidelines))}
    ${field('Brand fonts', inputEl('as_fonts', c.assets.fonts, { placeholder: 'e.g. Poppins, Lora' }))}
    ${field('Notes', textareaEl('notes', c.notes, { rows: 3 }), { full: true })}
    <p class="form-error full" hidden></p></form>`;
  const m = Modal.open({ title: isNew ? 'Add client' : `Edit ${client.company}`, size: 'lg', body,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="saveClient">${isNew ? 'Add client' : 'Save changes'}</button>` });
  $('#saveClient', m).onclick = () => {
    const d = formData($('#clientForm', m));
    const err = $('.form-error', m);
    const miss = [];
    if (!d.company.trim()) miss.push('business name');
    if (!d.contact.trim()) miss.push('brand POC');
    if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) miss.push('a valid email');
    if (d.gstin && !/^\d{2}[A-Z0-9]{13}$/i.test(d.gstin.trim())) miss.push('a valid 15-character GSTIN');
    if (['Active', 'Onboarding'].includes(d.status) && !(Number(d.pk_fee) > 0)) miss.push('the monthly fee');
    if (d.status === 'Active' && !d.pk_start) miss.push('contract start');
    if (d.pk_end && d.pk_start && d.pk_end < d.pk_start) miss.push('a contract end after the start');
    if (miss.length) { err.textContent = 'Please add ' + miss.join(', ') + '.'; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); return; }
    const quotas = {};
    QUOTA_TYPES.forEach((q) => { const v = Math.max(0, Number(d['q_' + q.key]) || 0); if (v) quotas[q.key] = v; });
    const secParts = (d.sec_phone || '').split('/').map((x) => x.trim()).filter(Boolean);
    const secEmail = secParts.find((x) => x.includes('@')) || '', secPhone = secParts.find((x) => !x.includes('@')) || '';
    const referredBy = !d.referredBy ? null : d.referredBy === '_partner' ? (d.referredName.trim() ? { type: 'partner', clientId: '', name: d.referredName.trim() } : null) : { type: 'client', clientId: d.referredBy, name: Store.clientName(d.referredBy) };
    const next = {
      company: d.company.trim(), contact: d.contact.trim(), email: d.email.trim(), phone: d.phone.trim(), whatsapp: d.whatsapp.replace(/[^\d]/g, ''),
      secondaryContact: { name: d.sec_name.trim(), phone: secPhone, email: secEmail }, whatsappGroup: normLink(d.whatsappGroup), address: d.address.trim(),
      gstin: d.gstin.trim().toUpperCase(), category: d.category, status: d.status, sentiment: d.sentiment,
      managerId: u.role === 'pm' ? (client ? client.managerId : u.id) : d.managerId, services: [].concat(d.services || []), notes: d.notes.trim(), referredBy,
      assets: { logo: normLink(d.as_logo), guidelines: normLink(d.as_guide), fonts: d.as_fonts.trim() },
      package: { ...pk, name: d.pk_name.trim() || 'Retainer', monthlyFee: Number(d.pk_fee) || 0, billingCycle: d.pk_cycle,
        billingDay: d.pk_cycle === 'custom' ? Math.min(31, Math.max(1, Number(d.pk_day) || 1)) : Number(d.pk_cycle),
        paymentTerms: d.pk_terms, startDate: d.pk_start, endDate: d.pk_end, rollover: !!d.pk_rollover, quotas,
        shootType: d.pk_shootType, shootsPerMonth: quotas.shoot || 0, shootLocation: d.pk_shootLocation, rawFootageLink: normLink(d.pk_raw),
        metaAdBudget: Number(d.pk_meta) || 0, googleAdBudget: Number(d.pk_google) || 0, isActive: d.status === 'Active' },
    };
    if (isNew) {
      const nc = { id: uid('c'), ...next, onboarding: ONBOARDING_STEPS.map(() => ({ done: false, date: '' })), feedback: [], referrals: [], archived: false, createdAt: Date.now() };
      Store.clients.push(nc);
      if (referredBy && referredBy.type === 'client') { const rc = Store.client(referredBy.clientId); rc.referrals.push({ id: uid('ref'), name: nc.company, date: todayISO(), status: nc.status === 'Lead' ? 'Lead' : 'Converted', credit: 0, creditApplied: false, notes: 'Added automatically' }); }
      Store.log('Client added', `${nc.company} added as ${nc.status} (${inr(nc.package.monthlyFee)}/month)`, { entity: 'client', entityId: nc.id, clientId: nc.id });
      const made = Store.runAutomations();
      Store.save(); Modal.close();
      toast(`${nc.company} added${made.length ? ' · first invoice generated' : ''}`);
      location.hash = '#/clients/' + nc.id;
    } else {
      const changes = [];
      if (client.status !== next.status) changes.push(`status ${client.status} → ${next.status}`);
      if (client.sentiment !== next.sentiment) changes.push(`sentiment ${client.sentiment} → ${next.sentiment}`);
      if (client.package.monthlyFee !== next.package.monthlyFee) changes.push(`fee ${inr(client.package.monthlyFee)} → ${inr(next.package.monthlyFee)}`);
      if (JSON.stringify(client.package.quotas) !== JSON.stringify(next.package.quotas)) changes.push(`quotas ${QUOTA_TYPES.filter((q) => next.package.quotas[q.key]).map((q) => `${next.package.quotas[q.key]} ${q.short.toLowerCase()}`).join(', ')}`);
      if (client.managerId !== next.managerId) changes.push(`manager → ${Store.userName(next.managerId)}`);
      if (client.package.paymentTerms !== next.package.paymentTerms) changes.push(`terms → ${next.package.paymentTerms}`);
      Object.assign(client, next);
      Store.log(changes.some((x) => x.startsWith('quotas')) ? 'Quota edited' : 'Client updated', `${client.company}${changes.length ? ' — ' + changes.join('; ') : ' — details updated'}`, { entity: 'client', entityId: client.id, clientId: client.id });
      Store.runAutomations(); Store.save(); Modal.close(); toast('Client saved'); Router.render();
    }
  };
}

async function toggleArchive(client) {
  if (!client.archived && !(await confirmDialog('Archive client?', `${client.company} will be hidden from lists and stop generating invoices. You can restore it any time.`, 'Archive'))) return;
  client.archived = !client.archived;
  Store.log(client.archived ? 'Client archived' : 'Client restored', client.company, { entity: 'client', entityId: client.id, clientId: client.id });
  Store.save(); toast(client.archived ? 'Client archived' : 'Client restored'); Router.render();
}

/* ---------- Client 360° ---------- */
function renderClient360(main, id, params) {
  const c = Store.client(id);
  if (!c || !Perm.visibleClientIds().has(id)) { main.innerHTML = emptyState('Client not found', 'It may not exist or you may not have access.', '<a class="btn" href="#/clients">Back to clients</a>'); return; }
  const money = Perm.canSeeMoney();
  const tabs = [['overview', 'Overview'], ['quota', 'Deliverables'], ['shoots', 'Shoots'], ...(money ? [['billing', 'Billing']] : []), ['feedback', 'Feedback & NPS'], ['referrals', 'Referrals'], ...(Perm.canSeeAudit() ? [['activity', 'Activity']] : [])];
  const tab = tabs.some((t) => t[0] === params.tab) ? params.tab : 'overview';
  const mk = monthKey();
  const q = quotaStatus(c, mk);
  const fb = latestFeedback(c);
  main.innerHTML = `<a class="back" href="#/clients">${icon('chevronL')} Client portfolio</a>
    <div class="profile-head card">
      <div class="profile-id"><span class="avatar lg">${esc(initials(c.company))}</span>
        <div><h1>${esc(c.company)} ${badge(c.status)} ${badge(c.sentiment)} ${c.archived ? badge('Archived') : ''}</h1>
          <p class="muted">${esc(c.category || '—')} · ${esc(c.contact)} · Managed by ${esc(Store.userName(c.managerId))}${fb ? ` · CSAT ${stars(fb.csat)} NPS ${fb.nps}` : ''}</p>
          <div class="quick">
            ${c.phone ? `<a class="btn btn-sm" href="tel:${esc(c.phone.replace(/\s/g, ''))}">${icon('phone')}Call</a>` : ''}
            ${c.email ? `<a class="btn btn-sm" href="mailto:${esc(c.email)}">${icon('mail')}Email</a>` : ''}
            ${c.whatsapp ? `<a class="btn btn-sm btn-wa" href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener">${icon('whatsapp')}WhatsApp</a>` : ''}
            ${safeUrl(c.whatsappGroup) ? `<a class="btn btn-sm btn-wa" href="${esc(safeUrl(c.whatsappGroup))}" target="_blank" rel="noopener noreferrer">${icon('clients')}Group</a>` : ''}
            ${c.assets.guidelines ? linkHtml(c.assets.guidelines, 'Brand kit', { cls: 'btn btn-sm' }) : ''}
          </div></div></div>
      <div class="profile-side">
        ${c.status === 'Active' && q.quota ? `<div class="meters">${q.rows.slice(0, 4).map((r) => meter(r)).join('')}</div>` : ''}
        <div class="page-actions">${Perm.canEditClients() && Perm.visibleClientIds().has(c.id) ? `<button class="btn" id="editClient">${icon('edit')}Edit</button>` : ''}
        ${Perm.canDeleteClients() ? `<button class="btn" id="archiveClient">${icon(c.archived ? 'restore' : 'archive')}${c.archived ? 'Restore' : 'Archive'}</button>` : ''}</div>
      </div>
    </div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<a role="tab" class="${k === tab ? 'on' : ''}" href="#/clients/${c.id}?tab=${k}">${l}</a>`).join('')}</div>
    <div id="tabBody"></div>`;
  if ($('#editClient')) $('#editClient').onclick = () => openClientForm(c);
  if ($('#archiveClient')) $('#archiveClient').onclick = () => toggleArchive(c);
  ({ overview: c360Overview, quota: c360Quota, shoots: c360Shoots, billing: c360Billing, feedback: c360Feedback, referrals: c360Referrals, activity: c360Activity })[tab]($('#tabBody'), c, params);
}

/* Circular quota meter, e.g. 8/12 posters */
function meter(r) {
  const pct = r.quota ? Math.min(1, r.completed / r.quota) : 0;
  const C = 2 * Math.PI * 20;
  return `<div class="meter" title="${esc(r.label)}: ${r.completed} done, ${r.inReview} in review, ${r.remaining} remaining${r.rolled ? ` (incl. ${r.rolled} rolled over)` : ''}">
    <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" class="meter-bg"/><circle cx="24" cy="24" r="20" class="meter-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 24 24)"/></svg>
    <b>${r.completed}/${r.quota}</b><span>${esc(r.short)}</span></div>`;
}

function c360Overview(body, c) {
  const row = (k, v) => `<div class="dl-row"><dt>${k}</dt><dd>${v || '<span class="muted">—</span>'}</dd></div>`;
  const link = (u, t) => linkHtml(u, t);
  const pk = c.package;
  const money = Perm.canSeeMoney();
  const done = c.onboarding.filter((s) => s.done).length;
  const daysLeft = pk.endDate ? daysBetween(todayISO(), pk.endDate) : null;
  const canEdit = Perm.canEditClients() && Perm.visibleClientIds().has(c.id);
  body.innerHTML = `<div class="grid-2">
    <div class="stack">
      <section class="card"><div class="card-head"><h2>Contacts</h2></div><dl class="dl">
        ${row('Brand POC', esc(c.contact))}${row('Email', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '')}${row('Phone', esc(c.phone))}
        ${row('Secondary contact', [c.secondaryContact.name, c.secondaryContact.phone, c.secondaryContact.email].filter(Boolean).map(esc).join(' · '))}
        ${row('WhatsApp group', link(c.whatsappGroup, 'Join group'))}${row('Address', esc(c.address))}${row('GSTIN', esc(c.gstin))}
        ${row('Referred by', c.referredBy ? (c.referredBy.type === 'client' ? `<a href="#/clients/${c.referredBy.clientId}">${esc(c.referredBy.name)}</a>` : esc(c.referredBy.name) + ' <span class="muted small">(partner)</span>') : '')}
      </dl></section>
      <section class="card"><div class="card-head"><h2>Brand assets</h2></div><dl class="dl">
        ${row('Logo files', link(c.assets.logo))}${row('Brand guidelines', link(c.assets.guidelines))}${row('Fonts', esc(c.assets.fonts))}${row('Raw footage', link(pk.rawFootageLink))}
      </dl></section>
      <section class="card"><div class="card-head"><h2>Notes</h2></div><p class="prewrap">${esc(c.notes) || '<span class="muted">No notes.</span>'}</p></section>
      ${portalAccessCard(c)}
    </div>
    <div class="stack">
      <section class="card"><div class="card-head"><h2>Onboarding</h2><span class="muted small">${done}/${ONBOARDING_STEPS.length} complete</span></div>
        ${progressBar(Math.round((done / ONBOARDING_STEPS.length) * 100), { tone: done === 5 ? 'good' : 'warn' })}
        <ol class="steps">${ONBOARDING_STEPS.map((s, i) => `<li class="${c.onboarding[i].done ? 'done' : ''}"><label class="check">
          <input type="checkbox" data-step="${i}" ${c.onboarding[i].done ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
          <span>${esc(s)}${c.onboarding[i].date ? `<span class="muted small"> · ${fmtShortDate(c.onboarding[i].date)}</span>` : ''}</span></label></li>`).join('')}</ol>
        ${canEdit && done === 5 && c.status === 'Onboarding' ? `<button class="btn btn-primary btn-sm" id="goLive">${icon('check')}Mark client Active</button>` : ''}
      </section>
      <section class="card"><div class="card-head"><h2>Package — ${esc(pk.name)}</h2>${pk.rollover ? '<span class="chip tone-info">Rollover on</span>' : '<span class="chip">Quota expires monthly</span>'}</div><dl class="dl">
        ${money ? row('Monthly fee', `<b>${inr(pk.monthlyFee)}</b> + ${Store.settings.gstRate}% GST`) + row('Billing', `${BILLING_CYCLES.find((b) => b.value === String(pk.billingCycle))?.label || 'Day ' + pk.billingDay} · Day ${pk.billingDay} · ${esc(pk.paymentTerms)}`) : ''}
        ${row('Contract', `${fmtDate(pk.startDate)} → ${pk.endDate ? fmtDate(pk.endDate) : 'Ongoing'}${daysLeft !== null ? (daysLeft < 0 ? ' <span class="text-bad">(ended)</span>' : daysLeft <= 30 ? ` <span class="text-warn">(renewal in ${daysLeft}d)</span>` : '') : ''}`)}
        ${row('Monthly quota', QUOTA_TYPES.filter((q) => pk.quotas[q.key]).map((q) => `<span class="chip">${pk.quotas[q.key]} ${esc(q.short.toLowerCase())}</span>`).join(' '))}
        ${row('Shoots', pk.shootType === 'NONE' ? 'None' : `${pk.shootsPerMonth || pk.quotas.shoot || 0}/month · ${esc(SHOOT_TYPES.find((s) => s.value === pk.shootType).label)} · ${esc(pk.shootLocation)}`)}
        ${money ? row('Ad budgets', [pk.metaAdBudget ? `Meta ${inr(pk.metaAdBudget)}` : '', pk.googleAdBudget ? `Google ${inr(pk.googleAdBudget)}` : ''].filter(Boolean).join(' · ')) : ''}
        ${row('Services', (c.services || []).map((s) => `<span class="chip">${esc(s)}</span>`).join(' '))}
      </dl></section>
    </div></div>`;
  bindPortalAccess(body, c);
  $$('[data-step]', body).forEach((cb) => (cb.onchange = () => {
    const i = Number(cb.dataset.step);
    c.onboarding[i] = { done: cb.checked, date: cb.checked ? todayISO() : '' };
    Store.log(cb.checked ? 'Onboarding step completed' : 'Onboarding step reopened', `${c.company} — ${ONBOARDING_STEPS[i]}`, { entity: 'client', entityId: c.id, clientId: c.id });
    Store.save(); Router.render();
  }));
  if ($('#goLive')) $('#goLive').onclick = () => {
    c.status = 'Active';
    if (!c.package.startDate) c.package.startDate = todayISO();
    Store.log('Client activated', `${c.company} onboarding complete → Active`, { entity: 'client', entityId: c.id, clientId: c.id });
    const made = Store.runAutomations(); Store.save(); toast(`${c.company} is now Active${made.length ? ' · invoice generated' : ''}`); Router.render();
  };
}

function c360Quota(body, c, params) {
  const mk = params.month || monthKey();
  const q = quotaStatus(c, mk);
  const canPlan = Perm.canCreateTasks() && Perm.visibleClientIds().has(c.id);
  body.innerHTML = `<section class="card">
    <div class="card-head wrap"><div class="month-nav"><a class="icon-btn" href="#/clients/${c.id}?tab=quota&month=${addMonths(mk, -1)}" aria-label="Previous month">${icon('chevronL')}</a><b>${fmtMonth(mk)} campaign</b><a class="icon-btn" href="#/clients/${c.id}?tab=quota&month=${addMonths(mk, 1)}" aria-label="Next month">${icon('chevronR')}</a></div>
      <div class="page-actions">${canPlan ? `<button class="btn btn-sm" id="planMonth">${icon('sparkle')}Plan month from quota</button><button class="btn btn-sm btn-primary" id="addTask">${icon('plus')}Add task</button>` : ''}
      ${Perm.is('admin', 'pm') ? `<button class="btn btn-sm" id="proof">${icon('print')}Delivery report</button>` : ''}</div></div>
    <div class="big-progress"><b>${q.completed}</b> of ${q.quota} delivered · ${q.pct}% · ${q.inReview} in review${q.late ? ` · <span class="text-bad">${q.late} late</span>` : ''}</div>
    ${progressBar(q.pct)}
    ${q.rows.length ? `<div class="table-wrap pad-top"><table class="table"><thead><tr><th>Deliverable</th><th class="num">Quota</th><th class="num">Completed</th><th class="num">In review</th><th class="num">Remaining</th><th style="min-width:140px"></th></tr></thead><tbody>
      ${q.rows.map((r) => `<tr><td><b>${esc(r.label)}</b>${r.rolled ? `<div class="small text-warn">+${r.rolled} rolled over from last month</div>` : ''}${r.planned < r.quota ? `<div class="small muted">${r.quota - r.planned} not yet planned</div>` : ''}</td>
        <td class="num">${r.quota}</td><td class="num">${r.completed}</td><td class="num">${r.inReview}</td><td class="num ${r.remaining ? '' : 'text-good'}">${r.remaining}</td><td>${progressBar(r.quota ? Math.round((Math.min(r.completed, r.quota) / r.quota) * 100) : 0)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted pad-top">No quota set for this client.</p>'}
  </section>
  <section class="card"><div class="card-head"><h2>Tasks in this campaign</h2></div>${taskTable(q.tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate)), { showClient: false })}</section>`;
  bindTaskTable(body);
  if ($('#addTask')) $('#addTask').onclick = () => openTaskModal(null, { clientId: c.id, campaign: mk, dueDate: mk === monthKey() ? todayISO() : mk + '-01' });
  if ($('#planMonth')) $('#planMonth').onclick = () => {
    const made = planMonthFor(c, mk);
    if (!made.length) return toast('Every quota item for this month is already planned', 'warn');
    Store.log('Campaign planned', `${made.length} backlog tasks created for ${c.company} (${fmtMonth(mk)})`, { entity: 'task', clientId: c.id });
    Store.save(); toast(`${made.length} tasks added to the backlog`); Router.render();
  };
  if ($('#proof')) $('#proof').onclick = () => printDeliveryReport(c.id, mk);
}

function c360Shoots(body, c) {
  const pk = c.package;
  const shoots = Store.tasks.filter((t) => t.clientId === c.id && t.type === 'shoot').sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  body.innerHTML = `<section class="card"><div class="card-head"><h2>Shoot scope</h2>${Perm.canCreateTasks() ? `<button class="btn btn-sm btn-primary" id="addShoot">${icon('plus')}Schedule shoot</button>` : ''}</div>
    <p>${pk.shootType === 'NONE' ? 'No shoots in this package.' : `${pk.quotas.shoot || 0} session(s)/month · ${esc(SHOOT_TYPES.find((s) => s.value === pk.shootType).label)} · ${esc(pk.shootLocation)}`}
    ${pk.rawFootageLink ? ` · ${linkHtml(pk.rawFootageLink, 'Raw footage folder')}` : ''}</p></section>
    <section class="card flush">${shootTable(shoots)}</section>`;
  bindTaskTable(body);
  if ($('#addShoot')) $('#addShoot').onclick = () => openTaskModal(null, { clientId: c.id, type: 'shoot', dueDate: addDays(todayISO(), 3) });
}

function c360Billing(body, c) {
  const pays = Store.payments.filter((p) => p.clientId === c.id).sort((a, b) => b.month.localeCompare(a.month) || b.issueDate.localeCompare(a.issueDate));
  body.innerHTML = `<div class="kpis compact">
      <div class="kpi"><span class="kpi-label">Invoices</span><span class="kpi-value">${pays.length}</span></div>
      <div class="kpi kpi-good"><span class="kpi-label">Collected</span><span class="kpi-value">${inrShort(sum(pays, (p) => p.amountPaid))}</span></div>
      <div class="kpi ${sum(pays, balance) ? 'kpi-bad' : ''}"><span class="kpi-label">Outstanding</span><span class="kpi-value">${inrShort(sum(pays, balance))}</span></div></div>
    <section class="card flush"><div class="card-head pad-card"><h2>Invoices & payments</h2>${Perm.canEditPayments() ? `<button class="btn btn-sm" id="newInv">${icon('plus')}One-off invoice</button>` : ''}</div>${paymentsTable(pays, { showClient: false })}</section>`;
  bindPaymentTable(body);
  if ($('#newInv')) $('#newInv').onclick = () => openManualInvoice(c.id);
}

function c360Feedback(body, c) {
  const list = (c.feedback || []).slice().sort((a, b) => b.month.localeCompare(a.month));
  const canEdit = Perm.is('admin', 'pm') && Perm.visibleClientIds().has(c.id);
  const avg = list.length ? (sum(list, (f) => f.csat) / list.length).toFixed(1) : '—';
  const nps = list.length ? Math.round(sum(list, (f) => f.nps) / list.length * 10) / 10 : '—';
  body.innerHTML = `<div class="grid-2"><section class="card"><div class="card-head"><h2>Client sentiment</h2></div>
      <div class="sentiment-pick">${SENTIMENTS.map((s) => `<button class="btn btn-sm ${c.sentiment === s ? 'on tone-' + STATUS_TONE[s] : ''}" data-sent="${s}" ${canEdit ? '' : 'disabled'}>${esc(s)}</button>`).join('')}</div>
      <div class="kpis compact pad-top"><div class="kpi"><span class="kpi-label">Avg CSAT</span><span class="kpi-value">${avg}<small>/5</small></span></div><div class="kpi"><span class="kpi-label">Avg NPS score</span><span class="kpi-value">${nps}<small>/10</small></span></div><div class="kpi"><span class="kpi-label">Reviews</span><span class="kpi-value">${list.length}</span></div></div>
    </section>
    ${canEdit ? `<section class="card"><div class="card-head"><h2>Log monthly review</h2></div><form id="fbForm" class="form-grid">
      ${field('Month reviewed', inputEl('month', addMonths(monthKey(), -1), { type: 'month' }))}
      ${field('CSAT (1–5 stars)', selectEl('csat', [5, 4, 3, 2, 1].map((n) => ({ value: n, label: '★'.repeat(n) + ` (${n})` })), 4))}
      ${field('NPS (0–10): how likely to recommend us?', inputEl('nps', 8, { type: 'number', attrs: 'min="0" max="10"' }))}
      ${field('Notes from the review call', textareaEl('notes', '', { rows: 2 }), { full: true })}
      <div class="full"><button class="btn btn-primary" type="submit">Save review</button></div></form></section>` : ''}</div>
    <section class="card"><div class="card-head"><h2>Feedback history</h2></div>${list.length ? `<div class="mini-list">${list.map((f) => `<div class="mini-row"><div><b>${fmtMonth(f.month)}</b><span class="muted small">${esc(f.notes || '')}</span><span class="dim small">Logged by ${esc(Store.userName(f.by))} · ${fmtDate(f.date)}</span></div>
      <div class="right">${stars(f.csat)}<span class="small">NPS <b class="${f.nps >= 9 ? 'text-good' : f.nps <= 6 ? 'text-bad' : ''}">${f.nps}</b> ${f.nps >= 9 ? '(promoter)' : f.nps <= 6 ? '(detractor)' : '(passive)'}</span></div></div>`).join('')}</div>` : emptyState('No reviews logged yet')}</section>`;
  $$('[data-sent]', body).forEach((b) => (b.onclick = () => {
    if (c.sentiment === b.dataset.sent) return;
    Store.log('Sentiment changed', `${c.company} ${c.sentiment} → ${b.dataset.sent}`, { entity: 'client', entityId: c.id, clientId: c.id });
    c.sentiment = b.dataset.sent; Store.save(); Router.render();
  }));
  if ($('#fbForm')) $('#fbForm').onsubmit = (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const n = Math.max(0, Math.min(10, Number(d.nps)));
    c.feedback = (c.feedback || []).filter((f) => f.month !== d.month);
    c.feedback.push({ id: uid('fb'), month: d.month, csat: Number(d.csat), nps: n, notes: d.notes.trim(), by: Store.currentUser().id, date: todayISO() });
    // Nudge sentiment automatically on poor scores
    if ((Number(d.csat) <= 2 || n <= 4) && !['At-Risk', 'Critical'].includes(c.sentiment)) { Store.log('Sentiment changed', `${c.company} ${c.sentiment} → At-Risk (low review score)`, { entity: 'client', entityId: c.id, clientId: c.id }); c.sentiment = 'At-Risk'; }
    Store.log('Feedback logged', `${c.company} — ${fmtMonth(d.month)}: CSAT ${d.csat}/5, NPS ${n}`, { entity: 'client', entityId: c.id, clientId: c.id });
    Store.save(); toast('Review saved'); Router.render();
  };
}

function c360Referrals(body, c) {
  const canEdit = Perm.is('admin', 'pm') && Perm.visibleClientIds().has(c.id);
  const money = Perm.canSeeMoney();
  const refs = c.referrals || [];
  body.innerHTML = `<section class="card"><div class="card-head"><h2>Referred by</h2></div><p>${c.referredBy ? (c.referredBy.type === 'client' ? `<a href="#/clients/${c.referredBy.clientId}">${esc(c.referredBy.name)}</a> (client)` : `${esc(c.referredBy.name)} (partner)`) : '<span class="muted">Not a referral</span>'}</p></section>
    <section class="card"><div class="card-head"><h2>Referrals made by ${esc(c.company)}</h2>${canEdit ? `<button class="btn btn-sm btn-primary" id="addRef">${icon('plus')}Log referral</button>` : ''}</div>
    ${refs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Referred business</th><th>Date</th><th>Status</th>${money ? '<th class="num">Credit</th><th>Applied</th>' : ''}<th class="hide-sm">Notes</th></tr></thead><tbody>
      ${refs.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${fmtDate(r.date)}</td><td>${badge(r.status, r.status === 'Converted' ? 'good' : r.status === 'Lost' ? 'muted' : 'violet')}</td>
        ${money ? `<td class="num">${r.credit ? inr(r.credit) : '—'}</td><td>${r.credit ? (canEdit ? `<label class="check"><input type="checkbox" data-applied="${r.id}" ${r.creditApplied ? 'checked' : ''}> ${r.creditApplied ? 'Applied' : 'Not yet'}</label>` : r.creditApplied ? 'Applied' : 'Not yet') : '—'}</td>` : ''}
        <td class="hide-sm muted">${esc(r.notes)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No referrals yet')}</section>`;
  $$('[data-applied]', body).forEach((cb) => (cb.onchange = () => {
    const r = refs.find((x) => x.id === cb.dataset.applied); r.creditApplied = cb.checked;
    Store.log('Referral credit', `${c.company}: ${inr(r.credit)} credit for ${r.name} ${cb.checked ? 'applied' : 'un-applied'}`, { entity: 'client', entityId: c.id, clientId: c.id });
    Store.save(); Router.render();
  }));
  if ($('#addRef')) $('#addRef').onclick = () => {
    const m = Modal.open({ title: 'Log referral', body: `<form id="refForm" class="form-grid">
      ${field('Referred business', inputEl('name', '', { required: true }), { required: true, full: true })}
      ${field('Status', selectEl('status', ['Lead', 'Converted', 'Lost'], 'Lead'))}
      ${field('Referral bonus / discount credit (₹)', inputEl('credit', 0, { type: 'number', attrs: 'min="0"' }))}
      ${field('Notes', inputEl('notes', ''), { full: true })}<p class="form-error full" hidden></p></form>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="refSave">Save</button>` });
    $('#refSave', m).onclick = () => {
      const d = formData($('#refForm', m));
      if (!d.name.trim()) { const e = $('.form-error', m); e.textContent = 'Enter the business name.'; e.hidden = false; return; }
      c.referrals = refs.concat({ id: uid('ref'), name: d.name.trim(), date: todayISO(), status: d.status, credit: Number(d.credit) || 0, creditApplied: false, notes: d.notes.trim() });
      Store.log('Referral logged', `${c.company} referred ${d.name.trim()} (${d.status})`, { entity: 'client', entityId: c.id, clientId: c.id });
      Store.save(); Modal.close(); Router.render();
    };
  };
}

function c360Activity(body, c) {
  const acts = Store.data.activity.filter((a) => a.clientId === c.id);
  body.innerHTML = `<section class="card"><div class="card-head"><h2>Activity for ${esc(c.company)}</h2></div><div class="timeline">${acts.map(activityRow).join('') || emptyState('No activity yet')}</div></section>`;
}
