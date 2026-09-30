/* Who can read and write what. Reads are filtered per role; writes are
   validated, checked for edit conflicts, then allowed record-by-record and
   field-by-field — so a tampered browser can't overreach. */
const shared = require('./shared');
const db = require('./db');

const SENSITIVE_DEFAULTS = { ctc: 0, bank: { holder: '', account: '', ifsc: '' }, idProof: { type: '', number: '', verified: false }, docs: { nda: '', contract: '', idCopy: '' } };
const pick = (obj, fields) => Object.fromEntries(fields.filter((f) => obj && f in obj).map((f) => [f, obj[f]]));
const STAFF = ['admin', 'pm', 'creative', 'shoot', 'finance'];

/* Point the shared Perm helpers at this request's data and user */
function bindPerm(data, user) { data.session = { userId: user.id }; shared.Store.data = data; return shared.Perm; }

function filterForUser(data, user) {
  const Perm = bindPerm(data, user);
  const role = user.role;
  const clientIds = Perm.visibleClientIds();
  const out = { version: data.version, settings: { ...data.settings }, me: { id: user.id, role, twoFactor: !!user.twoFactor } };
  if (role !== 'admin') delete out.settings.webhookUrl;
  if (role === 'client') return portalView(data, user, out);
  out.users = data.users.map((u) => (role === 'admin' || role === 'finance' || u.id === user.id ? u : { ...u, ...SENSITIVE_DEFAULTS }));
  out.clients = data.clients.filter((c) => clientIds.has(c.id));
  if (role === 'creative' || role === 'shoot') out.clients = out.clients.map((c) => ({ ...c, package: { ...c.package, monthlyFee: 0, metaAdBudget: 0, googleAdBudget: 0 }, referrals: c.referrals.map((r) => ({ ...r, credit: 0 })) }));
  out.invoices = Perm.canSeeMoney() ? data.invoices.filter((p) => clientIds.has(p.clientId)) : [];
  out.tasks = role === 'finance' ? data.tasks : Perm.visibleTasks();
  const team = ['admin', 'pm', 'finance'].includes(role);
  out.attendance = team ? data.attendance : data.attendance.filter((a) => a.userId === user.id);
  out.leaves = team ? data.leaves : data.leaves.filter((l) => l.userId === user.id);
  out.eod = ['admin', 'pm'].includes(role) ? data.eod : data.eod.filter((e) => e.userId === user.id);
  out.activity = role === 'admin' ? data.activity : data.activity.filter((a) => a.userId === user.id || (role === 'pm' && a.clientId && clientIds.has(a.clientId)));
  return out;
}

/* A client sees their own account only: no internal notes, sentiment, staff details or other clients */
function portalView(data, user, out) {
  const c = data.clients.find((x) => x.id === user.clientId);
  const s = data.settings;
  out.settings = pick(s, ['agencyName', 'agencyAddress', 'agencyEmail', 'agencyPhone', 'gstin', 'sac', 'gstRate', 'bankDetails', 'upiId', 'invoicePrefix', 'maxRevisions', 'weekOff', 'workStart', 'workEnd']);
  out.clients = c ? [{ ...c, notes: '', sentiment: 'Neutral', referrals: [], package: { ...c.package, metaAdBudget: 0, googleAdBudget: 0 } }] : [];
  const manager = c && data.users.find((u) => u.id === c.managerId);
  const slim = (u) => ({ id: u.id, name: u.name, role: u.role === 'client' ? 'client' : 'pm', email: u.email, phone: u.phone || '', designation: u.designation || '', status: 'Active', clientId: u.clientId || '', leaveQuota: { casual: 0, sick: 0, pto: 0 }, ...SENSITIVE_DEFAULTS });
  out.users = [slim(user), ...(manager ? [slim(manager)] : [])];
  out.tasks = c ? data.tasks.filter((t) => t.clientId === c.id && taskType(t.type).quota !== undefined).map((t) => ({ ...t, timeLogs: [], assigneeId: '', reviewerId: '' })) : [];
  out.invoices = c ? data.invoices.filter((p) => p.clientId === c.id).map((p) => ({ ...p, reminders: {} })) : [];
  out.attendance = []; out.leaves = []; out.eod = [];
  out.activity = data.activity.filter((a) => a.userId === user.id);
  return out;
}
const taskType = (key) => shared.TASK_TYPES.find((t) => t.key === key) || {};

