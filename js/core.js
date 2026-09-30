/* ==========================================================================
   core.js — AgencyDesk data model, utilities, business rules, permissions
   Collections mirror the PRD schema: clients (+package, onboarding, feedback,
   referrals), invoices, tasks, users (employees), attendance, leaves, eod,
   activity (hash-chained audit trail).
   ========================================================================== */

const STORAGE_KEY = 'agencyDesk.v2';
const DATA_VERSION = 2;

/* ---------- Roles ---------- */
const ROLES = {
  admin:    { label: 'Super Admin',        desc: 'Full access: finances, clients, employees, audit and settings' },
  pm:       { label: 'Account / Project Manager', desc: 'Assigned clients, quotas, tasks, feedback, leave approvals' },
  creative: { label: 'Creative Team',      desc: 'Assigned tasks, status updates, daily log, leave requests' },
  shoot:    { label: 'Production / Shoot Crew', desc: 'Shoot schedule, equipment checklist, raw file handoffs' },
  finance:  { label: 'Finance / Operations', desc: 'Invoices, collections, salary slips, renewals' },
  client:   { label: 'Client (portal)',    desc: 'Approves deliverables, sees their invoices, gives feedback' },
};
const DEPARTMENTS = ['Management', 'Accounts', 'Design', 'Video', 'Copy', 'Ads', 'Shoot', 'HR & Ops'];
const WORK_ARRANGEMENTS = ['Full-Time In-Office', 'Hybrid', 'Fully Remote', 'Freelancer / Contractor'];
const EMPLOYEE_STATUSES = ['Active', 'Inactive', 'On Leave'];

/* ---------- Clients ---------- */
const CATEGORIES = ['Health & Wellness', 'Education & EdTech', 'Real Estate', 'E-Commerce', 'Hospitality', 'Professional Services', 'Custom'];
const CLIENT_STATUSES = ['Lead', 'Onboarding', 'Active', 'On Hold', 'Churned'];
const SENTIMENTS = ['Delighted', 'Neutral', 'At-Risk', 'Critical'];
const ONBOARDING_STEPS = [
  'Contract signed & advance received',
  'Brand questionnaire / intake form submitted',
  'Social media access & ad account delegation',
  'Visual identity assets received (logos, fonts, guidelines)',
  'Kick-off call done & month-1 strategy approved',
];
const BILLING_CYCLES = [{ value: '1', label: '1st of month' }, { value: '15', label: 'Mid-month (15th)' }, { value: 'custom', label: 'Custom day' }];
const PAYMENT_TERMS = ['100% Advance', '50-50 Milestone', 'Net 15', 'Net 30'];
const SHOOT_TYPES = [{ value: 'NONE', label: 'No shoots' }, { value: 'CAMERA_DSLR', label: 'Professional DSLR / Mirrorless' }, { value: 'MOBILE_PHONE', label: 'Mobile / Smartphone (gimbal)' }, { value: 'HYBRID', label: 'Hybrid (camera + mobile)' }];
const SHOOT_LOCATIONS = ['On-site (client premises)', 'Studio', 'Outdoor'];
const SERVICES = ['Social Media Management', 'Performance Ads (Meta)', 'Google Ads', 'SEO', 'Video Production', 'Photo / Video Shoots', 'Content Writing', 'Newsletters', 'Branding'];

/* Quota keys used in packages; task types map onto them */
const QUOTA_TYPES = [
  { key: 'poster', label: 'Posters / Carousels', short: 'Posters' },
  { key: 'reel', label: 'Reels / Shorts', short: 'Reels' },
  { key: 'story', label: 'Stories', short: 'Stories' },
  { key: 'video', label: 'Long videos', short: 'Videos' },
  { key: 'blog', label: 'SEO blogs', short: 'Blogs' },
  { key: 'ad', label: 'Ad creatives', short: 'Ads' },
  { key: 'newsletter', label: 'Newsletters', short: 'Newsletters' },
  { key: 'shoot', label: 'Shoot sessions', short: 'Shoots' },
];

/* ---------- Money ---------- */
const PAYMENT_MODES = ['UPI', 'Bank Transfer', 'Razorpay', 'Stripe', 'Card', 'Cheque', 'Cash'];
const PAYMENT_STATUSES = ['Pending', 'Partially Paid', 'Paid', 'Overdue', 'In Dispute'];

