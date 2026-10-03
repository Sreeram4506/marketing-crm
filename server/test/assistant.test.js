/* AI co-pilot tests: a real AgencyDesk server + MongoDB, with a scripted stand-in for
   the OpenAI API (test/mock-openai.js). Checks the request sent to OpenAI, streaming
   to the browser, every role's permissions, and the server-enforced confirmation step. */
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { createMock } = require('./mock-openai');

const PORT = 4600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/api`;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB = 'agencydesk_aitest_' + crypto.randomBytes(4).toString('hex');
const PW = 'DemoStaff#2026';
const mock = createMock();
let server;
const tokens = {};

async function call(method, p, body, token) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
/* Sends one message to the co-pilot and collects the streamed events */
async function ask(who, message, extra = {}) {
  const res = await fetch(BASE + '/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[who] }, body: JSON.stringify({ message, mode: 'voice', page: '#/dashboard', ...extra }) });
  if (!res.headers.get('content-type').includes('event-stream')) return { status: res.status, body: await res.json() };
  const raw = await res.text();
  const events = raw.split('\n\n').filter((c) => c.startsWith('data: ')).map((c) => JSON.parse(c.slice(6)));
  return { status: res.status, events, text: events.filter((e) => e.type === 'text').map((e) => e.delta).join(''), of: (t) => events.filter((e) => e.type === t), conversationId: (events.find((e) => e.type === 'start') || {}).conversationId };
}
const data = async (who) => (await call('GET', '/data', null, tokens[who])).body;
const login = async (email, password = PW) => (await call('POST', '/auth/login', { email, password })).body.token;

before(async () => {
  const mockUrl = await mock.listen();
  server = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), MONGODB_URI, MONGODB_DB: DB, JWT_SECRET: crypto.randomBytes(40).toString('hex'), TZ: 'Asia/Kolkata', SERVE_FRONTEND: 'false',
      OPENAI_API_KEY: 'sk-test-key', OPENAI_BASE_URL: mockUrl + '/v1', AI_MODEL: '', AUTH_RATE_LIMIT: '200', API_RATE_LIMIT: '100000', AI_RATE_LIMIT: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; server.stdout.on('data', (d) => (out += d)); server.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); if (i === 99) throw new Error(out); }
  const s = await call('POST', '/setup', { agencyName: 'AI Test Agency', name: 'Priya Sharma', email: 'priya@brightpixel.in', password: 'FounderPass#1', sampleData: true, demoPassword: PW });
  tokens.admin = s.body.token;
  tokens.pm1 = await login('rahul@brightpixel.in');
  tokens.des = await login('arjun@brightpixel.in');
  tokens.fin = await login('vikram@brightpixel.in');
});
beforeEach(() => { mock.state.queue.length = 0; mock.state.errors.length = 0; });
afterEach(() => {
  const errs = mock.state.errors.splice(0);
  if (errs.length) throw errs[0];                       // checks made inside scripted replies
  assert.equal(mock.state.queue.length, 0, 'every scripted reply was used');
});
after(async () => {
  server && server.kill();
  mock.close();
  const c = await MongoClient.connect(MONGODB_URI); await c.db(DB).dropDatabase(); await c.close();
});

test('the co-pilot is advertised when an API key is configured', async () => {
  assert.equal((await call('GET', '/setup-status')).body.aiEnabled, true);
});

test('streams the reply and sends OpenAI a well-formed request', async () => {
  mock.reply(mock.text('Good morning! You have three overdue invoices.'));
  const r = await ask('admin', 'Good morning');
  assert.equal(r.status, 200);
  assert.equal(r.text, 'Good morning! You have three overdue invoices.');
  assert.ok(r.of('text').length > 1, 'the reply arrives in pieces, so speech can start early');
  assert.equal(r.events.at(-1).type, 'done');
  const req = mock.state.requests.at(-1);
  assert.equal(req.body.model, 'gpt-5.5');
  assert.equal(req.body.stream, true);
  assert.equal(req.headers.authorization, 'Bearer sk-test-key');
  assert.match(req.url, /^\/v1\/responses/, 'GPT-5.x models need the Responses API when tools are used');
  assert.deepEqual(req.body.reasoning, { effort: 'low' });
  assert.equal(req.body.store, false, 'nothing is kept at OpenAI');
  assert.deepEqual(req.body.include, ['reasoning.encrypted_content']);
  assert.equal(req.body.prompt_cache_key, 'agencydesk-copilot');
  assert.ok(req.body.tools.length >= 19 && req.body.tools.every((t) => t.type === 'function' && t.name && t.parameters.type === 'object'));
  assert.doesNotMatch(req.body.instructions, /\d{4}-\d{2}-\d{2}/, 'no dates in the instructions, so they stay cacheable');
  assert.equal(req.body.input[0].role, 'user');
  assert.match(req.body.input[0].content, /User: Priya Sharma, Super Admin/);
  assert.match(req.body.input[0].content, /Reply mode: voice/);
});

test('read tools answer from the database within the user’s permissions', async () => {
  mock.reply(mock.tool('get_client', { client: 'apollo' }), (body) => {
    const r = mock.lastToolResult(body);
    assert.equal(r.data.company, 'Apollo Dental Care');
    assert.ok(r.data.this_month.quota > 0);
    assert.ok(Array.isArray(r.data.unpaid_invoices), 'admins see money');
    return mock.text('Apollo is on track.');
  });
  const r = await ask('admin', 'How is Apollo doing?');
  assert.deepEqual(r.of('tool').map((e) => e.status), ['running', 'done']);
  assert.equal(r.text, 'Apollo is on track.');

  // A designer never receives invoices or fees through the co-pilot
  mock.reply(mock.tool('list_invoices', {}), (body) => { assert.match(mock.lastToolResult(body).data.error, /can't see invoices/); return mock.text('You don’t have access to invoices.'); },
    mock.tool('get_client', { client: 'apollo' }), (body) => { const d = mock.lastToolResult(body).data; assert.equal(d.package, undefined); assert.equal(d.unpaid_invoices, undefined); return mock.text('ok'); });
  await ask('des', 'Show me invoices');
  await ask('des', 'Tell me about Apollo');
});

test('a PM creates and moves tasks by voice; the audit trail shows it came from the co-pilot', async () => {
  const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  mock.reply(mock.tool('create_task', { client: 'Apollo', title: 'Diwali offer reel', type: 'reel', assignee: 'Arjun', due_date: due, priority: 'High' }), mock.text('Created.'));
  const r = await ask('pm1', 'Create a high priority reel for Apollo called Diwali offer reel, give it to Arjun, due in three days');
  assert.equal(r.of('tool').at(-1).status, 'done');
  let d = await data('admin');
  const t = d.tasks.find((x) => x.title === 'Diwali offer reel');
  assert.ok(t && t.assigneeId === 'u_des1' && t.priority === 'High' && t.dueDate === due && t.status === 'Backlog');
  assert.ok(d.activity.some((a) => a.action === 'Task created' && /via AI assistant/.test(a.details) && a.userId === 'u_pm1'));

  mock.reply(mock.tool('update_task', { task: 'Diwali offer reel', status: 'Design / Editing', note: 'Use the festive palette' }), mock.text('Moved.'));
  await ask('pm1', 'Move the Diwali reel into design and note to use the festive palette');
  d = await data('admin');
  const t2 = d.tasks.find((x) => x.id === t.id);
  assert.equal(t2.status, 'Design / Editing');
  assert.match(t2.description, /festive palette/);
});

test('permissions hold: a designer can’t create tasks or touch other people’s work; a PM can’t reach another PM’s client', async () => {
  const before = (await data('admin')).tasks.length;
  mock.reply(mock.tool('create_task', { client: 'Apollo', title: 'Sneaky', type: 'poster', due_date: '2031-01-01' }), (body) => { assert.match(mock.lastToolResult(body).data.error, /can't create tasks/); return mock.text('No.'); });
  await ask('des', 'Create a poster for Apollo');
  mock.reply(mock.tool('update_task', { task: 'Diwali offer reel', assignee: 'Kavya' }), (body) => { assert.match(mock.lastToolResult(body).data.error, /not who it’s assigned to/); return mock.text('No.'); });
  await ask('des', 'Give the Diwali reel to Kavya');
  mock.reply(mock.tool('get_client', { client: 'GreenLeaf' }), (body) => { assert.match(mock.lastToolResult(body).data.error, /No client matching/); return mock.text('No.'); });
  await ask('pm1', 'How is GreenLeaf doing?'); // GreenLeaf belongs to Sneha
  const d = await data('admin');
  assert.equal(d.tasks.length, before);
  assert.equal(d.tasks.find((x) => x.title === 'Diwali offer reel').assigneeId, 'u_des1');
});

test('money needs a spoken yes: the server refuses to confirm in the same turn, then records the payment after the user agrees', async () => {
  const d0 = await data('fin');
  const inv = d0.invoices.find((p) => p.status === 'Overdue' || p.status === 'Pending' || p.status === 'Partially Paid');
  const bal = inv.amountDue - inv.amountPaid;
  let confirmationId;
  mock.reply(mock.tool('record_payment', { invoice: inv.invoiceNo, amount: 1000, mode: 'UPI', reference: 'UPI/VOICE1' }), (body) => {
    const r = mock.lastToolResult(body).data;
    assert.equal(r.needs_confirmation, true);
    confirmationId = r.confirmation_id;
    return mock.tool('confirm_action', { confirmation_id: confirmationId }); // a model trying to skip the user
  }, (body) => {
    assert.match(mock.lastToolResult(body).data.error, /has not replied/);
    return mock.text(`Record 1,000 rupees by UPI against ${inv.invoiceNo}. Shall I go ahead?`);
  });
  const r1 = await ask('fin', `Record 1000 by UPI on ${inv.invoiceNo}`);
  assert.equal(r1.of('confirm').length, 1);
  assert.match(r1.of('confirm')[0].summary, /Record ₹1,000/);
  assert.equal((await data('fin')).invoices.find((p) => p.id === inv.id).amountPaid, inv.amountPaid, 'nothing saved before the yes');

  mock.reply(() => mock.tool('confirm_action', { confirmation_id: confirmationId }), (body) => { assert.equal(mock.lastToolResult(body).data.ok, true); return mock.text('Done.'); });
  const r2 = await ask('fin', 'Yes, go ahead', { conversationId: r1.conversationId });
  assert.equal(r2.events.at(-1).changed, true);
  const after = (await data('fin')).invoices.find((p) => p.id === inv.id);
  assert.equal(after.amountPaid, inv.amountPaid + 1000);
  assert.equal(after.transactions.at(-1).ref, 'UPI/VOICE1');
  assert.ok(bal >= 1000);

  // The same confirmation can't be replayed
  mock.reply(() => mock.tool('confirm_action', { confirmation_id: confirmationId }), (body) => { assert.match(mock.lastToolResult(body).data.error, /No pending action/); return mock.text('Already done.'); });
  await ask('fin', 'Do it again', { conversationId: r1.conversationId });
  assert.equal((await data('fin')).invoices.find((p) => p.id === inv.id).amountPaid, inv.amountPaid + 1000);
});

test('the conversation history is kept intact between turns (so the cached prefix keeps matching)', async () => {
  mock.reply(mock.text('First answer.'));
  const r1 = await ask('admin', 'First question');
  mock.reply(mock.text('Second answer.'));
  await ask('admin', 'Second question', { conversationId: r1.conversationId });
  const msgs = mock.state.requests.at(-1).body.input;
  assert.deepEqual(msgs.map((m) => m.role || m.type), ['user', 'reasoning', 'assistant', 'user'], 'reasoning is carried forward between turns');
  assert.equal(msgs[1].encrypted_content, 'enc_mock');
  assert.equal(msgs[2].content, 'First answer.');
  // Another user can't continue someone else's conversation
  mock.reply(mock.text('Fresh.'));
  const r3 = await ask('pm1', 'Hello', { conversationId: r1.conversationId });
  assert.notEqual(r3.conversationId, r1.conversationId);
  assert.equal(mock.state.requests.at(-1).body.input.length, 1);
});

test('voice attendance: clock in, break, and clock out with an end-of-day summary', async () => {
  // Start from a clean slate for today
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const c = await MongoClient.connect(MONGODB_URI); await c.db(DB).collection('attendance').deleteMany({ userId: 'u_des1', date: today }); await c.close();
  mock.reply(mock.tool('attendance', { action: 'clock_in' }), mock.text('Clocked in.'));
  await ask('des', 'Clock me in');
  mock.reply(mock.tool('attendance', { action: 'start_break', break_type: 'Lunch' }), mock.text('Enjoy lunch.'));
  await ask('des', 'Going for lunch');
  mock.reply(mock.tool('attendance', { action: 'end_break' }), mock.text('Welcome back.'));
  await ask('des', 'Back from lunch');
  mock.reply(mock.tool('attendance', { action: 'clock_out' }), (body) => { assert.match(mock.lastToolResult(body).data.error, /end-of-day summary/); return mock.text('What did you work on today?'); });
  await ask('des', 'Clock me out');
  mock.reply(mock.tool('attendance', { action: 'clock_out', eod_summary: 'Finished the Diwali reel storyboard', blockers: 'Waiting for the logo files' }), mock.text('Clocked out.'));
  await ask('des', 'Finished the Diwali reel storyboard, waiting on logo files');
  const d = await data('des');
  const a = d.attendance.find((x) => x.date === today);
  assert.ok(a.clockIn && a.clockOut && a.breaks.length === 1 && a.breaks[0].end);
  assert.ok(a.ip, 'clock-in IP stamped by the server');
  const eod = d.eod.find((e) => e.id === a.eodId);
  assert.match(eod.completedSummary, /Diwali reel storyboard/);
  assert.match(eod.blockers, /logo/);
});

test('leave by voice: request, then the manager approves only after confirming', async () => {
  mock.reply(mock.tool('request_leave', { type: 'casual', from: '2031-05-05', reason: 'Cousin wedding in Kochi' }), mock.text('Requested.'));
  await ask('des', 'I need casual leave on 5 May 2031 for my cousin’s wedding in Kochi');
  let confirmationId;
  mock.reply(mock.tool('decide_leave', { person: 'Arjun', decision: 'approve' }), (body) => { confirmationId = mock.lastToolResult(body).data.confirmation_id; return mock.text('Approve Arjun’s leave on 5 May? '); });
  const r1 = await ask('pm1', 'Approve Arjun’s leave');
  assert.equal((await data('pm1')).leaves.find((l) => l.reason === 'Cousin wedding in Kochi').status, 'Pending');
  mock.reply(() => mock.tool('confirm_action', { confirmation_id: confirmationId }), mock.text('Approved.'));
  await ask('pm1', 'Yes', { conversationId: r1.conversationId });
  const l = (await data('pm1')).leaves.find((x) => x.reason === 'Cousin wedding in Kochi');
  assert.equal(l.status, 'Approved');
  assert.equal(l.decidedBy, 'u_pm1');
});

test('opens pages on request, and drafts reminders without sending them', async () => {
  mock.reply(mock.tool('open_page', { page: 'client', client: 'Apollo', tab: 'billing' }), mock.text('Here it is.'));
  const r = await ask('admin', 'Open Apollo billing');
  assert.equal(r.of('navigate')[0].route, '#/clients/c_apollo?tab=billing');
  const inv = (await data('admin')).invoices.find((p) => p.amountDue > p.amountPaid);
  mock.reply(mock.tool('draft_reminder', { invoice: inv.invoiceNo }), (body) => { const x = mock.lastToolResult(body).data; assert.match(x.whatsapp, new RegExp(inv.invoiceNo.replace(/\//g, '\\/'))); return mock.text('Drafted.'); });
  await ask('admin', `Draft a reminder for ${inv.invoiceNo}`);
});

test('co-founder business review: real numbers, scoped to the person’s role', async () => {
  mock.reply(mock.tool('business_review', {}), (body) => {
    const r = mock.lastToolResult(body).data;
    assert.ok(r.revenue.monthly_recurring_before_gst > 0 && r.revenue.last_6_months_incl_gst.length === 6);
    assert.ok(r.costs.monthly_payroll > 0, 'the founder sees payroll vs revenue');
    assert.ok(r.clients.every((c) => typeof c.health === 'number') && r.clients.some((c) => c.est_team_cost !== undefined));
    assert.ok(r.team.makers.length && Array.isArray(r.signals) && r.signals.length);
    return mock.text('Revenue is steady but collections are slipping.');
  });
  const r = await ask('admin', 'How is the business really doing?', { mode: 'text' });
  assert.equal(r.of('tool')[1].summary.match(/worth attention|healthy/) !== null, true);
  assert.equal(mock.state.requests.at(-1).body.reasoning.effort, 'medium', 'typed strategy questions get more thought than voice');
  mock.reply(mock.tool('business_review', {}), (body) => {
    const r = mock.lastToolResult(body).data;
    assert.equal(r.costs, undefined, 'managers don’t see salaries');
    assert.ok(r.clients.every((c) => c.est_team_cost === undefined));
    return mock.text('ok');
  });
  await ask('pm1', 'How are we doing?');
  mock.reply(mock.tool('business_review', {}), (body) => { assert.equal(mock.lastToolResult(body).data.clients, undefined); return mock.text('ok'); });
  await ask('fin', 'How are we doing?');
  mock.reply(mock.tool('business_review', {}), (body) => { assert.match(mock.lastToolResult(body).data.error, /can't see the business review/); return mock.text('ok'); });
  await ask('des', 'How is the company doing financially?');
});

test('signals: what needs attention, without an AI call, filtered by role', async () => {
  const before = mock.state.requests.length;
  const admin = await call('GET', '/assistant/signals', null, tokens.admin);
  assert.equal(admin.status, 200);
  assert.ok(admin.body.signals.length && admin.body.signals.every((x) => x.title && x.ask && ['high', 'medium', 'low'].includes(x.severity)));
  assert.ok(admin.body.signals.some((x) => x.area === 'money'));
  const des = await call('GET', '/assistant/signals', null, tokens.des);
  assert.equal(des.status, 200);
  assert.ok(des.body.signals.every((x) => x.area !== 'money' && x.area !== 'team'), 'designers aren’t shown finances or HR');
  assert.equal(mock.state.requests.length, before, 'no AI request was made');
});

test('long-term memory: goals carry into new conversations; permissions apply', async () => {
  mock.reply(mock.tool('remember', { kind: 'goal', text: 'Reach 6 lakh monthly revenue by March 2027' }), (body) => { assert.equal(mock.lastToolResult(body).data.kind, 'goal'); return mock.text('Noted.'); });
  await ask('admin', 'Our goal is 6 lakh a month by March');
  mock.reply(mock.text('You are at 3.5 lakh against a 6 lakh goal.'));
  await ask('pm1', 'How far are we from our goal?');
  const first = mock.state.requests.at(-1).body.input[0].content;
  assert.match(first, /\[Your long-term memory\][\s\S]*Agency goals: \[mem_[^\]]+\] Reach 6 lakh monthly revenue by March 2027/);
  mock.reply(mock.tool('remember', { kind: 'goal', text: 'Make me a director' }), (body) => { assert.match(mock.lastToolResult(body).data.error, /can't set agency goals/); return mock.text('No.'); });
  await ask('des', 'Set a goal');
  mock.reply(mock.tool('remember', { kind: 'personal', text: 'Prefers short answers in Hindi-English' }), mock.text('Got it.'));
  await ask('des', 'Keep answers short');
  mock.reply(mock.tool('remember', { kind: 'personal', text: 'My bank account number is 1234' }), (body) => { assert.match(mock.lastToolResult(body).data.error, /don’t store/); return mock.text('No.'); });
  await ask('des', 'Remember my bank account number');
  const desMem = (await call('GET', '/assistant/memory', null, tokens.des)).body.items;
  assert.ok(desMem.some((m) => m.kind === 'personal') && desMem.some((m) => m.kind === 'goal'));
  const goal = desMem.find((m) => m.kind === 'goal');
  assert.equal(goal.canRemove, false);
  assert.equal((await call('DELETE', `/assistant/memory/${goal.id}`, null, tokens.des)).status, 403);
  const pmMem = (await call('GET', '/assistant/memory', null, tokens.pm1)).body.items;
  assert.ok(!pmMem.some((m) => m.kind === 'personal'), 'personal notes stay private');
  const acts = (await data('admin')).activity;
  assert.ok(acts.some((x) => x.action === 'AI goal set' && /6 lakh/.test(x.details)));
  assert.equal((await call('DELETE', `/assistant/memory/${goal.id}`, null, tokens.admin)).status, 200);
  assert.ok(!(await call('GET', '/assistant/memory', null, tokens.admin)).body.items.some((m) => m.id === goal.id));
});

test('HR by voice: add a team member with a salary (after confirming), then they show up in payroll', async () => {
  // A missing email is refused rather than invented
  mock.reply(mock.tool('add_team_member', { name: 'Mulukuri Sreeram', monthly_salary: 25000 }), (body) => { assert.match(mock.lastToolResult(body).data.error, /valid work email/); return mock.text('What is their work email?'); });
  await ask('admin', 'Add Mulukuri Sreeram with a 25,000 payroll entry');
  let confirmationId;
  mock.reply(mock.tool('add_team_member', { name: 'Mulukuri Sreeram', email: 'sreeram@brightpixel.in', role: 'designer', designation: 'Graphic Designer', monthly_salary: 25000, join_date: '2026-09-01' }), (body) => {
    const r = mock.lastToolResult(body).data;
    assert.equal(r.needs_confirmation, true);
    assert.match(r.summary, /Mulukuri Sreeram.*Graphic Designer.*₹25,000\/month/);
    confirmationId = r.confirmation_id;
    return mock.text('Add Mulukuri Sreeram at 25 thousand a month? Shall I go ahead?');
  });
  const r1 = await ask('admin', 'sreeram@brightpixel.in, graphic designer, joined 1 September');
  assert.ok(!(await data('admin')).users.some((u) => u.email === 'sreeram@brightpixel.in'), 'nothing saved before confirming');
  mock.reply(() => mock.tool('confirm_action', { confirmation_id: confirmationId }), (body) => { const d = mock.lastToolResult(body).data; assert.equal(d.added, 'Mulukuri Sreeram'); assert.equal(d.monthly_salary, 25000); assert.match(d.login, /password/); return mock.text('Added.'); });
  const r2 = await ask('admin', 'Yes', { conversationId: r1.conversationId });
  assert.match(r2.of('navigate')[0].route, /^#\/payroll\?month=\d{4}-\d{2}$/, 'opens Payroll on a month that includes them');
  const u = (await data('admin')).users.find((x) => x.email === 'sreeram@brightpixel.in');
  assert.equal(u.ctc, 300000); assert.equal(u.role, 'creative'); assert.equal(u.joinDate, '2026-09-01');
  mock.reply(mock.tool('get_payroll', { month: '2026-09', person: 'Mulukuri' }), (body) => { const d = mock.lastToolResult(body).data; assert.equal(d.rows[0].gross, 25000); return mock.text('ok'); });
  await ask('fin', 'What is Sreeram paid in September?');
  // A salary change needs confirmation too, and only admins can do it
  mock.reply(mock.tool('update_team_member', { person: 'Mulukuri', monthly_salary: 30000 }), (body) => { assert.match(mock.lastToolResult(body).data.error, /can't change employee details/); return mock.text('No.'); });
  await ask('fin', 'Raise Sreeram to 30 thousand');
  mock.reply(mock.tool('update_team_member', { person: 'Mulukuri', monthly_salary: 30000 }), (body) => { confirmationId = mock.lastToolResult(body).data.confirmation_id; return mock.text('Confirm?'); });
  const r3 = await ask('admin', 'Raise Sreeram to 30 thousand');
  mock.reply(() => mock.tool('confirm_action', { confirmation_id: confirmationId }), mock.text('Done.'));
  await ask('admin', 'Yes', { conversationId: r3.conversationId });
  assert.equal((await data('admin')).users.find((x) => x.email === 'sreeram@brightpixel.in').ctc, 360000);
  assert.ok((await data('admin')).activity.some((a) => a.action === 'Employee added' && /Mulukuri Sreeram.*via AI assistant/.test(a.details)));
});

test('refusals, API failures and bad requests are handled cleanly', async () => {
  mock.reply(mock.refusal('I can’t help with that.'));
  const r = await ask('admin', 'something');
  assert.match(r.text, /can't help/);
  assert.equal(r.events.at(-1).type, 'done');
  assert.equal((await ask('admin', '   ')).status, 400);
  // A rejected API key becomes a friendly message, not a crash
  mock.reply({ status: 401, message: 'Incorrect API key provided' });
  const bad = await ask('admin', 'hello');
  assert.match(bad.of('error')[0].message, /OPENAI_API_KEY/);
  // Clients (portal users) and anonymous callers can't use it
  assert.equal((await fetch(BASE + '/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"hi"}' })).status, 401);
});

test('an admin can switch the co-pilot off', async () => {
  const d = await data('admin');
  await call('POST', '/sync', { changes: {}, settings: { ...d.settings, aiDisabled: true } }, tokens.admin);
  assert.equal((await ask('pm1', 'hello')).status, 403);
  assert.equal((await call('GET', '/setup-status')).body.aiEnabled, false);
  await call('POST', '/sync', { changes: {}, settings: { ...(await data('admin')).settings, aiDisabled: false } }, tokens.admin);
  mock.reply(mock.text('Back.'));
  assert.equal((await ask('pm1', 'hello')).status, 200);
});