const TASK_WORKER_FIELDS = ['status', 'link', 'description', 'revisions', 'billable', 'completedAt', 'completedBy', 'updatedAt', 'timeLogs', 'clientComments'];

/* Returns the record to store, or null if this user may not make this change */
const rules = {
  users(u, inc, ex, ctx) {
    let out = null;
    if (u.role === 'admin') {
      out = ex && ex.id === u.id ? { ...inc, role: 'admin', status: ex.status } : { ...inc }; // can't demote or deactivate yourself
      if (out.role === 'client' && !ctx.clientExists(out.clientId)) return null;
      if (out.role !== 'client') out.clientId = '';
    } else if (u.role === 'pm' && inc.role === 'client' && (!ex || ex.role === 'client') && ctx.clientIds.has(inc.clientId) && (!ex || ctx.clientIds.has(ex.clientId))) {
      out = { ...(ex || {}), ...pick(inc, ['id', 'name', 'email', 'phone', 'status', 'clientId', 'designation']), role: 'client' }; // PMs manage portal logins for their clients
    } else if (ex && ex.id === u.id) out = { ...ex, ...pick(inc, ['timer']) };
    if (!out) return null;
    db.SERVER_ONLY_USER_FIELDS.forEach((f) => { if (ex && f in ex) out[f] = ex[f]; else delete out[f]; });
    out.emailLower = out.email.toLowerCase();
    return out;
  },
  clients(u, inc, ex, ctx) {
    if (u.role === 'admin') return inc;
    if (u.role === 'pm') {
      if (ex) return ex.managerId === u.id ? { ...inc, managerId: u.id } : null;
      return { ...inc, managerId: u.id };
    }
    if (u.role === 'client' && ex && ex.id === u.clientId) {
      // Clients may only add their own monthly review
      const known = new Set(ex.feedback.map((f) => f.id));
      const added = inc.feedback.filter((f) => !known.has(f.id)).slice(0, 1).map((f) => ({ ...f, by: u.id, date: shared.todayISO() }));
      if (!added.length) return null;
      const feedback = ex.feedback.filter((f) => !(f.by === u.id && f.month === added[0].month)).concat(added);
      ctx.notes.push({ type: 'client-feedback', clientId: ex.id, entry: added[0] });
      return { ...ex, feedback };
    }
    return null;
  },
  invoices(u, inc, ex, ctx) {
    const visible = ctx.clientIds.has((ex || inc).clientId);
    let out = null;
    if (u.role === 'admin' || u.role === 'finance') out = ex ? { ...inc, invoiceNo: ex.invoiceNo } : { ...inc, invoiceNo: ctx.nextInvoiceNo(inc.month) };
    else if (u.role === 'pm' && ex && visible) out = { ...ex, ...pick(inc, ['reminders']) };
    if (!out) return null;
    out.amountPaid = out.transactions.reduce((a, t) => a + t.amount, 0); // paid = sum of recorded payments, never a free number
    if (out.amountPaid > out.amountDue + 1) return null;
    out.status = shared.paymentStatus(out);
    return out;
  },
  tasks(u, inc, ex, ctx) {
    let out = null;
    if (u.role === 'admin') out = inc;
    else if (u.role === 'pm' && ctx.clientIds.has(inc.clientId) && (!ex || ctx.clientIds.has(ex.clientId))) out = inc;
    else if (ex && ['creative', 'shoot'].includes(u.role) && (ex.assigneeId === u.id || ex.reviewerId === u.id || (ex.shoot && (ex.shoot.crewIds || []).includes(u.id)) || (u.role === 'shoot' && ex.type === 'shoot'))) {
      out = { ...ex, ...pick(inc, TASK_WORKER_FIELDS), clientComments: ex.clientComments || [] };
      if (ex.shoot && inc.shoot) out.shoot = { ...ex.shoot, checklist: inc.shoot.checklist, rawLink: inc.shoot.rawLink };
    } else if (u.role === 'client' && ex && ex.clientId === u.clientId) return clientDecision(u, inc, ex, ctx);
    if (out && (!ex || ex.status !== out.status) && shared.statusBlocker(out, out.status)) return null; // e.g. shoot kit checklist incomplete
    if (out && ex) out.clientComments = ex.clientComments || []; // only clients write client comments
    return out;
  },
  attendance(u, inc, ex, ctx) {
    const own = inc.userId === u.id && (!ex || ex.userId === u.id);
    if (u.role === 'client' || (!own && u.role !== 'admin')) return null;
    const out = { ...inc };
    // The server records the clock-in IP; the browser's value is ignored. Admin corrections to others keep the stored IP.
    if (own && (!ex || ex.clockIn !== inc.clockIn)) out.ip = ctx.ip;
    else out.ip = ex ? ex.ip : '';
    return out;
  },
  leaves(u, inc, ex, ctx) {
    if (u.role === 'client') return null;
    if (!ex) {
      if (u.role === 'admin') return inc;
      if (inc.userId !== u.id) return null;
      ctx.notes.push({ type: 'leave-requested', leaveId: inc.id });
      return { ...inc, status: 'Pending', decidedBy: '', decidedAt: null };
    }
    const applicant = ctx.users.get(ex.userId) || {};
    const canApprove = ex.userId !== u.id && (u.role === 'admin' || (u.role === 'pm' && ['creative', 'shoot'].includes(applicant.role)));
    if (canApprove && ex.status === 'Pending' && ['Approved', 'Rejected'].includes(inc.status)) {
      ctx.notes.push({ type: 'leave-decided', leaveId: ex.id });
      return { ...ex, status: inc.status, decidedBy: u.id, decidedAt: Date.now() };
    }
    return u.role === 'admin' ? inc : null;
  },
  eod(u, inc, ex) {
    if (u.role === 'admin') return inc;
    return STAFF.includes(u.role) && !ex && inc.userId === u.id ? inc : null;
  },
};

