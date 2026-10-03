/* ==========================================================================
   ui.js — icons, toasts, modals, form helpers, shell layout, router
   ========================================================================== */

const ICONS = {
  dashboard: '<path d="M4 4h6v8H4zM14 4h6v5h-6zM14 13h6v7h-6zM4 16h6v4H4z"/>',
  clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 13.8c2.1.8 3.5 3 3.5 6.2"/>',
  payments: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
  content: '<rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M3 9h18M8 3.5v17"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  team: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  whatsapp: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19.2z"/><path d="M9 9.5c.3 2 2.1 4 4.3 4.6l1.2-1.2 1.8.9c-.3 1.2-1.3 1.7-2.4 1.6-3-.4-5.8-3.2-6.2-6.2-.1-1.1.4-2.1 1.6-2.4l.9 1.8z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v4M12 17.5v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10"/>',
  chevronL: '<path d="m15 6-6 6 6 6"/>',
  chevronR: '<path d="m9 6 6 6-6 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  kanban: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  rupee: '<path d="M7 4h10M7 9h10M7 4c5 0 7 1.5 7 5s-3 5-7 5l7 7"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><path d="M16 14.5h.01"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  heat: '<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="10" y="3" width="5" height="5" rx="1"/><rect x="17" y="3" width="4" height="5" rx="1"/><rect x="3" y="10" width="5" height="5" rx="1"/><rect x="10" y="10" width="5" height="5" rx="1"/><rect x="3" y="17" width="5" height="4" rx="1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ---------- Badges ---------- */
const STATUS_TONE = {
  Lead: 'violet', Onboarding: 'info', Active: 'good', 'On Hold': 'warn', Churned: 'muted', Archived: 'muted',
  Delighted: 'good', Neutral: 'neutral', 'At-Risk': 'warn', Critical: 'bad',
  Paid: 'good', 'Partially Paid': 'info', Pending: 'neutral', Overdue: 'bad', 'In Dispute': 'violet',
  Backlog: 'neutral', 'Scripting / Brief': 'teal', 'Design / Editing': 'info', 'Internal Review': 'violet', 'Client Approval': 'warn', 'Ready to Publish': 'good', Published: 'good-strong',
  Urgent: 'bad', High: 'warn', Medium: 'info', Low: 'neutral',
  Approved: 'good', Rejected: 'bad', Inactive: 'muted', 'On Leave': 'info',
};
function badge(text, tone) {
  return `<span class="badge tone-${tone || STATUS_TONE[text] || 'neutral'}">${esc(text)}</span>`;
}
function progressBar(pct, { tone, label } = {}) {
  const t = tone || (pct >= 75 ? 'good' : pct >= 40 ? 'warn' : 'bad');
  return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" ${label ? `aria-label="${esc(label)}"` : ''}>
    <div class="progress-fill tone-${t}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
}
function avatar(name, size = '') {
  return `<span class="avatar ${size}" title="${esc(name)}">${esc(initials(name))}</span>`;
}
function emptyState(title, text = '', action = '') {
  return `<div class="empty"><div class="empty-title">${esc(title)}</div>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}

/* ---------- Toast ---------- */
function toast(msg, type = 'ok') {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.setAttribute('role', 'status');
  el.innerHTML = icon(type === 'error' ? 'x' : type === 'warn' ? 'alert' : 'check') + `<span>${esc(msg)}</span>`;
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

/* ---------- Modal ---------- */
const Modal = {
  open({ title, body, footer = '', size = '', onMount, onClose } = {}) {
    this.close();
    this.onClose = onClose || null;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) this.close(); });
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) this.close(); });
    document.body.appendChild(wrap);
    document.body.classList.add('modal-open');
    this.el = wrap;
    const first = wrap.querySelector('input:not([type=hidden]), select, textarea');
    if (first && window.innerWidth > 700) setTimeout(() => first.focus(), 30);
    if (onMount) onMount(wrap);
    return wrap;
  },
  close() {
    if (this.el) {
      this.el.remove(); this.el = null; document.body.classList.remove('modal-open');
      const cb = this.onClose; this.onClose = null;
      if (cb) cb();
    }
  },
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') Modal.close(); });

function confirmDialog(title, message, confirmLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const m = Modal.open({
      title, body: `<p>${esc(message)}</p>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmOk">${esc(confirmLabel)}</button>`,
    });
    let answered = false;
    $('#confirmOk', m).onclick = () => { answered = true; Modal.close(); resolve(true); };
    const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); if (!answered) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