/* ---------- Tasks ---------- */
const TASK_TYPES = [
  { key: 'poster', label: 'Poster', quota: 'poster' },
  { key: 'carousel', label: 'Carousel', quota: 'poster' },
  { key: 'reel', label: 'Reel / Short', quota: 'reel' },
  { key: 'story', label: 'Story', quota: 'story' },
  { key: 'video', label: 'Long video', quota: 'video' },
  { key: 'blog', label: 'SEO blog', quota: 'blog' },
  { key: 'ad', label: 'Ad creative', quota: 'ad' },
  { key: 'newsletter', label: 'Newsletter', quota: 'newsletter' },
  { key: 'script', label: 'Script', quota: null },
  { key: 'adcopy', label: 'Ad copy', quota: null },
  { key: 'shoot', label: 'Shoot', quota: 'shoot' },
  { key: 'shootprep', label: 'Shoot preparation', quota: null },
  { key: 'other', label: 'Other', quota: null },
];
const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];
const TASK_STATUSES = ['Backlog', 'Scripting / Brief', 'Design / Editing', 'Internal Review', 'Client Approval', 'Ready to Publish', 'Published'];
const DONE_STATUSES = ['Ready to Publish', 'Published'];
const REVIEW_STATUSES = ['Internal Review', 'Client Approval'];
const SHOOT_CHECKLIST = [
  { key: 'camera', label: 'Camera body (charged)' },
  { key: 'lens', label: '50mm / primary lens' },
  { key: 'mic', label: 'Wireless mic' },
  { key: 'gimbal', label: 'Gimbal / stabiliser' },
  { key: 'card', label: 'Memory card formatted' },
  { key: 'batteries', label: 'Spare batteries' },
  { key: 'lights', label: 'Lights / reflector' },
];

/* ---------- Attendance / leave ---------- */
const BREAK_TYPES = ['Lunch', 'Short break'];
const LEAVE_TYPES = [{ key: 'casual', label: 'Casual' }, { key: 'sick', label: 'Sick' }, { key: 'pto', label: 'Paid time off' }, { key: 'unpaid', label: 'Unpaid' }];
const LEAVE_STATUSES = ['Pending', 'Approved', 'Rejected'];