/* Client approves a deliverable, or asks for changes (which counts as a revision) */
function clientDecision(u, inc, ex, ctx) {
  if (ex.status !== 'Client Approval') return null;
  const known = new Set((ex.clientComments || []).map((c) => c.id));
  const note = (inc.clientComments || []).find((c) => !known.has(c.id));
  let out;
  if (inc.status === 'Ready to Publish') out = { ...ex, status: 'Ready to Publish', completedAt: Date.now(), completedBy: u.id };
  else if (inc.status === 'Design / Editing') {
    if (!note || !note.text) return null; // changes need an explanation
    const revisions = (ex.revisions || 0) + 1;
    out = { ...ex, status: 'Design / Editing', revisions, billable: ex.billable || revisions > ex.maxRevisions };
  } else return null;
  const comment = { id: note ? note.id : shared.uid('cc'), by: u.id, byName: u.name, at: Date.now(), text: note ? note.text : '', action: out.status === 'Ready to Publish' ? 'approved' : 'changes' };
  out.clientComments = [...(ex.clientComments || []), comment];
  out.updatedAt = Date.now();
  ctx.notes.push({ type: 'client-decision', taskId: ex.id, action: comment.action });
  return out;
}

function canDelete(name, u, ex, ctx) {
  if (u.role === 'admin') return !(name === 'users' && ex.id === u.id);
  if (name === 'tasks') return u.role === 'pm' && ctx.clientIds.has(ex.clientId);
  if (name === 'leaves') return ex.userId === u.id && ex.status === 'Pending';
  if (name === 'users') return u.role === 'pm' && ex.role === 'client' && ctx.clientIds.has(ex.clientId);
  return false;
}

module.exports = { filterForUser, bindPerm, rules, canDelete };