/* ---------- Form helpers ---------- */
function field(label, input, { hint = '', full = false, required = false } = {}) {
  return `<label class="field ${full ? 'full' : ''}"><span class="field-label">${esc(label)}${required ? ' <b class="req">*</b>' : ''}</span>${input}${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}</label>`;
}
function inputEl(name, value = '', { type = 'text', placeholder = '', required = false, attrs = '' } = {}) {
  return `<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${attrs}>`;
}
function selectEl(name, options, value = '', { required = false, placeholder = '', attrs = '' } = {}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return `<select name="${name}" ${required ? 'required' : ''} ${attrs}>${placeholder !== '' ? `<option value="">${esc(placeholder)}</option>` : ''}${
    opts.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
}
function textareaEl(name, value = '', { rows = 3, placeholder = '' } = {}) {
  return `<textarea name="${name}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
}
function formData(form) {
  const out = {};
  new FormData(form).forEach((v, k) => {
    if (k in out) { out[k] = [].concat(out[k], v); } else out[k] = v;
  });
  return out;
}
function clientOptions(clients = Perm.visibleClients()) {
  return clients.map((c) => ({ value: c.id, label: c.company }));
}
function userOptions(roles) {
  return Store.users.filter((u) => !roles || roles.includes(u.role)).map((u) => ({ value: u.id, label: u.name }));
}

/* ---------- Links & files ----------
   Stored links are either web URLs or uploaded files ("file:<id>|<name>").
   Only http(s)/mailto/tel links are ever rendered, so a pasted javascript: link can't run. */
function safeUrl(u) { return /^(https?:\/\/|mailto:|tel:)/i.test(String(u || '').trim()) ? String(u).trim() : ''; }
function normLink(v) { const s = String(v || '').trim(); return !s || isFileRef(s) || /^https?:\/\//i.test(s) ? s : 'https://' + s; }
function isFileRef(v) { return /^file:[a-f0-9]{24}/.test(v || ''); }
function fileRefName(v) { return (String(v).split('|')[1] || 'Attachment'); }
function linkHtml(v, label, { cls = '', iconOnly = false } = {}) {
  if (!v) return '';
  if (isFileRef(v)) {
    const id = v.slice(5, 29);
    return `<a href="#" class="${cls}" data-file="${id}" title="${esc(fileRefName(v))}">${iconOnly ? icon('link') : esc(label || fileRefName(v))}</a>`;
  }
  const u = safeUrl(v);
  return u ? `<a href="${esc(u)}" class="${cls}" target="_blank" rel="noopener noreferrer" title="${esc(u)}">${iconOnly ? icon('link') : esc(label || 'Open')}</a>` : '';
}
/* Text box for a link plus an Upload button (server mode only) */
function linkField(name, value = '', { scope = 'general', placeholder = 'https://… or upload a file', attrs = '' } = {}) {
  const canUpload = Api.mode === 'server' && !/disabled/.test(attrs);
  return `<div class="link-field"><input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}>
    ${canUpload ? `<label class="btn btn-sm upload-btn" title="Upload a file">${icon('download', 'flip')}<span>Upload</span><input type="file" hidden data-upload="${name}" data-scope="${scope}"></label>` : ''}
    ${isFileRef(value) ? `<span class="file-chip">${linkHtml(value)}</span>` : ''}</div>`;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-file]');
  if (a) { e.preventDefault(); e.stopPropagation(); Api.openFile(a.dataset.file); return; }
  if (e.target.closest('a[target=_blank]') && e.target.closest('tr[data-task], .kcard, tr[data-c]')) e.stopPropagation(); // open links without opening the row
}, true);
document.addEventListener('change', async (e) => {
  const inp = e.target.closest('input[type=file][data-upload]');
  if (!inp || !inp.files[0]) return;
  const file = inp.files[0];
  const wrap = inp.closest('.link-field');
  const btn = inp.closest('.upload-btn');
  btn.classList.add('busy'); btn.querySelector('span').textContent = 'Uploading…';
  try {
    const r = await Api.upload(file, inp.dataset.scope);
    const target = wrap.querySelector(`input[name="${inp.dataset.upload}"]`);
    target.value = r.ref;
    let chip = wrap.querySelector('.file-chip');
    if (!chip) { chip = document.createElement('span'); chip.className = 'file-chip'; wrap.appendChild(chip); }
    chip.innerHTML = linkHtml(r.ref);
    toast(`${r.name} uploaded — save to attach it`);
  } catch (x) { toast(x.message, 'error'); }
  finally { btn.classList.remove('busy'); btn.querySelector('span').textContent = 'Upload'; inp.value = ''; }
});

async function copyText(text, okMsg = 'Copied to clipboard') {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(okMsg); } catch (_) { toast('Could not copy — select the text and copy manually', 'warn'); }
    ta.remove();
  }
}