/* ==========================================================================
   Utilities
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clone = (o) => JSON.parse(JSON.stringify(o));
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
function inr(n) { return inrFmt.format(Math.round(Number(n) || 0)); }
function inrShort(n) {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
  if (Math.abs(n) >= 1e3) return '₹' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return inr(n);
}

/* Dates are stored as local 'YYYY-MM-DD'; months as 'YYYY-MM'; times as epoch ms */
function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseISO(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); }
function todayISO() { return toISO(new Date()); }
function monthKey(d = new Date()) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
function monthOf(iso) { return iso ? iso.slice(0, 7) : ''; }
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function addMonths(mk, n) { const [y, m] = mk.split('-').map(Number); return monthKey(new Date(y, m - 1 + n, 1)); }
function daysInMonth(mk) { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
function dateRange(from, to) { const out = []; for (let d = from, g = 0; d <= to && g < 400; d = addDays(d, 1), g++) out.push(d); return out; }
function fmtDate(iso) { return iso ? parseISO(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function fmtShortDate(iso) { return iso ? parseISO(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'; }
function fmtMonth(mk) { if (!mk) return '—'; const [y, m] = mk.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); }
function fmtMonthShort(mk) { const [y, m] = mk.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short' }); }
function fmtTime(ts) { return ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'; }
function fmtDateTime(ts) { return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function fmtHours(ms) { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}h ${pad(m % 60)}m`; }
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return fmtDateTime(ts);
}
function atTime(iso, hhmm) { const [h, m] = hhmm.split(':').map(Number); const d = parseISO(iso); d.setHours(h, m, 0, 0); return d.getTime(); }
function firstName(name) { return String(name || '').replace(/^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s+/i, '').split(' ')[0] || name; }
function initials(name) { return (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }
function taskType(key) { return TASK_TYPES.find((t) => t.key === key) || { key, label: key, quota: null }; }
function quotaLabel(key) { return (QUOTA_TYPES.find((q) => q.key === key) || {}).label || key; }

/* ---------- Export helpers ---------- */
function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function toCSV(rows) {
  return rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
}
function exportCSV(rows, filename) { downloadBlob('﻿' + toCSV(rows), filename + '.csv', 'text/csv;charset=utf-8'); }
let _xlsxLoading = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_xlsxLoading) return _xlsxLoading;
  _xlsxLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { _xlsxLoading = null; reject(new Error('offline')); };
    document.head.appendChild(s);
  });
  return _xlsxLoading;
}
async function exportExcel(rows, filename, sheetName = 'Report') {
  try {
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = rows[0].map((_, i) => ({ wch: Math.min(40, Math.max(10, ...rows.map((r) => String(r[i] ?? '').length))) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, filename + '.xlsx');
  } catch (e) {
    toast('Excel export needs an internet connection — downloaded CSV instead (opens in Excel).', 'warn');
    exportCSV(rows, filename);
  }
}

/* FNV-1a hash — used to chain audit entries so edits to history are detectable */
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

/* ==========================================================================
   Store
   ========================================================================== */
const Store = {
  data: null,
  load() {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) this.data = JSON.parse(raw); }
    catch (e) { console.warn('Could not read saved data', e); }
    if (!this.data || this.data.version !== DATA_VERSION) this.data = buildSampleData();
    this.runAutomations();
    this.save();
  },
  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
    catch (e) { toast('Could not save — browser storage is full or blocked.', 'error'); }
  },
  reset() { this.data = buildSampleData(); this.runAutomations(); this.save(); },

  get users() { return this.data.users; },
  get clients() { return this.data.clients; },
  get payments() { return this.data.invoices; },
  get tasks() { return this.data.tasks; },
  get settings() { return this.data.settings; },
  user(id) { return this.data.users.find((u) => u.id === id); },
  client(id) { return this.data.clients.find((c) => c.id === id); },
  payment(id) { return this.data.invoices.find((p) => p.id === id); },
  task(id) { return this.data.tasks.find((t) => t.id === id); },
  userName(id) { return (this.user(id) || {}).name || 'Unassigned'; },
  clientName(id) { return (this.client(id) || {}).company || 'Unknown client'; },
  currentUser() { return this.data && this.data.session ? this.user(this.data.session.userId) : null; },
  activeUsers() { return this.data.users.filter((u) => u.status !== 'Inactive' && u.role !== 'client'); }, // staff only
  portalUsers(clientId) { return this.data.users.filter((u) => u.role === 'client' && (!clientId || u.clientId === clientId)); },

  log(action, details, meta = {}) {
    const u = this.currentUser();
    appendAudit(this.data, { userId: u ? u.id : 'system', userName: u ? u.name : 'System', action, details, ...meta });
  },
  runAutomations() {
    const created = generateInvoices(this.data);
    refreshPaymentStatuses(this.data);
    return created;
  },
};

function appendAudit(data, { userId, userName, action, details, entity = '', entityId = '', clientId = '', ts = Date.now() }) {
  const prev = data.activity[0] ? data.activity[0].hash : '00000000';
  const entry = { id: uid('act'), ts, userId, userName, action, details, entity, entityId, clientId, prev };
  entry.hash = fnv(prev + '|' + entry.ts + '|' + userId + '|' + action + '|' + details + '|' + entityId);
  data.activity.unshift(entry);
  if (data.activity.length > 5000) data.activity.length = 5000;
}
/* Returns index of first broken entry (newest-first array), or -1 if intact */
function verifyAudit(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    const expected = fnv(e.prev + '|' + e.ts + '|' + e.userId + '|' + e.action + '|' + e.details + '|' + e.entityId);
    if (e.hash !== expected) return i;
    if (i < list.length - 1 && e.prev !== list[i + 1].hash) return i;
  }
  return -1;
}
function systemLog(data, action, details, meta = {}) {
  if (!data.session) return; // skip while building sample data
  appendAudit(data, { userId: 'system', userName: 'System', action, details, ...meta });
}

/* ==========================================================================
   Billing: invoices with GST, payment terms, milestones, status
   ========================================================================== */
function stateCode(gstin) { return /^\d{2}/.test(gstin || '') ? gstin.slice(0, 2) : ''; }
function gstBreakup(subtotal, client, settings) {
  const rate = Number(settings.gstRate) || 0;
  const tax = Math.round((subtotal * rate) / 100);
  const agencyState = stateCode(settings.gstin);
  const clientState = stateCode(client && client.gstin) || agencyState;
  const inter = agencyState && clientState && agencyState !== clientState;
  return inter
    ? { rate, cgst: 0, sgst: 0, igst: tax, tax, total: subtotal + tax, inter: true }
    : { rate, cgst: Math.floor(tax / 2), sgst: tax - Math.floor(tax / 2), igst: 0, tax, total: subtotal + tax, inter: false };
}
function termDays(terms, settings) {
  return { '100% Advance': Number(settings.dueDays) || 7, 'Net 15': 15, 'Net 30': 30, '50-50 Milestone': Number(settings.dueDays) || 7 }[terms] ?? (Number(settings.dueDays) || 7);
}
/* Payment schedule: one due date, or two 50% milestones (issue+terms, then month end) */
function buildSchedule(total, issueDate, mk, terms, settings) {
  const first = addDays(issueDate, termDays(terms, settings));
  if (terms === '50-50 Milestone') {
    const half = Math.round(total / 2);
    let second = mk + '-' + pad(daysInMonth(mk));
    if (second <= first) second = addDays(first, 15);
    return [{ due: first, amount: half, label: 'Milestone 1 (50%)' }, { due: second, amount: total - half, label: 'Milestone 2 (50%)' }];
  }
  return [{ due: first, amount: total, label: 'Full payment' }];
}
function nextInvoiceNo(data, mk) {
  data.settings.invoiceSeq = (data.settings.invoiceSeq || 0) + 1;
  return `${data.settings.invoicePrefix || 'INV'}/${mk.slice(2, 4)}-${mk.slice(5, 7)}/${String(data.settings.invoiceSeq).padStart(4, '0')}`;
}
function makeInvoice(data, client, { mk, issueDate, subtotal, description = '', manual = false }) {
  const g = gstBreakup(subtotal, client, data.settings);
  const schedule = buildSchedule(g.total, issueDate, mk, client.package.paymentTerms, data.settings);
  return {
    id: uid('inv'), clientId: client.id, invoiceNo: nextInvoiceNo(data, mk), month: mk, issueDate,
    subtotal, gstRate: g.rate, cgst: g.cgst, sgst: g.sgst, igst: g.igst, amountDue: g.total,
    terms: client.package.paymentTerms, schedule, dueDate: schedule[schedule.length - 1].due,
    amountPaid: 0, transactions: [], dispute: null, reminders: {}, description, manual,
    status: 'Pending', createdAt: Date.now(),
  };
}
function billingDateFor(client, mk) {
  const day = Math.min(Number(client.package.billingDay) || 1, daysInMonth(mk));
  let d = mk + '-' + pad(day);
  if (client.package.startDate && d < client.package.startDate) d = client.package.startDate; // never bill before contract start
  return d;
}
function generateInvoices(data, today = todayISO()) {
  const created = [];
  const current = monthOf(today);
  const floor = data.settings.billingStartMonth || current;
  data.clients.forEach((c) => {
    const pk = c.package || {};
    if (c.archived || c.status !== 'Active' || !pk.monthlyFee || !pk.startDate) return;
    let mk = monthOf(pk.startDate) > floor ? monthOf(pk.startDate) : floor;
    for (let g = 0; mk <= current && g < 36; g++, mk = addMonths(mk, 1)) {
      if (pk.endDate && mk > monthOf(pk.endDate)) break;
      const bd = billingDateFor(c, mk);
      if (bd > today || monthOf(bd) !== mk) continue;
      if (data.invoices.some((p) => p.clientId === c.id && p.month === mk && !p.manual)) continue;
      const inv = makeInvoice(data, c, { mk, issueDate: bd, subtotal: Number(pk.monthlyFee) });
      data.invoices.push(inv);
      created.push(inv);
      systemLog(data, 'Invoice generated', `${inv.invoiceNo} for ${c.company} — ${inr(inv.amountDue)} incl. GST (${fmtMonth(mk)})`, { entity: 'payment', entityId: inv.id, clientId: c.id });
    }
  });
  return created;
}
/* The earliest milestone that should have been covered by now but isn't */
function missedMilestone(p, today = todayISO()) {
  let cum = 0;
  for (const m of p.schedule || [{ due: p.dueDate, amount: p.amountDue }]) {
    cum += m.amount;
    if (m.due < today && (Number(p.amountPaid) || 0) < cum) return m;
  }
  return null;
}
function paymentStatus(p, today = todayISO()) {
  const paid = Number(p.amountPaid) || 0, due = Number(p.amountDue) || 0;
  if (paid >= due && due > 0) return 'Paid';
  if (p.dispute && p.dispute.open) return 'In Dispute';
  if (missedMilestone(p, today)) return 'Overdue';
  if (paid > 0) return 'Partially Paid';
  return 'Pending';
}
function refreshPaymentStatuses(data) {
  data.invoices.forEach((p) => {
    const next = paymentStatus(p);
    if (next === 'Overdue' && p.status !== 'Overdue') systemLog(data, 'Payment overdue', `${p.invoiceNo} (${(data.clients.find((c) => c.id === p.clientId) || {}).company}) is now overdue`, { entity: 'payment', entityId: p.id, clientId: p.clientId });
    p.status = next;
  });
}
function balance(p) { return Math.max(0, (Number(p.amountDue) || 0) - (Number(p.amountPaid) || 0)); }
function daysOverdue(p) { const m = p.status === 'Overdue' && missedMilestone(p); return m ? daysBetween(m.due, todayISO()) : 0; }
function lastTxn(p) { return p.transactions && p.transactions.length ? p.transactions[p.transactions.length - 1] : null; }
function nextDue(p) {
  let cum = 0;
  for (const m of p.schedule || []) { cum += m.amount; if ((Number(p.amountPaid) || 0) < cum) return m; }
  return null;
}

/* Reminders due: 3 days before a milestone and on the day after it is missed */
function remindersDue(invoices, today = todayISO()) {
  const out = [];
  invoices.forEach((p) => {
    if (!balance(p) || p.status === 'In Dispute') return;
    const m = nextDue(p);
    if (!m) return;
    const d = daysBetween(today, m.due);
    const r = p.reminders || {};
    if (d >= 0 && d <= 3 && !r['pre_' + m.due]) out.push({ p, kind: 'pre', key: 'pre_' + m.due, milestone: m, label: d === 0 ? 'Due today' : `Due in ${d} day${d > 1 ? 's' : ''}` });
    if (d < 0 && !r['od_' + m.due]) out.push({ p, kind: 'overdue', key: 'od_' + m.due, milestone: m, label: `Overdue ${-d} day${d < -1 ? 's' : ''}` });
  });
  return out;
}

/* WhatsApp + email reminder text (used by the app and by the server's webhook sender) */
function reminderMessage(p, c, s, senderName) {
  const m = nextDue(p) || { due: p.dueDate, label: 'Payment' };
  const late = m.due < todayISO();
  const d = Math.abs(daysBetween(todayISO(), m.due));
  const first = (c.contact || '').replace(/^(Dr\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, '').split(' ')[0] || 'there';
  const when = late ? `was due on ${fmtDate(m.due)} (${d} day${d === 1 ? '' : 's'} ago)` : d === 0 ? 'is due today' : `is due on ${fmtDate(m.due)} (in ${d} day${d === 1 ? '' : 's'})`;
  const payVia = [s.upiId ? `UPI: ${s.upiId}` : '', s.bankDetails || ''].filter(Boolean).join('\n');
  const whatsapp = `Hi ${first} 👋\n\nA friendly reminder from ${s.agencyName}: invoice *${p.invoiceNo}* (${fmtMonth(p.month)}) ${when}.\n\n*Amount due: ${inr(balance(p))}*${p.amountPaid ? ` (${inr(p.amountPaid)} received — thank you!)` : ''}\n\n${payVia ? 'Pay via:\n' + payVia + '\n\n' : ''}Please share the transaction reference once paid. 🙏\n— ${senderName}, ${s.agencyName}`;
  const subject = `${late ? 'Overdue' : 'Payment reminder'}: ${p.invoiceNo} — ${inr(balance(p))}`;
  const email = `Dear ${c.contact || 'Sir/Madam'},\n\nThis is a gentle reminder that invoice ${p.invoiceNo} for ${fmtMonth(p.month)} ${when}.\n\nInvoice total: ${inr(p.amountDue)} (incl. GST)\nReceived: ${inr(p.amountPaid)}\nBalance due: ${inr(balance(p))}\n\n${payVia ? 'Payment details:\n' + payVia + '\n\n' : ''}If you have already paid, please share the transaction reference so we can update our records.\n\nWarm regards,\n${senderName}\n${s.agencyName}\n${s.agencyPhone || ''}`;
  return { whatsapp, email, subject, milestone: m };
}

/* ==========================================================================
   Quotas: committed vs completed vs in review vs remaining, with rollover
   ========================================================================== */
function taskCampaign(t) { return t.campaign || monthOf(t.dueDate); }
function completedIn(clientId, mk, qkey) {
  return Store.tasks.filter((t) => t.clientId === clientId && taskCampaign(t) === mk && taskType(t.type).quota === qkey && DONE_STATUSES.includes(t.status)).length;
}
/* Rollover carries last month's unused quota into this month (one month only, no
   compounding) and only if last month was actually tracked in the app. */
function effectiveQuota(client, mk, qkey) {
  const pk = client.package || {};
  const base = Number((pk.quotas || {})[qkey]) || 0;
  if (!pk.rollover) return base;
  const prev = addMonths(mk, -1);
  if (!pk.startDate || prev < monthOf(pk.startDate)) return base;
  const tracked = Store.tasks.some((t) => t.clientId === client.id && taskCampaign(t) === prev);
  if (!tracked) return base;
  return base + Math.max(0, base - completedIn(client.id, prev, qkey));
}
function quotaStatus(client, mk) {
  const tasks = Store.tasks.filter((t) => t.clientId === client.id && taskCampaign(t) === mk);
  const rows = QUOTA_TYPES.map((q) => {
    const qt = tasks.filter((t) => taskType(t.type).quota === q.key);
    const base = Number(((client.package || {}).quotas || {})[q.key]) || 0;
    const quota = effectiveQuota(client, mk, q.key);
    const completed = qt.filter((t) => DONE_STATUSES.includes(t.status)).length;
    const inReview = qt.filter((t) => REVIEW_STATUSES.includes(t.status)).length;
    return { ...q, base, quota, rolled: quota - base, planned: qt.length, completed, inReview, remaining: Math.max(0, quota - completed) };
  }).filter((r) => r.quota || r.planned);
  const quota = sum(rows, (r) => r.quota), completed = sum(rows, (r) => Math.min(r.completed, r.quota || r.completed));
  const late = tasks.filter((t) => isLate(t)).length;
  return { rows, quota, completed, inReview: sum(rows, (r) => r.inReview), pct: quota ? Math.min(100, Math.round((completed / quota) * 100)) : 0, late, tasks };
}
function expectedPct(mk) {
  const cur = monthKey();
  if (mk < cur) return 100;
  if (mk > cur) return 0;
  return Math.round((new Date().getDate() / daysInMonth(mk)) * 100);
}
/* Burn rate: delivery progress vs how far through the month we are */
function burnRate(client, mk = monthKey()) {
  const q = quotaStatus(client, mk);
  const exp = expectedPct(mk);
  if (!q.quota) return { label: 'No quota', tone: 'muted', q, exp };
  const gap = q.pct - exp;
  return gap >= -10 ? { label: 'On track', tone: 'good', q, exp } : gap >= -30 ? { label: 'Behind', tone: 'warn', q, exp } : { label: 'At risk', tone: 'bad', q, exp };
}

/* Late: past due and not done. At risk: due within 2 days and still early in the pipeline */
function isLate(t, today = todayISO()) { return !DONE_STATUSES.includes(t.status) && t.dueDate && t.dueDate < today; }
function isAtRisk(t, today = todayISO()) {
  if (DONE_STATUSES.includes(t.status) || !t.dueDate || t.dueDate < today) return false;
  return daysBetween(today, t.dueDate) <= 2 && TASK_STATUSES.indexOf(t.status) <= 2;
}
function shootChecklistDone(t) { return SHOOT_CHECKLIST.every((c) => t.shoot && t.shoot.checklist && t.shoot.checklist[c.key]); }
/* Returns an error message if a task can't move to `status` */
function statusBlocker(t, status) {
  if (t.type === 'shoot' && TASK_STATUSES.indexOf(status) >= TASK_STATUSES.indexOf('Design / Editing') && !shootChecklistDone(t)) {
    return 'Complete the equipment checklist before the shoot moves forward.';
  }
  return '';
}

/* Create backlog tasks for the month's quota that aren't planned yet */
function planMonthFor(client, mk) {
  const q = quotaStatus(client, mk);
  const made = [];
  const days = daysInMonth(mk);
  q.rows.forEach((r) => {
    const tt = TASK_TYPES.find((t) => t.quota === r.key && t.key === r.key) || TASK_TYPES.find((t) => t.quota === r.key);
    for (let n = r.planned; n < r.quota; n++) {
      const day = Math.max(1, Math.min(days, Math.round(((n + 1) / (r.quota + 1)) * days)));
      const t = newTask({ clientId: client.id, campaign: mk, title: `${r.short.replace(/s$/, '')} #${n + 1}`, type: tt.key, dueDate: mk + '-' + pad(day), status: 'Backlog' });
      Store.tasks.push(t);
      made.push(t);
    }
  });
  return made;
}
function newTask(fields) {
  return {
    id: uid('tsk'), clientId: '', campaign: '', title: '', type: 'poster', priority: 'Medium', assigneeId: '', reviewerId: '',
    dueDate: todayISO(), publishDate: '', status: 'Backlog', link: '', description: '', revisions: 0,
    maxRevisions: Number((Store.data || {}).settings?.maxRevisions) || 2, billable: false, completedAt: null, completedBy: '',
    shoot: null, createdAt: Date.now(), updatedAt: Date.now(), ...fields,
  };
}
function defaultShoot(client) {
  return { date: '', time: '10:00', locationType: (client && client.package.shootLocation) || 'On-site (client premises)', address: (client && client.address) || '', crewIds: [], checklist: {}, rawLink: '' };
}

/* ==========================================================================
   Attendance & leave
   ========================================================================== */
function isWeekOff(iso, settings = Store.settings) { return (settings.weekOff || [0]).includes(parseISO(iso).getDay()); }
function attendanceFor(userId, iso, data = Store.data) { return data.attendance.find((a) => a.userId === userId && a.date === iso); }
function breakMs(a, now = Date.now()) { return sum(a.breaks || [], (b) => (b.end || now) - b.start); }
function workedMs(a, now = Date.now()) { if (!a || !a.clockIn) return 0; return Math.max(0, (a.clockOut || now) - a.clockIn - breakMs(a, now)); }
function openBreak(a) { return a && (a.breaks || []).find((b) => !b.end); }
function leaveOn(userId, iso, data = Store.data) {
  return data.leaves.find((l) => l.userId === userId && l.status === 'Approved' && l.from <= iso && l.to >= iso);
}
function leaveDays(l, settings = Store.settings) {
  if (l.halfDay) return 0.5;
  return dateRange(l.from, l.to).filter((d) => !isWeekOff(d, settings)).length;
}
function leaveBalance(user, year = new Date().getFullYear()) {
  const used = {};
  LEAVE_TYPES.forEach((t) => (used[t.key] = 0));
  Store.data.leaves.filter((l) => l.userId === user.id && l.status === 'Approved' && l.from.startsWith(String(year))).forEach((l) => { used[l.type] += leaveDays(l); });
  const quota = user.leaveQuota || { casual: 0, sick: 0, pto: 0 };
  return LEAVE_TYPES.filter((t) => t.key !== 'unpaid').map((t) => ({ ...t, quota: quota[t.key] || 0, used: used[t.key], left: (quota[t.key] || 0) - used[t.key] }))
    .concat([{ key: 'unpaid', label: 'Unpaid', quota: 0, used: used.unpaid, left: 0 }]);
}
/* Days before the agency started using clock-in can't count as absences (or loss of pay) */
function attendanceTrackingStart() {
  if (Store.settings.attendanceStartDate) return Store.settings.attendanceStartDate;
  const first = Store.data.attendance.reduce((m, a) => (!m || a.date < m ? a.date : m), '');
  return first || todayISO();
}
/* Day status code for the attendance matrix */
function dayStatus(userId, iso, now = Date.now()) {
  const s = Store.settings;
  const today = todayISO();
  const person = Store.user(userId);
  if (person && person.joinDate && iso < person.joinDate) return { code: '', label: 'Before joining', tone: 'none' };
  if (iso < attendanceTrackingStart()) return { code: '', label: 'Before attendance tracking started', tone: 'none' };
  const a = attendanceFor(userId, iso);
  const lv = leaveOn(userId, iso);
  if (lv && !(a && a.clockIn)) return lv.halfDay ? { code: 'HL', label: 'Half-day leave', tone: 'info' } : { code: 'LV', label: 'On leave', tone: 'info' };
  if (isWeekOff(iso)) return a && a.clockIn ? { code: 'P', label: 'Worked on week-off', tone: 'good' } : { code: 'WO', label: 'Week off', tone: 'muted' };
  if (iso > today) return { code: '', label: '', tone: 'none' };
  if (!a || !a.clockIn) {
    if (iso === today && now < atTime(iso, s.workEnd)) return { code: '·', label: 'Not clocked in yet', tone: 'muted' };
    return { code: 'A', label: 'Absent', tone: 'bad' };
  }
  const late = a.clockIn > atTime(iso, s.workStart) + (Number(s.graceMinutes) || 0) * 60000;
  const hours = workedMs(a, now) / 3600000;
  if (a.clockOut && hours < (Number(s.halfDayHours) || 4.5)) return { code: 'H', label: 'Half day', tone: 'warn', late };
  if (late) return { code: 'L', label: 'Late', tone: 'warn', late };
  return { code: 'P', label: 'Present', tone: 'good', late };
}
/* Live status for "who's in today" */
function liveStatus(userId, now = Date.now()) {
  const iso = todayISO();
  const a = attendanceFor(userId, iso);
  if (leaveOn(userId, iso) && !(a && a.clockIn)) return { key: 'leave', label: 'On leave', tone: 'info' };
  if (!a || !a.clockIn) return isWeekOff(iso) ? { key: 'off', label: 'Week off', tone: 'muted' } : { key: 'absent', label: now < atTime(iso, Store.settings.workEnd) ? 'Not clocked in' : 'Absent', tone: 'muted' };
  if (a.clockOut) return { key: 'done', label: workedMs(a) / 3600000 < (Number(Store.settings.halfDayHours) || 4.5) ? 'Half day' : 'Completed for the day', tone: 'neutral' };
  if (openBreak(a)) return { key: 'break', label: `On break (${openBreak(a).type})`, tone: 'warn' };
  return { key: 'working', label: 'Working', tone: 'good' };
}

/* ---------- Payroll (estimate) ---------- */
function payslip(user, mk) {
  const s = Store.settings;
  const monthly = Math.round((Number(user.ctc) || 0) / 12);
  const freelancer = user.workArrangement === 'Freelancer / Contractor';
  const basic = Math.round(monthly * 0.5), hra = Math.round(monthly * 0.2), special = monthly - basic - hra;
  const days = dateRange(mk + '-01', mk + '-' + pad(daysInMonth(mk)));
  const upto = todayISO();
  const workDays = days.filter((d) => !isWeekOff(d));
  let lop = 0;
  workDays.filter((d) => d <= upto && (!user.joinDate || d >= user.joinDate)).forEach((d) => {
    const lv = leaveOn(user.id, d);
    if (lv) { if (lv.type === 'unpaid') lop += lv.halfDay ? 0.5 : 1; return; }
    const st = dayStatus(user.id, d);
    if (st.code === 'A') lop += 1;
    else if (st.code === 'H') lop += 0.5;
  });
  const perDay = monthly / (workDays.length || 1);
  const lopAmt = Math.round(perDay * lop);
  const pf = freelancer || !s.pfEnabled ? 0 : Math.round(Math.min(basic, 15000) * 0.12);
  const pt = freelancer ? 0 : (monthly > 15000 ? 200 : 0);
  const tds = freelancer ? Math.round((monthly - lopAmt) * 0.1) : 0;
  const deductions = lopAmt + pf + pt + tds;
  return { monthly, basic, hra, special, workDays: workDays.length, lop, lopAmt, pf, pt, tds, deductions, net: monthly - deductions, freelancer };
}

/* ==========================================================================
   Permissions
   ========================================================================== */
const Perm = {
  role() { const u = Store.currentUser(); return u ? u.role : null; },
  is(...roles) { return roles.includes(this.role()); },
  canSeeClients() { return !this.is('client'); },
  canEditClients() { return this.is('admin', 'pm'); },
  canDeleteClients() { return this.is('admin'); },
  canSeeMoney() { return this.is('admin', 'pm', 'finance'); },
  canEditPayments() { return this.is('admin', 'finance'); },
  canSeeTasks() { return this.is('admin', 'pm', 'creative', 'shoot'); },
  canCreateTasks() { return this.is('admin', 'pm'); },
  canManageHR() { return this.is('admin'); },
  canSeeSensitiveHR() { return this.is('admin', 'finance'); },
  canApproveLeave() { return this.is('admin', 'pm'); },
  canSeeAttendance() { return this.is('admin', 'pm', 'finance'); },
  canRunPayroll() { return this.is('admin', 'finance'); },
  canSeeAudit() { return this.is('admin', 'pm'); },
  canEditTask(t) {
    const u = Store.currentUser();
    if (this.is('admin')) return true;
    if (this.is('pm')) return this.visibleClientIds().has(t.clientId);
    return t.assigneeId === u.id || t.reviewerId === u.id || (t.shoot && (t.shoot.crewIds || []).includes(u.id));
  },
  visibleClientIds() {
    const u = Store.currentUser();
    let list = Store.clients;
    if (u.role === 'pm') list = list.filter((c) => c.managerId === u.id);
    if (u.role === 'client') list = list.filter((c) => c.id === u.clientId);
    if (u.role === 'creative' || u.role === 'shoot') {
      const mine = new Set(Store.tasks.filter((t) => t.assigneeId === u.id || t.reviewerId === u.id || (t.shoot && (t.shoot.crewIds || []).includes(u.id))).map((t) => t.clientId));
      list = list.filter((c) => mine.has(c.id));
    }
    return new Set(list.map((c) => c.id));
  },
  visibleClients({ includeArchived = false } = {}) {
    const ids = this.visibleClientIds();
    return Store.clients.filter((c) => ids.has(c.id) && (includeArchived || !c.archived));
  },
  visiblePayments() {
    if (!this.canSeeMoney()) return [];
    const ids = this.visibleClientIds();
    return Store.payments.filter((p) => ids.has(p.clientId));
  },
  visibleTasks() {
    const u = Store.currentUser();
    if (this.is('admin')) return Store.tasks;
    if (this.is('pm')) { const ids = this.visibleClientIds(); return Store.tasks.filter((t) => ids.has(t.clientId)); }
    if (this.is('client')) return Store.tasks.filter((t) => t.clientId === u.clientId);
    if (this.is('creative', 'shoot')) return Store.tasks.filter((t) => t.assigneeId === u.id || t.reviewerId === u.id || (t.shoot && (t.shoot.crewIds || []).includes(u.id)) || (u.role === 'shoot' && t.type === 'shoot'));
    return [];
  },
};
