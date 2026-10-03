/* AI assistant tools. Every tool runs as the signed-in user:
   - reads use the same role-filtered view the user's browser gets;
   - writes go through applySync (validation, permissions, conflict checks,
     audit trail) exactly like a click in the app would.
   Tools in NEEDS_CONFIRMATION only run after the user says "yes" in a later turn. */
const db = require('../db');
const shared = require('../shared');
const { filterForUser } = require('../policy');
const { applySync } = require('../sync');
const insights = require('./insights');
const memory = require('./memory');
const cfg = require('../config');
const notify = require('../notify');

const S = shared;
const NEEDS_CONFIRMATION = new Set(['record_payment', 'create_client', 'decide_leave', 'plan_month', 'add_team_member', 'update_team_member']);
const STAFF = ['admin', 'pm', 'creative', 'shoot', 'finance'];

/* ---------- Tool definitions (sent to the model; keep order stable for prompt caching) ---------- */
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description) => ({ type: 'number', description });
const DEFINITIONS = [
  { name: 'get_overview', description: 'Business snapshot for this month as the current user is allowed to see it: revenue and collections, overdue invoices, deliverable progress, clients needing attention, who is in today, pending leave requests, and the user\'s own tasks. Use for "how are we doing", "what needs my attention", morning briefings.',
    input_schema: { type: 'object', properties: { month: str('YYYY-MM; defaults to the current month') } } },
  { name: 'search', description: 'Find clients, tasks, invoices or team members by name, title, invoice number or keyword. Use it to resolve names before acting when unsure.',
    input_schema: { type: 'object', properties: { query: str('Words to look for') }, required: ['query'] } },
  { name: 'get_client', description: 'Full picture of one client: contacts, package and fee, this month\'s deliverables (quota vs done vs in review), outstanding invoices, sentiment, latest feedback, onboarding progress, upcoming tasks.',
    input_schema: { type: 'object', properties: { client: str('Client name or id') }, required: ['client'] } },
  { name: 'list_tasks', description: 'List tasks with filters. Stages: Backlog, Scripting / Brief, Design / Editing, Internal Review, Client Approval, Ready to Publish, Published.',
    input_schema: { type: 'object', properties: {
      client: str('Client name or id'), assignee: str('Person name, or "me"'), status: str('Exact stage name'),
      due_before: str('YYYY-MM-DD'), late_only: { type: 'boolean' }, open_only: { type: 'boolean', description: 'Exclude Ready to Publish / Published' }, limit: num('Max results, default 15'),
    } } },
  { name: 'list_invoices', description: 'List invoices (amounts include GST). Statuses: Pending, Partially Paid, Paid, Overdue, In Dispute.',
    input_schema: { type: 'object', properties: { client: str('Client name or id'), status: str('Status'), unpaid_only: { type: 'boolean' }, limit: num('Max results, default 15') } } },
  { name: 'get_team', description: 'Who is working, on break, on leave or absent today; workload (open and late tasks per person); pending leave requests the user can approve.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'get_my_day', description: 'The current user\'s day: clock-in status and hours, breaks, their tasks due soon or late, leave balance.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'create_task', description: 'Create a production task for a client. Types: poster, carousel, reel, story, video, blog, ad, newsletter, script, adcopy, shoot, shootprep, other.',
    input_schema: { type: 'object', properties: {
      client: str('Client name or id'), title: str('Short task title'), type: str('Deliverable type key'), assignee: str('Person name (optional)'),
      due_date: str('YYYY-MM-DD'), priority: str('Urgent, High, Medium or Low'), description: str('Brief / notes'), status: str('Starting stage, default Backlog'),
    }, required: ['client', 'title', 'type', 'due_date'] } },
  { name: 'update_task', description: 'Change a task: move its stage, reassign, change due date or priority, attach a link, or add a note to its brief.',
    input_schema: { type: 'object', properties: {
      task: str('Task title or id (include the client name if titles repeat)'), client: str('Client name, to disambiguate'), status: str('New stage'),
      assignee: str('Person name'), due_date: str('YYYY-MM-DD'), priority: str('Urgent, High, Medium or Low'), link: str('https:// link to the asset'), note: str('Text to append to the brief'),
    }, required: ['task'] } },
  { name: 'record_payment', description: 'Record money received against an invoice. Requires the user\'s confirmation before it is saved.',
    input_schema: { type: 'object', properties: {
      invoice: str('Invoice number, or the client name to use their oldest unpaid invoice'), amount: num('Amount in rupees; omit to settle the full balance'),
      mode: str('UPI, Bank Transfer, Razorpay, Stripe, Card, Cheque or Cash'), reference: str('Transaction ID / UTR / cheque number'), date: str('YYYY-MM-DD, default today'),
    }, required: ['invoice', 'mode'] } },
  { name: 'create_client', description: 'Add a new client. Requires confirmation. Status Lead / Onboarding / Active. Quotas are monthly deliverable counts.',
    input_schema: { type: 'object', properties: {
      company: str('Business name'), contact: str('Contact person'), email: str('Email'), phone: str('Phone'), category: str('Health & Wellness, Education & EdTech, Real Estate, E-Commerce, Hospitality, Professional Services or Custom'),
      monthly_fee: num('Monthly retainer before GST, rupees'), status: str('Lead, Onboarding or Active'), billing_day: num('Day of month to invoice, default 1'),
      payment_terms: str('100% Advance, 50-50 Milestone, Net 15 or Net 30'), posters: num('Posters per month'), reels: num('Reels per month'), stories: num('Stories per month'), blogs: num('Blogs per month'), shoots: num('Shoots per month'),
    }, required: ['company', 'contact'] } },
  { name: 'update_client', description: 'Update a client: append to notes, change sentiment (Delighted, Neutral, At-Risk, Critical) or status (Lead, Onboarding, Active, On Hold, Churned).',
    input_schema: { type: 'object', properties: { client: str('Client name or id'), note: str('Text to append to notes'), sentiment: str('Sentiment'), status: str('Status') }, required: ['client'] } },
  { name: 'log_feedback', description: 'Log a client\'s monthly review: CSAT 1-5 and NPS 0-10.',
    input_schema: { type: 'object', properties: { client: str('Client name or id'), month: str('YYYY-MM, default last month'), csat: num('1-5'), nps: num('0-10'), notes: str('What they said') }, required: ['client', 'csat', 'nps'] } },
  { name: 'request_leave', description: 'Request leave for the current user. Types: casual, sick, pto, unpaid.',
    input_schema: { type: 'object', properties: { type: str('casual, sick, pto or unpaid'), from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD, same as from for one day'), half_day: { type: 'boolean' }, reason: str('Reason') }, required: ['type', 'from', 'reason'] } },
  { name: 'decide_leave', description: 'Approve or reject a pending leave request. Requires confirmation.',
    input_schema: { type: 'object', properties: { person: str('Name of the person who asked for leave'), decision: str('approve or reject') }, required: ['person', 'decision'] } },
  { name: 'attendance', description: 'Clock in, start or end a break, or clock out for the current user. Clocking out needs an end-of-day summary of what they did (ask for it if they haven\'t said).',
    input_schema: { type: 'object', properties: { action: str('clock_in, start_break, end_break or clock_out'), break_type: str('Lunch or Short break'), eod_summary: str('What was done today (for clock_out)'), blockers: str('Anything blocking them') }, required: ['action'] } },
  { name: 'draft_reminder', description: 'Write a ready-to-send WhatsApp and email payment reminder for an invoice (does not send it).',
    input_schema: { type: 'object', properties: { invoice: str('Invoice number or client name') }, required: ['invoice'] } },
  { name: 'plan_month', description: 'Create backlog tasks for a client\'s monthly quota that are not planned yet. Requires confirmation.',
    input_schema: { type: 'object', properties: { client: str('Client name or id'), month: str('YYYY-MM, default this month') }, required: ['client'] } },
  { name: 'open_page', description: 'Navigate the user\'s screen. Pages: dashboard, workspace (My Day), clients, client (needs client), tasks, shoots, payments, overdue, reminders, team, attendance, leave, payroll, reports, activity, settings.',
    input_schema: { type: 'object', properties: { page: str('Page name'), client: str('Client name or id, for page "client"'), tab: str('For a client: overview, quota, shoots, billing, feedback, referrals') }, required: ['page'] } },
  { name: 'business_review', description: 'Founder-level analysis of the agency: monthly recurring revenue and 6-month billing trend, collection rate, overdue money by client, revenue concentration, each client\'s health score with reasons, share of production effort vs share of revenue, estimated team cost and margin per client (admins), payroll vs revenue (admins), team load and spare capacity, pipeline (leads, onboarding, referrals, renewals in the next 60 days), and ranked risks/opportunities. Use for strategy questions: how the business is doing, what to focus on, pricing, profitability, churn risk, hiring, growth, whether we can take on a client, progress on goals.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'remember', description: 'Save something to long-term memory so you know it in future conversations. kind "goal" = an agency goal or target (admins only), "note" = a lasting fact about the agency, its clients or its strategy (admins and managers), "personal" = a preference or fact about the current user. Only save things the user wants kept or that clearly matter later; never passwords or bank details.',
    input_schema: { type: 'object', properties: { text: str('One clear sentence, with dates and numbers spelled out (e.g. "Reach 10 lakh monthly revenue by March 2027")'), kind: str('goal, note or personal') }, required: ['text', 'kind'] } },
  { name: 'forget', description: 'Remove an item from long-term memory, by its id (shown in brackets in your memory).',
    input_schema: { type: 'object', properties: { id: str('Memory id, e.g. mem_abc123') }, required: ['id'] } },
  { name: 'add_team_member', description: 'Add a new employee (admins only). Requires confirmation. Email is required for their login — ask for it if not given; never invent one. Salary: give monthly_salary (gross per month) or annual_ctc. Roles: admin, pm (project manager), creative (designer/editor/writer/ads), shoot (shoot crew), finance. Once they have a salary they appear on the Payroll screen from their joining month.',
    input_schema: { type: 'object', properties: {
      name: str('Full name'), email: str('Work email'), role: str('admin, pm, creative, shoot or finance'), designation: str('Job title, e.g. Graphic Designer'),
      department: str('Management, Accounts, Design, Video, Copy, Ads, Shoot or HR & Ops'), monthly_salary: num('Gross monthly salary in rupees'), annual_ctc: num('Annual CTC in rupees (alternative to monthly_salary)'),
      join_date: str('YYYY-MM-DD, default today'), work_arrangement: str('Full-Time In-Office, Hybrid, Fully Remote or Freelancer / Contractor'), phone: str('Phone'),
      send_invite: { type: 'boolean', description: 'Email them a link to set their password (only works if email is set up on the server)' },
    }, required: ['name', 'email'] } },
  { name: 'update_team_member', description: 'Change an employee\'s salary, role, title, department, joining date, work arrangement, phone or status (Active, On Leave, Inactive). Admins only. Requires confirmation.',
    input_schema: { type: 'object', properties: {
      person: str('Name of the employee'), monthly_salary: num('New gross monthly salary in rupees'), annual_ctc: num('New annual CTC in rupees'), role: str('admin, pm, creative, shoot or finance'),
      designation: str('Job title'), department: str('Department'), join_date: str('YYYY-MM-DD'), work_arrangement: str('Work arrangement'), phone: str('Phone'), status: str('Employee status'),
    }, required: ['person'] } },
  { name: 'get_payroll', description: 'Payroll for a month (admins and finance): each person\'s gross, loss-of-pay days, deductions (PF, professional tax, TDS) and net pay, plus totals. Salaries come from each person\'s CTC; the Payroll screen shows the same figures.',
    input_schema: { type: 'object', properties: { month: str('YYYY-MM; default last month'), person: str('Only this person') } } },
  { name: 'confirm_action', description: 'Carry out an action that was waiting for confirmation, after the user has clearly said yes in their latest message.',
    input_schema: { type: 'object', properties: { confirmation_id: str('The id returned when the action was proposed') }, required: ['confirmation_id'] } },
];

/* ---------- Helpers ---------- */
class ToolError extends Error {}
const fail = (m) => { throw new ToolError(m); };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const today = () => S.todayISO();
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const rupees = (n) => S.inr(n);

async function viewFor(user) {
  const data = await db.loadAll({ activityLimit: 30 });
  const view = filterForUser(data, user);
  delete view.me;
  view.session = { userId: user.id };
  return view;
}
/* Shared business rules (quota maths, attendance status…) read from Store.data; point it at this user's view */
function bind(view) { S.Store.data = view; return view; }

function pickOne(kind, list, ref, label) {
  const r = norm(ref);
  if (!r) fail(`Which ${kind}?`);
  const exact = list.filter((x) => x.id === ref || norm(label(x)) === r);
  if (exact.length === 1) return exact[0];
  const words = r.split(' ');
  const hits = list.filter((x) => { const l = norm(label(x)); return words.every((w) => l.includes(w)); });
  if (hits.length === 1) return hits[0];
  if (!hits.length) fail(`No ${kind} matching "${ref}" that you can access.`);
  fail(`"${ref}" matches several ${kind}s: ${hits.slice(0, 6).map(label).join('; ')}. Ask which one.`);
}
const findClient = (v, ref) => pickOne('client', v.clients.filter((c) => !c.archived), ref, (c) => c.company);
const findUser = (v, ref, me) => (norm(ref) === 'me' ? me : pickOne('person', v.users.filter((u) => u.role !== 'client' && u.status !== 'Inactive'), ref, (u) => u.name));
function findTask(v, ref, clientRef) {
  let list = v.tasks;
  if (clientRef) { const c = findClient(v, clientRef); list = list.filter((t) => t.clientId === c.id); }
  const clientName = (t) => (v.clients.find((c) => c.id === t.clientId) || {}).company || '';
  try { return pickOne('task', list, ref, (t) => t.title); }
  catch (e) {
    // Prefer open tasks when a title repeats across months
    const open = list.filter((t) => norm(t.title).includes(norm(ref)) && !S.DONE_STATUSES.includes(t.status));
    if (open.length === 1) return open[0];
    if (open.length > 1) fail(`Several open tasks match "${ref}": ${open.slice(0, 6).map((t) => `${t.title} (${clientName(t)}, due ${t.dueDate})`).join('; ')}. Ask which one.`);
    throw e;
  }
}
function findInvoice(v, ref) {
  const byNo = v.invoices.filter((p) => norm(p.invoiceNo) === norm(ref));
  if (byNo.length === 1) return byNo[0];
  const c = findClient(v, ref);
  const unpaid = v.invoices.filter((p) => p.clientId === c.id && S.balance(p) > 0).sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  if (!unpaid.length) fail(`${c.company} has no unpaid invoices.`);
  return unpaid[0];
}
const clientName = (v, id) => (v.clients.find((c) => c.id === id) || {}).company || 'unknown client';
const userName = (v, id) => (v.users.find((u) => u.id === id) || {}).name || 'unassigned';
const taskLine = (v, t) => ({ id: t.id, title: t.title, client: clientName(v, t.clientId), type: S.taskType(t.type).label, stage: t.status, due: t.dueDate, assignee: userName(v, t.assigneeId), priority: t.priority, late: S.isLate(t) || undefined });
const invoiceLine = (v, p) => ({ invoice: p.invoiceNo, client: clientName(v, p.clientId), month: p.month, total: p.amountDue, paid: p.amountPaid, balance: S.balance(p), status: p.status, due: (S.nextDue(p) || {}).due || p.dueDate, days_overdue: S.daysOverdue(p) || undefined });

async function commit(ctx, changes, activity) {
  const r = await applySync(ctx.user, { changes, activity: activity.map((a) => ({ ...a, details: `${a.details} (via AI assistant)` })) }, ctx.ip);
  if (r.conflicts.length) fail('Someone changed that record a moment ago. Fetch it again and retry.');
  if (r.invalid.length) fail(`Not saved: ${r.invalid[0].error}`);
  if (r.rejected) fail('Your role is not allowed to make that change.');
  ctx.changed = true;
  return r;
}
const needRole = (ctx, roles, what) => { if (!roles.includes(ctx.user.role)) fail(`Your role (${S.ROLES[ctx.user.role].label}) can't ${what}.`); };

const memberRole = (r) => { const n = norm(r); return !n ? null : ['admin', 'pm', 'creative', 'shoot', 'finance'].find((k) => k === n || norm(S.ROLES[k].label).includes(n)) || ({ designer: 'creative', editor: 'creative', writer: 'creative', 'project manager': 'pm', manager: 'pm', accounts: 'finance', accountant: 'finance', camera: 'shoot', cinematographer: 'shoot', photographer: 'shoot' })[n] || null; };
const deptFor = (role) => ({ admin: 'Management', pm: 'Management', creative: 'Design', shoot: 'Shoot', finance: 'Accounts' })[role];
const pickWork = (w) => S.WORK_ARRANGEMENTS.find((x) => norm(x) === norm(w)) || S.WORK_ARRANGEMENTS.find((x) => norm(w) && norm(x).includes(norm(w).split(' ')[0])) || S.WORK_ARRANGEMENTS[0];
function salaryToCtc(input) {
  const m = Number(input.monthly_salary), y = Number(input.annual_ctc);
  if (input.monthly_salary != null && !(m > 0)) fail('Monthly salary must be more than zero.');
  if (input.annual_ctc != null && !(y > 0)) fail('Annual CTC must be more than zero.');
  return m > 0 ? Math.round(m * 12) : y > 0 ? Math.round(y) : 0;
}

/* ---------- Implementations ---------- */
const IMPL = {
  async get_overview(input, ctx) {
    const v = bind(await viewFor(ctx.user));
    const u = ctx.user, mk = input.month && /^\d{4}-\d{2}$/.test(input.month) ? input.month : S.monthKey();
    const out = { month: mk, role: S.ROLES[u.role].label };
    if (['admin', 'pm', 'finance'].includes(u.role)) {
      const inv = v.invoices.filter((p) => p.month === mk);
      const overdue = v.invoices.filter((p) => p.status === 'Overdue');
      out.money = { invoiced: inv.reduce((a, p) => a + p.amountDue, 0), collected: inv.reduce((a, p) => a + p.amountPaid, 0), total_outstanding: v.invoices.reduce((a, p) => a + S.balance(p), 0),
        overdue: overdue.sort((a, b) => S.daysOverdue(b) - S.daysOverdue(a)).slice(0, 6).map((p) => invoiceLine(v, p)), in_dispute: v.invoices.filter((p) => p.status === 'In Dispute').length };
    }
    if (u.role !== 'finance') {
      const active = v.clients.filter((c) => c.status === 'Active' && !c.archived);
      out.clients = { active: active.length, onboarding: v.clients.filter((c) => c.status === 'Onboarding').length, leads: v.clients.filter((c) => c.status === 'Lead').length };
      out.deliverables = active.map((c) => { const b = S.burnRate(c, mk); return { client: c.company, done: b.q.completed, quota: b.q.quota, pct: b.q.pct, expected_by_now: b.exp, health: b.label, late_tasks: b.q.late || undefined }; }).filter((x) => x.quota);
      out.attention = v.clients.filter((c) => ['At-Risk', 'Critical'].includes(c.sentiment) && c.status !== 'Churned').map((c) => `${c.company}: sentiment ${c.sentiment}`);
    }
    if (['admin', 'pm', 'finance'].includes(u.role)) {
      const people = v.users.filter((x) => x.role !== 'client' && x.status !== 'Inactive');
      out.team_today = people.map((p) => `${p.name}: ${S.liveStatus(p.id).label}`);
      out.pending_leave = v.leaves.filter((l) => l.status === 'Pending' && l.userId !== u.id).length;
    }
    out.my_open_tasks = v.tasks.filter((t) => t.assigneeId === u.id && !S.DONE_STATUSES.includes(t.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8).map((t) => taskLine(v, t));
    return out;
  },

  async search({ query }, ctx) {
    const v = bind(await viewFor(ctx.user));
    const words = norm(query).split(' ').filter(Boolean);
    if (!words.length) fail('Search for what?');
    const m = (s) => { const l = norm(s); return words.every((w) => l.includes(w)); };
    return {
      clients: v.clients.filter((c) => m(`${c.company} ${c.contact} ${c.category} ${c.email}`)).slice(0, 8).map((c) => ({ id: c.id, name: c.company, status: c.status, contact: c.contact })),
      tasks: v.tasks.filter((t) => m(`${t.title} ${clientName(v, t.clientId)}`)).slice(0, 10).map((t) => taskLine(v, t)),
      invoices: v.invoices.filter((p) => m(`${p.invoiceNo} ${clientName(v, p.clientId)}`)).slice(0, 8).map((p) => invoiceLine(v, p)),
      people: v.users.filter((x) => x.role !== 'client' && m(`${x.name} ${x.designation} ${x.email}`)).slice(0, 8).map((x) => ({ name: x.name, role: S.ROLES[x.role].label, designation: x.designation })),
    };
  },

  async get_client({ client }, ctx) {
    const v = bind(await viewFor(ctx.user));
    const c = findClient(v, client);
    const mk = S.monthKey(), q = S.quotaStatus(c, mk);
    const money = ['admin', 'pm', 'finance'].includes(ctx.user.role);
    const fb = (c.feedback || []).slice().sort((a, b) => b.month.localeCompare(a.month))[0];
    return {
      id: c.id, company: c.company, status: c.status, category: c.category, contact: c.contact, phone: c.phone, email: c.email, manager: userName(v, c.managerId),
      sentiment: c.sentiment, notes: c.notes || undefined,
      package: money ? { name: c.package.name, monthly_fee_before_gst: c.package.monthlyFee, terms: c.package.paymentTerms, billing_day: c.package.billingDay, contract_end: c.package.endDate || undefined } : undefined,
      this_month: { done: q.completed, quota: q.quota, in_review: q.inReview, pct: q.pct, late: q.late, by_type: q.rows.map((r) => `${r.short}: ${r.completed}/${r.quota}${r.inReview ? `, ${r.inReview} in review` : ''}`) },
      onboarding: c.status === 'Onboarding' ? `${c.onboarding.filter((s) => s.done).length}/5 steps; next: ${S.ONBOARDING_STEPS[c.onboarding.findIndex((s) => !s.done)] || 'done'}` : undefined,
      unpaid_invoices: money ? v.invoices.filter((p) => p.clientId === c.id && S.balance(p) > 0).map((p) => invoiceLine(v, p)) : undefined,
      latest_feedback: fb ? `${fb.month}: CSAT ${fb.csat}/5, NPS ${fb.nps}${fb.notes ? ` — "${fb.notes}"` : ''}` : undefined,
      upcoming_tasks: v.tasks.filter((t) => t.clientId === c.id && !S.DONE_STATUSES.includes(t.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8).map((t) => taskLine(v, t)),
    };
  },

  async list_tasks(input, ctx) {
    const v = bind(await viewFor(ctx.user));
    let list = v.tasks;
    if (input.client) { const c = findClient(v, input.client); list = list.filter((t) => t.clientId === c.id); }
    if (input.assignee) { const p = findUser(v, input.assignee, ctx.user); list = list.filter((t) => t.assigneeId === p.id); }
    if (input.status) list = list.filter((t) => norm(t.status) === norm(input.status));
    if (isDate(input.due_before)) list = list.filter((t) => t.dueDate <= input.due_before);
    if (input.late_only) list = list.filter((t) => S.isLate(t));
    if (input.open_only) list = list.filter((t) => !S.DONE_STATUSES.includes(t.status));
    const limit = Math.min(40, Number(input.limit) || 15);
    return { total: list.length, tasks: list.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, limit).map((t) => taskLine(v, t)) };
  },

  async list_invoices(input, ctx) {
    needRole(ctx, ['admin', 'pm', 'finance'], 'see invoices');
    const v = bind(await viewFor(ctx.user));
    let list = v.invoices;
    if (input.client) { const c = findClient(v, input.client); list = list.filter((p) => p.clientId === c.id); }
    if (input.status) list = list.filter((p) => norm(p.status) === norm(input.status));
    if (input.unpaid_only) list = list.filter((p) => S.balance(p) > 0);
    const limit = Math.min(40, Number(input.limit) || 15);
    return { total: list.length, total_balance: list.reduce((a, p) => a + S.balance(p), 0), invoices: list.sort((a, b) => b.issueDate.localeCompare(a.issueDate)).slice(0, limit).map((p) => invoiceLine(v, p)) };
  },

  async get_team(input, ctx) {
    needRole(ctx, ['admin', 'pm', 'finance'], 'see team status');
    const v = bind(await viewFor(ctx.user));
    const people = v.users.filter((u) => u.role !== 'client' && u.status !== 'Inactive');
    return {
      today: people.map((p) => ({ name: p.name, designation: p.designation, status: S.liveStatus(p.id).label })),
      workload: people.filter((p) => ['creative', 'shoot'].includes(p.role)).map((p) => { const open = v.tasks.filter((t) => t.assigneeId === p.id && !S.DONE_STATUSES.includes(t.status)); return { name: p.name, open_tasks: open.length, late: open.filter((t) => S.isLate(t)).length }; }),
      pending_leave: v.leaves.filter((l) => l.status === 'Pending' && l.userId !== ctx.user.id).map((l) => ({ person: userName(v, l.userId), type: l.type, from: l.from, to: l.to, days: S.leaveDays(l, v.settings), reason: l.reason })),
    };
  },

  async get_my_day(input, ctx) {
    needRole(ctx, STAFF, 'use My Day');
    const v = bind(await viewFor(ctx.user));
    const a = S.attendanceFor(ctx.user.id, today(), v);
    const mine = v.tasks.filter((t) => t.assigneeId === ctx.user.id && !S.DONE_STATUSES.includes(t.status)).sort((x, y) => x.dueDate.localeCompare(y.dueDate));
    return {
      status: S.liveStatus(ctx.user.id).label, clocked_in_at: a && a.clockIn ? new Date(a.clockIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : undefined,
      hours_worked: a ? +(S.workedMs(a) / 3600000).toFixed(2) : 0, on_break: !!(a && S.openBreak(a)),
      due_today_or_late: mine.filter((t) => t.dueDate <= today()).map((t) => taskLine(v, t)), next_up: mine.filter((t) => t.dueDate > today()).slice(0, 5).map((t) => taskLine(v, t)),
      leave_left: S.leaveBalance(ctx.user).filter((b) => b.key !== 'unpaid').map((b) => `${b.label}: ${b.left}`),
    };
  },

  async create_task(input, ctx) {
    needRole(ctx, ['admin', 'pm'], 'create tasks');
    const v = bind(await viewFor(ctx.user));
    const c = findClient(v, input.client);
    const type = S.TASK_TYPES.find((t) => t.key === norm(input.type).replace(/ /g, '') || norm(t.label) === norm(input.type));
    if (!type) fail(`Unknown task type "${input.type}".`);
    if (!isDate(input.due_date)) fail('Due date must be YYYY-MM-DD.');
    const assignee = input.assignee ? findUser(v, input.assignee, ctx.user) : null;
    const t = S.newTask({ clientId: c.id, campaign: input.due_date.slice(0, 7), title: String(input.title).slice(0, 200), type: type.key, dueDate: input.due_date,
      priority: S.PRIORITIES.includes(input.priority) ? input.priority : 'Medium', assigneeId: assignee ? assignee.id : '', reviewerId: c.managerId || '',
      description: input.description || '', status: S.TASK_STATUSES.includes(input.status) ? input.status : 'Backlog' });
    if (type.key === 'shoot') t.shoot = { date: input.due_date, time: '10:00', locationType: c.package.shootLocation, address: c.address || '', crewIds: assignee ? [assignee.id] : [], checklist: {}, rawLink: '' };
    await commit(ctx, { tasks: { upsert: [t] } }, [{ action: 'Task created', details: `${t.title} (${type.label}) for ${c.company}${assignee ? ` — ${assignee.name}` : ''}, due ${t.dueDate}`, entity: 'task', entityId: t.id, clientId: c.id }]);
    return { created: taskLine(v, t) };
  },

  async update_task(input, ctx) {
    const v = bind(await viewFor(ctx.user));
    const t = findTask(v, input.task, input.client);
    if (!['admin', 'pm'].includes(ctx.user.role) && (input.assignee || input.due_date || input.priority)) {
      fail('Your role can change a task’s stage, link and notes, but not who it’s assigned to, its due date or priority — ask your manager.');
    }
    const next = { ...t, updatedAt: Date.now() }, changes = [];
    if (input.status) {
      const st = S.TASK_STATUSES.find((s) => norm(s) === norm(input.status) || norm(s).startsWith(norm(input.status)));
      if (!st) fail(`Unknown stage "${input.status}". Stages: ${S.TASK_STATUSES.join(', ')}.`);
      const block = S.statusBlocker(next, st);
      if (block) fail(block);
      if (S.DONE_STATUSES.includes(st) && !S.DONE_STATUSES.includes(t.status)) { next.completedAt = Date.now(); next.completedBy = ctx.user.id; }
      if (!S.DONE_STATUSES.includes(st)) { next.completedAt = null; next.completedBy = ''; }
      next.status = st; changes.push(`${t.status} → ${st}`);
    }
    if (input.assignee) { const p = findUser(v, input.assignee, ctx.user); next.assigneeId = p.id; changes.push(`assigned to ${p.name}`); }
    if (input.due_date) { if (!isDate(input.due_date)) fail('Due date must be YYYY-MM-DD.'); next.dueDate = input.due_date; changes.push(`due ${input.due_date}`); }
    if (input.priority) { if (!S.PRIORITIES.includes(input.priority)) fail('Priority must be Urgent, High, Medium or Low.'); next.priority = input.priority; changes.push(`priority ${input.priority}`); }
    if (input.link) { next.link = input.link; changes.push('asset link set'); }
    if (input.note) { next.description = [t.description, input.note].filter(Boolean).join('\n'); changes.push('note added'); }
    if (!changes.length) fail('Nothing to change was given.');
    await commit(ctx, { tasks: { upsert: [next] } }, [{ action: input.status ? 'Task status changed' : 'Task updated', details: `${t.title} (${clientName(v, t.clientId)}) — ${changes.join(', ')}`, entity: 'task', entityId: t.id, clientId: t.clientId }]);
    const saved = (await viewFor(ctx.user)).tasks.find((x) => x.id === t.id);
    const dropped = ['status', 'assigneeId', 'dueDate', 'priority', 'link', 'description'].filter((k) => next[k] !== t[k] && saved && saved[k] !== next[k]);
    if (dropped.length) fail(`Saved, but your role isn't allowed to change: ${dropped.join(', ')}.`);
    return { updated: taskLine(v, next), changes };
  },

  async record_payment(input, ctx) {
    needRole(ctx, ['admin', 'finance'], 'record payments');
    const v = bind(await viewFor(ctx.user));
    const p = findInvoice(v, input.invoice);
    const bal = S.balance(p);
    const amount = input.amount == null ? bal : Math.round(Number(input.amount));
    if (!(amount > 0)) fail('Amount must be more than zero.');
    if (amount > bal) fail(`That is more than the balance of ${rupees(bal)} on ${p.invoiceNo}.`);
    const mode = S.PAYMENT_MODES.find((m) => norm(m) === norm(input.mode) || (norm(input.mode) === 'neft' && m === 'Bank Transfer') || (norm(input.mode) === 'imps' && m === 'Bank Transfer'));
    if (!mode) fail(`Payment mode must be one of ${S.PAYMENT_MODES.join(', ')}.`);
    const date = isDate(input.date) ? input.date : today();
    return {
      summary: `Record ${rupees(amount)} from ${clientName(v, p.clientId)} by ${mode}${input.reference ? ` (ref ${input.reference})` : ''} against ${p.invoiceNo}${amount < bal ? ` — leaves ${rupees(bal - amount)} due` : ' — settles it in full'}`,
      run: async () => {
        const next = { ...p, transactions: [...p.transactions, { id: S.uid('txn'), date, amount, mode, ref: input.reference || '', receipt: '', note: 'Recorded via AI assistant', by: ctx.user.id }] };
        await commit(ctx, { invoices: { upsert: [next] } }, [{ action: 'Payment recorded', details: `${rupees(amount)} from ${clientName(v, p.clientId)} via ${mode}${input.reference ? ` (${input.reference})` : ''} — ${p.invoiceNo}`, entity: 'payment', entityId: p.id, clientId: p.clientId }]);
        return { recorded: rupees(amount), invoice: p.invoiceNo, balance_left: rupees(bal - amount) };
      },
    };
  },

  async create_client(input, ctx) {
    needRole(ctx, ['admin', 'pm'], 'add clients');
    const v = bind(await viewFor(ctx.user));
    if (v.clients.some((c) => norm(c.company) === norm(input.company))) fail(`${input.company} already exists.`);
    const status = S.CLIENT_STATUSES.includes(input.status) ? input.status : 'Lead';
    const fee = Math.max(0, Number(input.monthly_fee) || 0);
    if (['Active', 'Onboarding'].includes(status) && !fee) fail('An active or onboarding client needs a monthly fee.');
    const quotas = {};
    [['poster', 'posters'], ['reel', 'reels'], ['story', 'stories'], ['blog', 'blogs'], ['shoot', 'shoots']].forEach(([k, f]) => { const n = Math.max(0, Math.round(Number(input[f]) || 0)); if (n) quotas[k] = n; });
    const terms = S.PAYMENT_TERMS.includes(input.payment_terms) ? input.payment_terms : '100% Advance';
    const day = Math.min(28, Math.max(1, Math.round(Number(input.billing_day) || 1)));
    return {
      summary: `Add ${input.company} (${status}) — contact ${input.contact}${fee ? `, ${rupees(fee)}/month + GST, ${terms}, billed on day ${day}` : ''}${Object.keys(quotas).length ? `, quota: ${Object.entries(quotas).map(([k, n]) => `${n} ${k}s`).join(', ')}` : ''}`,
      run: async () => {
        const id = S.uid('c');
        const c = { id, company: input.company, contact: input.contact, email: input.email || '', phone: input.phone || '', whatsapp: '', secondaryContact: { name: '', phone: '', email: '' }, whatsappGroup: '', address: '', gstin: '',
          category: S.CATEGORIES.includes(input.category) ? input.category : '', status, sentiment: 'Neutral', managerId: ctx.user.role === 'pm' ? ctx.user.id : '', services: [], notes: '', referredBy: null, referrals: [], feedback: [],
          onboarding: S.ONBOARDING_STEPS.map(() => ({ done: false, date: '' })), assets: { logo: '', guidelines: '', fonts: '' }, archived: false, createdAt: Date.now(),
          package: { name: 'Retainer', monthlyFee: fee, billingCycle: day === 1 ? '1' : 'custom', billingDay: day, paymentTerms: terms, startDate: status === 'Lead' ? '' : today(), endDate: '', isActive: status === 'Active', quotas,
            shootType: quotas.shoot ? 'MOBILE_PHONE' : 'NONE', shootsPerMonth: quotas.shoot || 0, shootLocation: S.SHOOT_LOCATIONS[0], rawFootageLink: '', metaAdBudget: 0, googleAdBudget: 0, rollover: false } };
        await commit(ctx, { clients: { upsert: [c] } }, [{ action: 'Client added', details: `${c.company} added as ${status}${fee ? ` (${rupees(fee)}/month)` : ''}`, entity: 'client', entityId: id, clientId: id }]);
        return { created: c.company, id, status, note: status === 'Active' ? 'The first invoice is generated automatically on the billing day.' : undefined, open: `#/clients/${id}` };
      },
    };
  },

  async update_client(input, ctx) {
    needRole(ctx, ['admin', 'pm'], 'edit clients');
    const v = bind(await viewFor(ctx.user));
    const c = findClient(v, input.client);
    const next = { ...c }, changes = [];
    if (input.note) { next.notes = [c.notes, `${today()}: ${input.note}`].filter(Boolean).join('\n'); changes.push('note added'); }
    if (input.sentiment) { const s = S.SENTIMENTS.find((x) => norm(x) === norm(input.sentiment)); if (!s) fail(`Sentiment must be ${S.SENTIMENTS.join(', ')}.`); next.sentiment = s; changes.push(`sentiment ${c.sentiment} → ${s}`); }
    if (input.status) { const s = S.CLIENT_STATUSES.find((x) => norm(x) === norm(input.status)); if (!s) fail(`Status must be ${S.CLIENT_STATUSES.join(', ')}.`); next.status = s; changes.push(`status ${c.status} → ${s}`); }
    if (!changes.length) fail('Nothing to change was given.');
    await commit(ctx, { clients: { upsert: [next] } }, [{ action: input.sentiment ? 'Sentiment changed' : 'Client updated', details: `${c.company} — ${changes.join('; ')}`, entity: 'client', entityId: c.id, clientId: c.id }]);
    return { updated: c.company, changes };
  },

  async log_feedback(input, ctx) {
    needRole(ctx, ['admin', 'pm'], 'log client feedback');
    const v = bind(await viewFor(ctx.user));
    const c = findClient(v, input.client);
    const month = /^\d{4}-\d{2}$/.test(input.month || '') ? input.month : S.addMonths(S.monthKey(), -1);
    const csat = Math.round(Number(input.csat)), nps = Math.round(Number(input.nps));
    if (!(csat >= 1 && csat <= 5) || !(nps >= 0 && nps <= 10)) fail('CSAT must be 1-5 and NPS 0-10.');
    const entry = { id: S.uid('fb'), month, csat, nps, notes: input.notes || '', by: ctx.user.id, date: today() };
    const next = { ...c, feedback: (c.feedback || []).filter((f) => f.month !== month).concat(entry) };
    if ((csat <= 2 || nps <= 4) && !['At-Risk', 'Critical'].includes(c.sentiment)) next.sentiment = 'At-Risk';
    await commit(ctx, { clients: { upsert: [next] } }, [{ action: 'Feedback logged', details: `${c.company} — ${month}: CSAT ${csat}/5, NPS ${nps}`, entity: 'client', entityId: c.id, clientId: c.id }]);
    return { logged: `${c.company} ${month}: CSAT ${csat}/5, NPS ${nps}`, sentiment: next.sentiment };
  },

  async request_leave(input, ctx) {
    needRole(ctx, STAFF, 'request leave');
    const v = bind(await viewFor(ctx.user));
    const type = ['casual', 'sick', 'pto', 'unpaid'].find((t) => t === norm(input.type).replace(/ /g, '') || (t === 'pto' && /paid time|vacation|annual/.test(norm(input.type))));
    if (!type) fail('Leave type must be casual, sick, pto or unpaid.');
    if (!isDate(input.from) || (input.to && !isDate(input.to))) fail('Dates must be YYYY-MM-DD.');
    const l = { id: S.uid('lv'), userId: ctx.user.id, type, from: input.from, to: input.half_day ? input.from : input.to || input.from, halfDay: !!input.half_day, reason: input.reason || '', backupId: '', status: 'Pending', decidedBy: '', decidedAt: null, createdAt: Date.now() };
    if (l.to < l.from) fail('The end date is before the start date.');
    const days = S.leaveDays(l, v.settings);
    if (!days) fail('Those dates are all week-offs.');
    const bal = S.leaveBalance(ctx.user).find((b) => b.key === type);
    if (type !== 'unpaid' && days > bal.left) fail(`Only ${bal.left} ${bal.label.toLowerCase()} day(s) left. Suggest unpaid leave for the rest.`);
    if (v.leaves.some((x) => x.userId === ctx.user.id && x.status !== 'Rejected' && x.from <= l.to && x.to >= l.from)) fail('You already have leave on some of those dates.');
    await commit(ctx, { leaves: { upsert: [l] } }, [{ action: 'Leave requested', details: `${ctx.user.name} — ${type} ${days} day(s), ${l.from}${l.to !== l.from ? ' to ' + l.to : ''}`, entity: 'leave', entityId: l.id }]);
    return { requested: `${days} day(s) of ${type} leave from ${l.from} to ${l.to}`, status: 'Pending approval' };
  },

  async decide_leave(input, ctx) {
    needRole(ctx, ['admin', 'pm'], 'approve leave');
    const v = bind(await viewFor(ctx.user));
    const who = findUser(v, input.person, ctx.user);
    const pend = v.leaves.filter((l) => l.userId === who.id && l.status === 'Pending');
    if (!pend.length) fail(`${who.name} has no pending leave request.`);
    if (pend.length > 1) fail(`${who.name} has ${pend.length} pending requests (${pend.map((l) => l.from).join(', ')}); ask which dates.`);
    const decision = /^(approve|approved|yes|ok)/.test(norm(input.decision)) ? 'Approved' : /^(reject|rejected|decline|no|deny)/.test(norm(input.decision)) ? 'Rejected' : fail('Decision must be approve or reject.');
    const l = pend[0];
    return {
      summary: `${decision === 'Approved' ? 'Approve' : 'Reject'} ${who.name}'s ${l.type} leave ${l.from}${l.to !== l.from ? ` to ${l.to}` : ''} (${S.leaveDays(l, v.settings)} day(s)${l.reason ? `, "${l.reason}"` : ''})`,
      run: async () => {
        await commit(ctx, { leaves: { upsert: [{ ...l, status: decision }] } }, [{ action: decision === 'Approved' ? 'Leave approved' : 'Leave rejected', details: `${who.name} — ${l.type}, ${l.from}${l.to !== l.from ? ' to ' + l.to : ''}`, entity: 'leave', entityId: l.id }]);
        return { done: `${who.name}'s leave ${decision.toLowerCase()}` };
      },
    };
  },

  async attendance(input, ctx) {
    needRole(ctx, STAFF, 'clock in or out');
    const v = bind(await viewFor(ctx.user));
    const d = today();
    let a = S.attendanceFor(ctx.user.id, d, v);
    const act = norm(input.action).replace(/ /g, '_');
    const save = (rec, action, details, extra = {}) => commit(ctx, { attendance: { upsert: [rec] }, ...extra.changes }, [{ action, details, entity: 'attendance', entityId: rec.id }]);
    if (act === 'clock_in') {
      if (a && a.clockIn && !a.clockOut) fail('You are already clocked in.');
      if (a && a.clockOut) fail('You already clocked out today.');
      a = { id: S.uid('att'), userId: ctx.user.id, date: d, clockIn: Date.now(), clockOut: null, breaks: [], ip: '', eodId: '' };
      await save(a, 'Clocked in', `${ctx.user.name} clocked in`);
      return { clocked_in: new Date(a.clockIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) };
    }
    if (!a || !a.clockIn || a.clockOut) fail('You are not clocked in right now.');
    const open = S.openBreak(a);
    if (act === 'start_break') {
      if (open) fail(`You are already on a ${open.type.toLowerCase()}.`);
      const type = /lunch/.test(norm(input.break_type)) ? 'Lunch' : 'Short break';
      const next = { ...a, breaks: [...a.breaks, { type, start: Date.now(), end: null }] };
      await save(next, 'Break started', `${ctx.user.name} — ${type}`);
      return { on_break: type };
    }
    if (act === 'end_break') {
      if (!open) fail('You are not on a break.');
      const next = { ...a, breaks: a.breaks.map((b) => (b.end ? b : { ...b, end: Date.now() })) };
      await save(next, 'Break ended', `${ctx.user.name} — ${open.type}`);
      return { back_from: open.type };
    }
    if (act === 'clock_out') {
      if (!input.eod_summary || String(input.eod_summary).trim().length < 5) fail('Clocking out needs an end-of-day summary — ask what they worked on today.');
      const now = Date.now();
      const done = v.tasks.filter((t) => t.completedBy === ctx.user.id && t.completedAt && new Date(t.completedAt).toISOString().slice(0, 10) <= d && t.completedAt >= a.clockIn);
      const eod = { id: S.uid('eod'), userId: ctx.user.id, date: d, completedIds: done.map((t) => t.id),
        completedSummary: [done.map((t) => `${t.title} (${clientName(v, t.clientId)})`).join('; '), input.eod_summary].filter(Boolean).join(' · '),
        pending: [], blockers: input.blockers || '', loggedAt: now };
      const next = { ...a, clockOut: now, eodId: eod.id, breaks: a.breaks.map((b) => (b.end ? b : { ...b, end: now })) };
      const extra = {};
      const meDoc = v.users.find((x) => x.id === ctx.user.id);
      if (meDoc && meDoc.timer) extra.users = { upsert: [{ ...meDoc, timer: null }] }; // stop a running task timer, like the Clock out button
      await commit(ctx, { attendance: { upsert: [next] }, eod: { upsert: [eod] }, ...extra }, [{ action: 'Clocked out', details: `${ctx.user.name} · ${(S.workedMs(next) / 3600000).toFixed(1)}h active · EOD submitted${eod.blockers ? ' · blocker reported' : ''}`, entity: 'attendance', entityId: a.id }]);
      return { clocked_out: true, hours: +(S.workedMs(next) / 3600000).toFixed(2), eod: eod.completedSummary };
    }
    fail('Action must be clock_in, start_break, end_break or clock_out.');
  },

  async draft_reminder({ invoice }, ctx) {
    needRole(ctx, ['admin', 'pm', 'finance'], 'see invoices');
    const v = bind(await viewFor(ctx.user));
    const p = findInvoice(v, invoice);
    const c = v.clients.find((x) => x.id === p.clientId) || {};
    const msg = S.reminderMessage(p, c, v.settings, ctx.user.name);
    return { invoice: p.invoiceNo, client: c.company, whatsapp_number: c.whatsapp || undefined, email: c.email || undefined, whatsapp: msg.whatsapp, email_subject: msg.subject, email_body: msg.email };
  },

  async plan_month(input, ctx) {
    needRole(ctx, ['admin', 'pm'], 'plan deliverables');
    const v = bind(await viewFor(ctx.user));
    const c = findClient(v, input.client);
    const mk = /^\d{4}-\d{2}$/.test(input.month || '') ? input.month : S.monthKey();
    const q = S.quotaStatus(c, mk);
    const missing = q.rows.reduce((a, r) => a + Math.max(0, r.quota - r.planned), 0);
    if (!missing) fail(`Everything in ${c.company}'s ${mk} quota is already planned.`);
    return {
      summary: `Create ${missing} backlog task(s) for ${c.company}'s ${mk} quota (${q.rows.filter((r) => r.quota > r.planned).map((r) => `${r.quota - r.planned} ${r.short.toLowerCase()}`).join(', ')})`,
      run: async () => {
        const fresh = bind(await viewFor(ctx.user));
        const cc = fresh.clients.find((x) => x.id === c.id);
        const before = new Set(fresh.tasks.map((t) => t.id));
        S.planMonthFor(cc, mk); // pushes new tasks into the bound view
        const made = fresh.tasks.filter((t) => !before.has(t.id));
        await commit(ctx, { tasks: { upsert: made } }, [{ action: 'Campaign planned', details: `${made.length} backlog tasks for ${c.company} (${mk})`, entity: 'task', clientId: c.id }]);
        return { created: made.length };
      },
    };
  },

  async business_review(input, ctx) {
    needRole(ctx, ['admin', 'pm', 'finance'], 'see the business review');
    const v = bind(await viewFor(ctx.user));
    return insights.review(v, ctx.user);
  },

  async remember(input, ctx) {
    const kind = memory.KINDS.includes(norm(input.kind)) ? norm(input.kind) : 'note';
    if (kind === 'goal') needRole(ctx, ['admin'], 'set agency goals');
    if (kind === 'note') needRole(ctx, ['admin', 'pm'], 'save agency notes (save it as personal instead)');
    if (/\b(password|otp|cvv|pin|account number|ifsc)\b/i.test(input.text || '')) fail('I don’t store passwords, bank or card details.');
    try {
      const m = await memory.add(ctx.user, { text: input.text, kind });
      ctx.memoryChanged = true;
      return { remembered: m.text, kind: m.kind, id: m.id };
    } catch (e) { fail(e.message); }
  },

  async forget({ id }, ctx) {
    const r = await memory.remove(ctx.user, id);
    if (r.error === 'not_found') fail('No memory item with that id.');
    if (r.error === 'forbidden') fail('Only an admin (or whoever saved it) can remove that agency memory.');
    ctx.memoryChanged = true;
    return { forgot: r.removed };
  },

  async add_team_member(input, ctx) {
    needRole(ctx, ['admin'], 'add team members');
    const v = bind(await viewFor(ctx.user));
    const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const email = String(input.email || '').trim().toLowerCase();
    if (!name) fail('What is their name?');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('A valid work email is needed for their login — ask the user for it.');
    if (v.users.some((u) => (u.email || '').toLowerCase() === email)) fail(`Someone already uses ${email}.`);
    const dupe = v.users.find((u) => norm(u.name) === norm(name) && u.role !== 'client');
    const role = memberRole(input.role) || 'creative';
    const ctc = salaryToCtc(input);
    const joinDate = input.join_date ? (isDate(input.join_date) ? input.join_date : fail('Joining date must be YYYY-MM-DD.')) : today();
    const wa = pickWork(input.work_arrangement);
    const dept = S.DEPARTMENTS.find((d) => norm(d) === norm(input.department)) || deptFor(role);
    const designation = String(input.designation || S.ROLES[role].label).slice(0, 100);
    return {
      summary: `Add ${name} (${email}) as ${designation}, ${S.ROLES[role].label}, joining ${joinDate}${ctc ? `, salary ${rupees(Math.round(ctc / 12))}/month (${rupees(ctc)} a year)` : ', no salary set'}${dupe ? ` — note: ${dupe.name} already exists with ${dupe.email}` : ''}`,
      run: async () => {
        const u = { id: S.uid('u'), name, email, phone: String(input.phone || '').slice(0, 30), role, designation, department: dept, workArrangement: wa, status: 'Active', joinDate,
          emergencyContact: { name: '', phone: '' }, ctc, bank: { holder: name, account: '', ifsc: '' }, idProof: { type: 'PAN', number: '', verified: false }, docs: { nda: '', contract: '', idCopy: '' },
          leaveQuota: { casual: 12, sick: 8, pto: 12 } };
        await commit(ctx, { users: { upsert: [u] } }, [{ action: 'Employee added', details: `${u.name} — ${u.designation} (${S.ROLES[role].label})${ctc ? `, CTC ${rupees(ctc)}` : ''}`, entity: 'employee', entityId: u.id }]);
        let login = 'They need a login: set a password for them in Team & HR (edit their profile).';
        if (input.send_invite && cfg.emailEnabled && cfg.appUrl) {
          login = (await notify.sendInvite(u.id, ctx.user).catch(() => false)) ? `Invite emailed to ${email}.` : `The invite email failed; set a password for them in Team & HR.`;
        }
        if (ctc) ctx.navigate = `#/payroll?month=${joinDate.slice(0, 7) > S.monthKey() ? joinDate.slice(0, 7) : S.monthKey()}`; // show the month they appear in
        return { added: name, role: S.ROLES[role].label, monthly_salary: Math.round(ctc / 12) || undefined, on_payroll_from: ctc ? joinDate.slice(0, 7) : undefined, login, opened: ctc ? 'Payroll screen' : undefined };
      },
    };
  },

  async update_team_member(input, ctx) {
    needRole(ctx, ['admin'], 'change employee details');
    const v = bind(await viewFor(ctx.user));
    const p = pickOne('person', v.users.filter((u) => u.role !== 'client'), input.person, (u) => u.name);
    const next = { ...p }, changes = [];
    const ctc = salaryToCtc(input);
    if (ctc) { next.ctc = ctc; changes.push(`salary ${p.ctc ? rupees(Math.round(p.ctc / 12)) : 'none'} → ${rupees(Math.round(ctc / 12))}/month`); }
    if (input.role) { const r = memberRole(input.role) || fail('Role must be admin, pm, creative, shoot or finance.'); if (p.id === ctx.user.id) fail('You can’t change your own role.'); next.role = r; changes.push(`role ${S.ROLES[p.role].label} → ${S.ROLES[r].label}`); }
    if (input.designation) { next.designation = String(input.designation).slice(0, 100); changes.push(`title ${input.designation}`); }
    if (input.department) { next.department = S.DEPARTMENTS.find((d) => norm(d) === norm(input.department)) || fail(`Department must be one of ${S.DEPARTMENTS.join(', ')}.`); changes.push(`department ${next.department}`); }
    if (input.join_date) { if (!isDate(input.join_date)) fail('Joining date must be YYYY-MM-DD.'); next.joinDate = input.join_date; changes.push(`joining date ${input.join_date}`); }
    if (input.work_arrangement) { next.workArrangement = pickWork(input.work_arrangement); changes.push(next.workArrangement); }
    if (input.phone) { next.phone = String(input.phone).slice(0, 30); changes.push('phone updated'); }
    if (input.status) { const st = S.EMPLOYEE_STATUSES.find((x) => norm(x) === norm(input.status)) || fail(`Status must be ${S.EMPLOYEE_STATUSES.join(', ')}.`); if (p.id === ctx.user.id) fail('You can’t change your own status.'); next.status = st; changes.push(`status ${p.status} → ${st}`); }
    if (!changes.length) fail('Nothing to change was given.');
    return {
      summary: `Update ${p.name}: ${changes.join(', ')}`,
      run: async () => {
        await commit(ctx, { users: { upsert: [next] } }, [{ action: 'Employee updated', details: `${p.name} — ${changes.map((c) => (c.startsWith('salary') ? 'compensation changed' : c)).join(', ')}`, entity: 'employee', entityId: p.id }]);
        if (ctc) ctx.navigate = `#/payroll?month=${S.monthKey()}`;
        return { updated: p.name, changes };
      },
    };
  },

  async get_payroll(input, ctx) {
    needRole(ctx, ['admin', 'finance'], 'see payroll');
    const v = bind(await viewFor(ctx.user));
    const mk = /^\d{4}-\d{2}$/.test(input.month || '') ? input.month : S.addMonths(S.monthKey(), -1);
    let people = v.users.filter((u) => u.role !== 'client' && u.status !== 'Inactive');
    if (input.person) { const p = pickOne('person', people, input.person, (u) => u.name); people = [p]; }
    const missing = people.filter((u) => !u.ctc).map((u) => u.name);
    const rows = people.filter((u) => u.ctc && (!u.joinDate || u.joinDate <= mk + '-31')).map((u) => { const p = S.payslip(u, mk); return { name: u.name, gross: p.monthly, lop_days: p.lop, lop: p.lopAmt, pf: p.pf, professional_tax: p.pt, tds: p.tds, net: p.net }; });
    return { month: mk, in_progress: mk >= S.monthKey() || undefined, people: rows.length, gross_total: rows.reduce((a, r) => a + r.gross, 0), net_total: rows.reduce((a, r) => a + r.net, 0), rows,
      no_salary_set: missing.length ? missing : undefined };
  },

  async open_page(input, ctx) {
    const pages = { dashboard: '#/dashboard', workspace: '#/workspace', 'my day': '#/workspace', clients: '#/clients', tasks: '#/tasks', board: '#/tasks', shoots: '#/shoots', payments: '#/payments', billing: '#/payments', overdue: '#/payments?tab=overdue',
      reminders: '#/payments?tab=reminders', team: '#/team', attendance: '#/team?tab=attendance', leave: '#/team?tab=leave', payroll: '#/payroll', reports: '#/reports', activity: '#/activity', audit: '#/activity', settings: '#/settings' };
    const p = norm(input.page);
    let route = pages[p];
    if (p === 'client' || (!route && input.client)) {
      const v = bind(await viewFor(ctx.user));
      const c = findClient(v, input.client || input.page);
      route = `#/clients/${c.id}${input.tab ? `?tab=${norm(input.tab)}` : ''}`;
    }
    if (!route) fail(`Unknown page "${input.page}".`);
    ctx.navigate = route;
    const name = route.startsWith('#/clients/') ? `${clientName(S.Store.data, route.split('/')[2].split('?')[0])}${input.tab ? ` · ${input.tab}` : ''}` : String(input.page).replace(/^\w/, (c) => c.toUpperCase());
    return { opened: route, page: name };
  },
};

module.exports = { DEFINITIONS, IMPL, NEEDS_CONFIRMATION, ToolError, viewFor, bind };