/* ==========================================================================
   Shell + router
   ========================================================================== */
const NAV = [
  { route: 'portal',    label: 'Overview',  icon: 'dashboard', can: () => Perm.is('client') },
  { route: 'approvals', label: 'Approvals', icon: 'check',     can: () => Perm.is('client') },
  { route: 'deliverables', label: 'Deliverables', icon: 'content', can: () => Perm.is('client') },
  { route: 'invoices',  label: 'Invoices',  icon: 'payments',  can: () => Perm.is('client') },
  { route: 'dashboard', label: 'Dashboard', icon: 'dashboard', can: () => !Perm.is('client') },
  { route: 'workspace', label: 'My Day', icon: 'clock', can: () => !Perm.is('client') },
  { route: 'clients',   label: 'Clients',   icon: 'clients',   can: () => Perm.canSeeClients() },
  { route: 'tasks',     label: 'Tasks & Board', icon: 'kanban', can: () => Perm.canSeeTasks() },
  { route: 'shoots',    label: 'Shoot Schedule', icon: 'camera', can: () => Perm.is('admin', 'pm', 'shoot') },
  { route: 'payments',  label: 'Billing',   icon: 'payments',  can: () => Perm.canSeeMoney() },
  { route: 'team',      label: 'Team & HR', icon: 'team',      can: () => Perm.canSeeAttendance() },
  { route: 'payroll',   label: 'Payroll',   icon: 'wallet',    can: () => Perm.canRunPayroll() },
  { route: 'reports',   label: 'Reports',   icon: 'reports',   can: () => Perm.is('admin', 'pm', 'finance') },
  { route: 'activity',  label: 'Audit Trail', icon: 'shield', can: () => Perm.canSeeAudit() },
  { route: 'settings',  label: 'Settings',  icon: 'settings',  can: () => Perm.is('admin') },
];

const Views = {}; // filled by the view files: Views.dashboard = (params) => {...}

const Router = {
  parse() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, query = ''] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(query));
    return { route: parts[0] || 'dashboard', id: parts[1], params };
  },
  go(hash) { if (location.hash === hash) this.render(); else location.hash = hash; },
  render() {
    if (!Store.currentUser()) { renderLogin(); return; }
    const home = Perm.is('client') ? 'portal' : 'dashboard';
    let { route, id, params } = this.parse();
    if (route === 'dashboard' && home !== 'dashboard') route = home;
    const nav = NAV.find((n) => n.route === route);
    if (!nav || !nav.can()) { location.replace('#/' + home); if (route === home) renderShell(home); return; }
    renderShell(route);
    const main = $('#main');
    main.innerHTML = '';
    try { Views[route](main, id, params); }
    catch (e) { console.error(e); main.innerHTML = emptyState('Something went wrong', e.message); }
    $('.sidebar')?.classList.remove('open');
    window.scrollTo(0, 0);
  },
};
window.addEventListener('hashchange', () => { Modal.close(); Router.render(); });

