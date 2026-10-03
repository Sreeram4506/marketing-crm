/* Schema validation for everything the browser sends. Every field is coerced to
   the right type and length; unknown fields are dropped; bad enums, links or
   missing required fields reject the whole record. */
const shared = require('./shared');

class ValidationError extends Error {}
const fail = (msg) => { throw new ValidationError(msg); };

const str = (max = 200) => (v) => (v == null ? '' : String(v).trim().slice(0, max));
const req = (fn, label) => (v) => { const out = fn(v); if (out === '' || out == null) fail(`${label} is required`); return out; };
const num = (min = -1e12, max = 1e12) => (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0; };
const int = (min, max) => (v) => Math.round(num(min, max)(v));
const bool = (v) => v === true || v === 'true' || v === 1;
const date = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const month = (v) => (v && /^\d{4}-\d{2}$/.test(v) ? v : '');
const time = (v) => (v && /^\d{2}:\d{2}$/.test(v) ? v : '');
const ts = (v) => (v == null || v === '' ? null : Number.isFinite(+v) && +v > 0 ? +v : null);
const id = (v) => (v == null || v === '' ? '' : /^[\w-]{1,64}$/.test(String(v)) ? String(v) : fail('Bad id'));
const oneOf = (list, { optional = false } = {}) => (v) => {
  if ((v == null || v === '') && optional) return '';
  return list.includes(v) ? v : fail(`“${String(v).slice(0, 40)}” is not an allowed value`);
};
const email = (v) => { const e = str(150)(v).toLowerCase(); return e === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : fail('Invalid email'); };
/* Links: web links, or files uploaded to AgencyDesk ("file:<id>|<name>") */
const link = (v) => {
  const s = str(1000)(v);
  if (!s) return '';
  if (/^https?:\/\/[^\s<>"]+$/i.test(s)) return s;
  if (/^file:[a-f0-9]{24}(\|[^<>"]{0,200})?$/.test(s)) return s;
  return fail('Links must start with http:// or https://');
};
const webhook = (v) => { const s = str(500)(v); return !s || /^https:\/\/[^\s<>"]+$/i.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(s) ? s : fail('Webhook must be an https:// URL'); };
const arr = (fn, max = 500) => (v) => (Array.isArray(v) ? v.slice(0, max).map(fn) : []);
const obj = (shape) => (v) => { const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; const out = {}; for (const k of Object.keys(shape)) out[k] = shape[k](o[k]); return out; };
const nullable = (fn) => (v) => (v == null ? null : fn(v));
const map = (fn, maxKeys = 50) => (v) => {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const out = {};
  Object.keys(o).slice(0, maxKeys).forEach((k) => { if (/^[\w-]{1,60}$/.test(k)) out[k] = fn(o[k]); });
  return out;
};

const ROLE_KEYS = Object.keys(shared.ROLES);
const keys = (list) => list.map((x) => (typeof x === 'string' ? x : x.value || x.key));

const SCHEMAS = {
  users: obj({
    id: req(id, 'id'), name: req(str(100), 'Name'), email: req(email, 'Email'), phone: str(30), role: oneOf(ROLE_KEYS), designation: str(100),
    department: str(50), workArrangement: oneOf(shared.WORK_ARRANGEMENTS), status: oneOf(shared.EMPLOYEE_STATUSES), joinDate: date,
    emergencyContact: obj({ name: str(100), phone: str(30) }), ctc: num(0, 1e9), bank: obj({ holder: str(100), account: str(40), ifsc: str(15) }),
    idProof: obj({ type: str(30), number: str(40), verified: bool }), docs: obj({ nda: link, contract: link, idCopy: link }),
    leaveQuota: obj({ casual: int(0, 365), sick: int(0, 365), pto: int(0, 365) }), timer: nullable(obj({ taskId: id, start: ts })), clientId: id,
  }),
  clients: obj({
    id: req(id, 'id'), company: req(str(150), 'Business name'), contact: str(100), email, phone: str(30), whatsapp: str(20),
    secondaryContact: obj({ name: str(100), phone: str(30), email: str(150) }), whatsappGroup: link, address: str(500), gstin: str(15),
    category: oneOf(shared.CATEGORIES, { optional: true }), status: oneOf(shared.CLIENT_STATUSES), sentiment: oneOf(shared.SENTIMENTS), managerId: id,
    services: arr(str(60), 30), notes: str(5000),
    referredBy: nullable(obj({ type: oneOf(['client', 'partner']), clientId: id, name: str(150) })),
    referrals: arr(obj({ id: req(id, 'id'), name: str(150), date, status: oneOf(['Lead', 'Converted', 'Lost']), credit: num(0, 1e8), creditApplied: bool, notes: str(500) }), 200),
    feedback: arr(obj({ id: req(id, 'id'), month, csat: int(1, 5), nps: int(0, 10), notes: str(1000), by: id, date }), 240),
    onboarding: arr(obj({ done: bool, date }), 5),
    assets: obj({ logo: link, guidelines: link, fonts: str(200) }),
    package: obj({
      name: str(80), monthlyFee: num(0, 1e8), billingCycle: str(10), billingDay: int(1, 31), paymentTerms: oneOf(shared.PAYMENT_TERMS), startDate: date, endDate: date,
      isActive: bool, quotas: map(int(0, 500), 20), shootType: oneOf(keys(shared.SHOOT_TYPES)), shootsPerMonth: int(0, 60),
      shootLocation: oneOf(shared.SHOOT_LOCATIONS), rawFootageLink: link, metaAdBudget: num(0, 1e9), googleAdBudget: num(0, 1e9), rollover: bool,
    }),
    archived: bool, createdAt: ts,
  }),
  invoices: obj({
    id: req(id, 'id'), clientId: req(id, 'Client'), invoiceNo: str(40), month: req(month, 'Month'), issueDate: req(date, 'Issue date'),
    subtotal: num(0, 1e9), gstRate: num(0, 50), cgst: num(0, 1e9), sgst: num(0, 1e9), igst: num(0, 1e9), amountDue: num(0, 1e9), terms: oneOf(shared.PAYMENT_TERMS),
    schedule: arr(obj({ due: date, amount: num(0, 1e9), label: str(40) }), 4), dueDate: date, amountPaid: num(0, 1e9),
    transactions: arr(obj({ id: req(id, 'id'), date: req(date, 'Payment date'), amount: num(0, 1e9), mode: oneOf(shared.PAYMENT_MODES), ref: str(100), receipt: link, note: str(300), by: id }), 100),
    dispute: nullable(obj({ open: bool, reason: str(1000), raisedAt: ts, resolvedAt: ts, by: id })),
    reminders: map(obj({ at: ts, channel: str(30), by: str(64) }), 40), description: str(300), manual: bool, status: str(20), createdAt: ts,
  }),
  tasks: obj({
    id: req(id, 'id'), clientId: req(id, 'Client'), campaign: month, title: req(str(200), 'Title'), type: oneOf(keys(shared.TASK_TYPES)), priority: oneOf(shared.PRIORITIES),
    assigneeId: id, reviewerId: id, dueDate: req(date, 'Due date'), publishDate: date, status: oneOf(shared.TASK_STATUSES), link, description: str(5000),
    revisions: int(0, 100), maxRevisions: int(0, 20), billable: bool, completedAt: ts, completedBy: id,
    shoot: nullable(obj({ date, time, locationType: str(60), address: str(300), crewIds: arr(id, 20), checklist: map(bool, 20), rawLink: link })),
    timeLogs: arr(obj({ userId: id, start: ts, end: ts }), 2000),
    clientComments: arr(obj({ id: req(id, 'id'), by: id, byName: str(100), at: ts, text: str(2000), action: oneOf(['approved', 'changes', 'comment']) }), 200),
    createdAt: ts, updatedAt: ts,
  }),
  attendance: obj({
    id: req(id, 'id'), userId: req(id, 'Employee'), date: req(date, 'Date'), clockIn: ts, clockOut: ts,
    breaks: arr(obj({ type: oneOf(shared.BREAK_TYPES), start: ts, end: ts }), 30), ip: str(64), eodId: id,
  }),
  leaves: obj({
    id: req(id, 'id'), userId: req(id, 'Employee'), type: oneOf(keys(shared.LEAVE_TYPES)), from: req(date, 'From'), to: req(date, 'To'), halfDay: bool,
    reason: str(500), backupId: id, status: oneOf(shared.LEAVE_STATUSES), decidedBy: id, decidedAt: ts, createdAt: ts,
  }),
  eod: obj({
    id: req(id, 'id'), userId: req(id, 'Employee'), date: req(date, 'Date'), completedIds: arr(id, 200), completedSummary: str(3000),
    pending: arr(obj({ taskId: id, reason: str(500), eta: date }), 100), blockers: str(2000), loggedAt: ts,
  }),
};

const SETTINGS = obj({
  agencyName: req(str(100), 'Agency name'), agencyAddress: str(300), agencyEmail: str(150), agencyPhone: str(30), gstin: str(15), sac: str(10), gstRate: num(0, 50),
  bankDetails: str(300), upiId: str(100), invoicePrefix: str(10), dueDays: int(0, 90), billingStartMonth: month, maxRevisions: int(0, 20),
  workStart: time, workEnd: time, graceMinutes: int(0, 180), halfDayHours: num(1, 12), weekOff: arr(int(0, 6), 7), pfEnabled: bool, captureIp: bool,
  webhookUrl: webhook, autoWebhook: bool, overloadThreshold: int(1, 100), attendanceStartDate: date, emailReminders: bool, notifyLeave: bool,
  require2fa: arr(oneOf(ROLE_KEYS), 6), aiDisabled: bool,
});

function clean(name, doc) {
  try {
    const out = (name === 'settings' ? SETTINGS : SCHEMAS[name])(doc);
    if (name !== 'settings') out._rev = Number.isInteger(doc._rev) ? doc._rev : 0;
    return { ok: true, doc: out };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }
}

module.exports = { clean, link, email };