function renderShell(active) {
  const u = Store.currentUser();
  const app = $('#app');
  if (!$('.shell', app)) {
    app.innerHTML = `<div class="shell">
      <aside class="sidebar" aria-label="Main navigation">
        <div class="brand"><span class="brand-mark">${icon('sparkle')}</span><span class="brand-name"></span></div>
        <nav class="nav"></nav>
        <div class="sidebar-foot"></div>
      </aside>
      <div class="scrim"></div>
      <div class="main-col">
        <header class="topbar">
          <button class="icon-btn menu-btn" aria-label="Open menu">${icon('menu')}</button>
          <div class="topbar-title"></div>
          <div class="topbar-right">
            <button class="icon-btn theme-btn" aria-label="Toggle dark mode">${icon('moon')}</button>
          </div>
        </header>
        <main id="main" tabindex="-1"></main>
      </div>
    </div>`;
    $('.menu-btn', app).onclick = () => $('.sidebar').classList.add('open');
    $('.scrim', app).onclick = () => $('.sidebar').classList.remove('open');
  }
  $('.brand-name').textContent = Store.settings.agencyName || 'AgencyDesk';
  const counts = {
    payments: [Perm.visiblePayments().filter((p) => p.status === 'Overdue').length, 'Overdue invoices'],
    tasks: [Perm.canSeeTasks() ? Perm.visibleTasks().filter((t) => isLate(t)).length : 0, 'Late tasks'],
    team: [Perm.canApproveLeave() ? pendingLeavesFor(u).length : 0, 'Leave requests awaiting approval'],
  };
  $('.nav').innerHTML = NAV.filter((n) => n.can()).map((n) => {
    const [count, title] = counts[n.route] || [0, ''];
    return `<a href="#/${n.route}" class="nav-link ${n.route === active ? 'active' : ''}">${icon(n.icon)}<span>${n.label}</span>${count ? `<span class="nav-count" title="${title}">${count}</span>` : ''}</a>`;
  }).join('');
  $('.sidebar-foot').innerHTML = `<div class="me">${avatar(u.name)}<div class="me-text"><b>${esc(u.name)}</b><span>${esc(ROLES[u.role].label)}</span></div>
    <button class="icon-btn theme-btn" aria-label="Toggle dark mode" title="Light / dark mode">${icon('moon')}</button>${Api.mode === 'server' ? `<button class="icon-btn" id="pwBtn" title="Account security" aria-label="Account security">${icon('shield')}</button>` : ''}<button class="icon-btn" id="logoutBtn" title="${Api.mode === 'server' ? 'Sign out' : 'Switch user'}" aria-label="Sign out">${icon('logout')}</button></div>
    <div class="sync-state ${Api.mode === 'server' ? 'saved' : 'local'}">${Api.mode === 'server' ? 'All changes saved' : 'Demo mode · this browser only'}</div>`;
  if ($('#pwBtn')) $('#pwBtn').onclick = openSecurity;
  $('#logoutBtn').onclick = () => {
    Store.log('Signed out', `${u.name} signed out`);
    if (Api.mode === 'server') { location.hash = ''; return Api.signOut(); }
    Store.data.session.userId = null; Store.save(); location.hash = ''; renderLogin();
  };
  const nav = NAV.find((n) => n.route === active);
  $('.topbar-title').textContent = nav ? nav.label : '';
  $$('.theme-btn').forEach((b) => (b.onclick = toggleTheme));
  syncThemeIcon();
  if (typeof Assistant !== 'undefined') Assistant.mount();
}

/* Leave requests this person can approve (not their own; PMs approve creative/shoot staff) */
function pendingLeavesFor(u) {
  return Store.data.leaves.filter((l) => l.status === 'Pending' && l.userId !== u.id
    && (u.role === 'admin' || ['creative', 'shoot'].includes((Store.user(l.userId) || {}).role)));
}

function setTitle(html, actions = '') {
  return `<div class="page-head"><div>${html}</div><div class="page-actions">${actions}</div></div>`;
}

/* ---------- Theme ---------- */
function applyTheme() {
  let t = null;
  try { t = localStorage.getItem('agencyDesk.theme'); } catch (e) {}
  if (t) document.documentElement.setAttribute('data-theme', t);
}
function currentThemeIsDark() {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function toggleTheme() {
  const next = currentThemeIsDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('agencyDesk.theme', next); } catch (e) {}
  syncThemeIcon();
}
function syncThemeIcon() { $$('.theme-btn').forEach((b) => (b.innerHTML = icon(currentThemeIsDark() ? 'sun' : 'moon'))); }

/* ---------- Login (choose team member) ---------- */
function renderLogin() {
  if (typeof Assistant !== 'undefined') Assistant.unmount();
  if (Api.mode === 'server') return renderServerLogin();
  const app = $('#app');
  const s = Store.settings;
  app.innerHTML = `<div class="login">
    <div class="login-card">
      <div class="brand big"><span class="brand-mark">${icon('sparkle')}</span><span>${esc(s.agencyName)}</span></div>
      <h1>Welcome back</h1>
      <p class="muted">Choose your name to sign in. What you can see depends on your role.</p>
      <div class="login-list">
        ${Object.keys(ROLES).map((r) => { const list = Store.activeUsers().filter((u) => u.role === r); return list.length ? `<div class="login-group">${esc(ROLES[r].label)}</div>` +
          list.map((u) => `<button class="login-user" data-id="${u.id}">${avatar(u.name)}<span><b>${esc(u.name)}</b><small>${esc(u.designation || ROLES[u.role].label)}</small></span>${icon('chevronR')}</button>`).join('') : ''; }).join('')}
      </div>
      <p class="fine">Demo sign-in without passwords — data is stored in this browser only. Real logins with 2FA need the backend described in the README.</p>
    </div></div>`;
  $$('.login-user', app).forEach((b) => (b.onclick = () => {
    Store.data.session.userId = b.dataset.id;
    Store.log('Signed in', `${Store.currentUser().name} signed in`);
    Store.save();
    if (!location.hash || location.hash === '#') location.hash = '#/dashboard'; // otherwise keep the deep link
    Router.render();
    tick(); // invoices, overdue status, auto-reminders
  }));
}

/* ---------- Table helper with sortable headers ---------- */
function sortRows(rows, key, dir) {
  const m = dir === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const x = a[key], y = b[key];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
    return String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true }) * m;
  });
}
