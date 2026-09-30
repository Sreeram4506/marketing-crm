/* End-to-end API tests. Needs a MongoDB to talk to:
     MONGODB_URI=mongodb://127.0.0.1:27017 npm test --prefix server
   Each run uses its own throwaway database and drops it afterwards. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');

const PORT = 4100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}/api`;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB = 'agencydesk_test_' + crypto.randomBytes(4).toString('hex');
const CRON = 'test-cron-secret';
const ADMIN = { email: 'founder@testagency.in', password: 'FounderPass#1' };
const DEMO_PW = 'DemoStaff#2026';
let server, hook, hookHits = [], emails = [];
const tokens = {};

async function call(method, p, body, token, headers = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const login = async (email, password = DEMO_PW) => (await call('POST', '/auth/login', { email, password })).body.token;
const data = async (who) => (await call('GET', '/data', null, tokens[who])).body;
const sync = async (who, changes, extra = {}) => (await call('POST', '/sync', { changes, ...extra }, tokens[who])).body;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

before(async () => {
  // Stands in for both the reminder webhook (/hook) and the Resend email API (/email)
  hook = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { const body = JSON.parse(b || '{}'); (req.url === '/email' ? emails : hookHits).push(body); res.end('{"id":"x"}'); }); });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), MONGODB_URI, MONGODB_DB: DB, JWT_SECRET: crypto.randomBytes(40).toString('hex'), CRON_SECRET: CRON, TZ: 'Asia/Kolkata',
      AUTH_RATE_LIMIT: '120', API_RATE_LIMIT: '100000', APP_URL: 'http://app.test', RESEND_API_KEY: 're_test', EMAIL_FROM: 'AgencyDesk <test@agency.test>', EMAIL_API_URL: `http://127.0.0.1:${hook.address().port}/email` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/health')).ok) return; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start:\n' + log);
});
after(async () => {
  server && server.kill();
  hook && hook.close();
  const c = await MongoClient.connect(MONGODB_URI); await c.db(DB).dropDatabase(); await c.close();
});

/* ---------------- Setup & auth ---------------- */
test('fresh install asks for setup', async () => {
  const r = await call('GET', '/setup-status');
  assert.equal(r.body.needsSetup, true);
});

test('setup validates input, then creates the workspace once', async () => {
  assert.equal((await call('POST', '/setup', { name: 'X', email: 'bad', password: 'short' })).status, 400);
  const ok = await call('POST', '/setup', { agencyName: 'Test Agency', name: 'Test Founder', ...ADMIN, sampleData: true, demoPassword: DEMO_PW });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.user.role, 'admin');
  assert.equal((await call('POST', '/setup', { name: 'Y', email: 'y@y.in', password: 'Another#123' })).status, 409);
  assert.equal((await call('GET', '/setup-status')).body.needsSetup, false);
});

test('login: wrong password rejected, email is case-insensitive, all roles can sign in', async () => {
  assert.equal((await call('POST', '/auth/login', { email: ADMIN.email, password: 'nope' })).status, 401);
  tokens.admin = await login(ADMIN.email.toUpperCase(), ADMIN.password);
  tokens.pm1 = await login('rahul@brightpixel.in');
  tokens.pm2 = await login('sneha@brightpixel.in');
  tokens.des = await login('arjun@brightpixel.in');
  tokens.shoot = await login('aditya@brightpixel.in');
  tokens.fin = await login('vikram@brightpixel.in');
  Object.entries(tokens).forEach(([k, v]) => assert.ok(v, k + ' could not sign in'));
  assert.equal((await call('GET', '/auth/me', null, tokens.pm2)).body.user.name, 'Sneha Reddy');
});

test('bad or missing tokens are rejected', async () => {
  assert.equal((await call('GET', '/data')).status, 401);
  assert.equal((await call('GET', '/data', null, tokens.admin.slice(0, -3) + 'abc')).status, 401);
});

/* ---------------- What each role can see ---------------- */
test('admin sees everything, including salaries and the webhook setting', async () => {
  const d = await data('admin');
  assert.equal(d.clients.length, 7);
  assert.ok(d.invoices.length >= 14);
  assert.ok(d.users.find((u) => u.id === 'u_des1').ctc > 0);
  assert.ok('webhookUrl' in d.settings);
  assert.ok(!d.users.some((u) => 'passwordHash' in u), 'password hashes must never be sent');
});

test('PM sees only their own clients and those clients’ invoices', async () => {
  const d = await data('pm2');
  assert.deepEqual(d.clients.map((c) => c.managerId).filter((m) => m !== 'u_pm2'), []);
  const ids = new Set(d.clients.map((c) => c.id));
  assert.ok(d.invoices.every((p) => ids.has(p.clientId)));
  assert.equal(d.users.find((u) => u.id === 'u_des1').ctc, 0, 'salaries hidden from PMs');
});

test('designer sees only their work — no invoices, fees, salaries or others’ attendance', async () => {
  const d = await data('des');
  assert.equal(d.invoices.length, 0);
  assert.ok(d.clients.every((c) => c.package.monthlyFee === 0));
  assert.ok(d.tasks.every((t) => t.assigneeId === 'u_des1' || t.reviewerId === 'u_des1' || (t.shoot && t.shoot.crewIds.includes('u_des1'))));
  assert.ok(d.attendance.every((a) => a.userId === 'u_des1'));
  assert.ok(d.leaves.every((l) => l.userId === 'u_des1'));
  assert.ok(!('webhookUrl' in d.settings));
});

test('finance sees all invoices and payroll data', async () => {
  const d = await data('fin');
  assert.ok(d.invoices.length >= 14);
  assert.ok(d.users.find((u) => u.id === 'u_des1').ctc > 0);
});

test('shoot crew sees shoot tasks', async () => {
  const d = await data('shoot');
  assert.ok(d.tasks.some((t) => t.type === 'shoot'));
  assert.equal(d.invoices.length, 0);
});

/* ---------------- What each role can change ---------------- */
test('designer: only stage/link/revisions of own task apply; everything else is refused', async () => {
  const d = await data('des');
  const task = d.tasks.find((t) => t.assigneeId === 'u_des1' && t.status === 'Design / Editing') || d.tasks.find((t) => t.assigneeId === 'u_des1' && t.status !== 'Published');
  const client = d.clients[0];
  const r = await sync('des', {
    tasks: { upsert: [{ ...task, status: 'Internal Review', link: 'https://drive.google.com/x', assigneeId: 'u_ed1', title: 'hijacked' }], delete: [task.id] },
    clients: { upsert: [{ ...client, company: 'HACKED' }] },
    invoices: { upsert: [{ id: 'inv_evil', clientId: client.id, month: '2026-01', amountDue: 1, amountPaid: 1, schedule: [] }] },
  }, { settings: { ...d.settings, agencyName: 'HACKED' } });
  assert.equal(r.rejected, 4); // task delete, client, invoice, settings
  const t = r.data.tasks.find((x) => x.id === task.id);
  assert.equal(t.status, 'Internal Review');
  assert.equal(t.link, 'https://drive.google.com/x');
  assert.equal(t.assigneeId, 'u_des1');
  assert.equal(t.title, task.title);
  const a = await data('admin');
  assert.notEqual(a.clients.find((c) => c.id === client.id).company, 'HACKED');
  assert.notEqual(a.settings.agencyName, 'HACKED');
  assert.ok(!a.invoices.find((p) => p.id === 'inv_evil'));
});

test('PM can edit own client but not another PM’s', async () => {
  const a = await data('admin');
  const mine = a.clients.find((c) => c.managerId === 'u_pm2');
  const theirs = a.clients.find((c) => c.managerId === 'u_pm1');
  const r = await sync('pm2', { clients: { upsert: [{ ...mine, notes: 'Updated by Sneha' }, { ...theirs, notes: 'Sneha was here' }] } });
  assert.equal(r.rejected, 1);
  const a2 = await data('admin');
  assert.equal(a2.clients.find((c) => c.id === mine.id).notes, 'Updated by Sneha');
  assert.notEqual(a2.clients.find((c) => c.id === theirs.id).notes, 'Sneha was here');
});

test('PM can only mark reminders on invoices, not change amounts', async () => {
  const d = await data('pm2');
  const inv = d.invoices.find((p) => p.amountPaid < p.amountDue);
  const r = await sync('pm2', { invoices: { upsert: [{ ...inv, amountPaid: inv.amountDue, reminders: { test_key: { at: 1, channel: 'WhatsApp' } } }] } });
  const after = r.data.invoices.find((p) => p.id === inv.id);
  assert.equal(after.amountPaid, inv.amountPaid);
  assert.ok(after.reminders.test_key);
});

test('shoot tasks cannot advance until the equipment checklist is complete', async () => {
  const d = await data('admin');
  const shoot = d.tasks.find((t) => t.type === 'shoot' && t.status === 'Backlog');
  const bad = await sync('admin', { tasks: { upsert: [{ ...shoot, status: 'Design / Editing', shoot: { ...shoot.shoot, checklist: {} } }] } });
  assert.equal(bad.rejected, 1);
  const full = Object.fromEntries(['camera', 'lens', 'mic', 'gimbal', 'card', 'batteries', 'lights'].map((k) => [k, true]));
  const good = await sync('admin', { tasks: { upsert: [{ ...shoot, status: 'Design / Editing', shoot: { ...shoot.shoot, checklist: full } }] } });
  assert.equal(good.rejected, 0);
  assert.equal(good.data.tasks.find((t) => t.id === shoot.id).status, 'Design / Editing');
});

/* ---------------- Leave ---------------- */
test('leave: requests are forced to Pending; PM approves creatives; nobody approves their own', async () => {
  const from = '2030-03-05';
  const r = await sync('des', { leaves: { upsert: [{ id: 'lv_e2e', userId: 'u_des1', type: 'casual', from, to: from, halfDay: false, reason: 'Test', backupId: '', status: 'Approved' }] } });
  assert.equal(r.data.leaves.find((l) => l.id === 'lv_e2e').status, 'Pending');
  const selfApprove = await sync('des', { leaves: { upsert: [{ ...r.data.leaves.find((l) => l.id === 'lv_e2e'), status: 'Approved' }] } });
  assert.equal(selfApprove.rejected, 1);
  const pm = await data('pm1');
  const approve = await sync('pm1', { leaves: { upsert: [{ ...pm.leaves.find((l) => l.id === 'lv_e2e'), status: 'Approved' }] } });
  const lv = approve.data.leaves.find((l) => l.id === 'lv_e2e');
  assert.equal(lv.status, 'Approved');
  assert.equal(lv.decidedBy, 'u_pm1');
  // A PM can't approve another PM's leave
  await sync('pm2', { leaves: { upsert: [{ id: 'lv_pm2', userId: 'u_pm2', type: 'casual', from, to: from, reason: 'PM leave', status: 'Pending' }] } });
  const pmApprove = await sync('pm1', { leaves: { upsert: [{ ...(await data('pm1')).leaves.find((l) => l.id === 'lv_pm2'), status: 'Approved' }] } });
  assert.equal(pmApprove.rejected, 1);
  // withdrawing your own pending request works
  const w = await sync('pm2', { leaves: { delete: ['lv_pm2'] } });
  assert.equal(w.rejected, 0);
  assert.ok(!w.data.leaves.find((l) => l.id === 'lv_pm2'));
});

/* ---------------- Attendance & EOD ---------------- */
test('attendance: own records only, IP is recorded by the server, EOD saved', async () => {
  const day = '2031-01-06';
  const att = { id: 'att_e2e', userId: 'u_des1', date: day, clockIn: Date.now() - 8 * 3600e3, clockOut: Date.now(), breaks: [], ip: '6.6.6.6', eodId: 'eod_e2e' };
  const eod = { id: 'eod_e2e', userId: 'u_des1', date: day, completedIds: [], completedSummary: 'E2E work', pending: [], blockers: '', loggedAt: Date.now() };
  const r = await sync('des', { attendance: { upsert: [att, { ...att, id: 'att_other', userId: 'u_ed1' }] }, eod: { upsert: [eod, { ...eod, id: 'eod_other', userId: 'u_ed1' }] } });
  assert.equal(r.rejected, 2);
  assert.notEqual(r.data.attendance.find((a) => a.id === 'att_e2e').ip, '6.6.6.6');
  assert.equal(r.data.eod.find((e) => e.id === 'eod_e2e').completedSummary, 'E2E work');
  const mine = await sync('admin', { attendance: { upsert: [{ ...att, id: 'att_admin', userId: 'u_admin', ip: 'spoofed' }] } });
  const rec = mine.data.attendance.find((a) => a.id === 'att_admin');
  assert.ok(rec.ip && rec.ip !== 'spoofed', 'admin clock-in IP recorded by the server too');
});

/* ---------------- Billing ---------------- */
test('activating a client generates a GST invoice (IGST for another state, 50-50 milestones)', async () => {
  const a = await data('admin');
  const base = a.clients.find((c) => c.id === 'c_urban');
  const client = { ...base, id: 'c_e2e', company: 'E2E Traders', status: 'Active', gstin: '27AAACE1234F1Z5', package: { ...base.package, monthlyFee: 100000, billingDay: 1, startDate: today().slice(0, 7) + '-01', endDate: '', paymentTerms: '50-50 Milestone' } };
  const r = await sync('admin', { clients: { upsert: [client] } });
  const inv = r.data.invoices.find((p) => p.clientId === 'c_e2e');
  assert.ok(inv, 'invoice generated');
  assert.equal(inv.subtotal, 100000);
  assert.equal(inv.igst, 18000);
  assert.equal(inv.cgst + inv.sgst, 0);
  assert.equal(inv.amountDue, 118000);
  assert.equal(inv.schedule.length, 2);
  assert.match(inv.invoiceNo, /^BPD\/\d\d-\d\d\/\d{4}$/);
});

test('same-state client gets CGST + SGST', async () => {
  const a = await data('admin');
  const apollo = a.invoices.find((p) => p.clientId === 'c_apollo');
  assert.equal(apollo.igst, 0);
  assert.equal(apollo.cgst, apollo.sgst);
  assert.equal(apollo.cgst + apollo.sgst, Math.round(apollo.subtotal * 0.18));
});

test('finance: partial then full payment, dispute, and server-assigned invoice numbers', async () => {
  const d = await data('fin');
  const inv = d.invoices.find((p) => p.clientId === 'c_e2e');
  // Below milestone 1 (59,000) after its due date → still overdue
  const short = { ...inv, amountPaid: 50000, transactions: [{ id: 't1', date: today(), amount: 50000, mode: 'UPI', ref: 'UPI/1' }] };
  let r = await sync('fin', { invoices: { upsert: [short] } });
  const m1Passed = inv.schedule[0].due < today();
  assert.equal(r.data.invoices.find((p) => p.id === inv.id).status, m1Passed ? 'Overdue' : 'Partially Paid');
  // Milestone 1 covered, milestone 2 not yet due → partially paid
  const part = { ...r.data.invoices.find((p) => p.id === inv.id), amountPaid: 59000, transactions: [{ id: 't1', date: today(), amount: 59000, mode: 'UPI', ref: 'UPI/1' }] };
  r = await sync('fin', { invoices: { upsert: [part] } });
  assert.equal(r.data.invoices.find((p) => p.id === inv.id).status, inv.schedule[1].due < today() ? 'Overdue' : 'Partially Paid');
  const disputed = { ...r.data.invoices.find((p) => p.id === inv.id), dispute: { open: true, reason: 'Scope' } };
  r = await sync('fin', { invoices: { upsert: [disputed] } });
  assert.equal(r.data.invoices.find((p) => p.id === inv.id).status, 'In Dispute');
  const cur = r.data.invoices.find((p) => p.id === inv.id);
  const paid = { ...cur, dispute: { open: false }, amountPaid: 1, transactions: [...cur.transactions, { id: 't2', date: today(), amount: 59000, mode: 'Bank Transfer', ref: 'NEFT/2' }] };
  r = await sync('fin', { invoices: { upsert: [paid] } });
  assert.equal(r.data.invoices.find((p) => p.id === inv.id).status, 'Paid');
  assert.equal(r.data.invoices.find((p) => p.id === inv.id).amountPaid, 118000, 'paid is computed from the recorded payments, not trusted from the browser');
  // two one-off invoices created "at the same time" get different numbers
  const one = { ...inv, id: 'inv_x1', invoiceNo: 'SAME', manual: true, amountPaid: 0, transactions: [], dispute: null };
  const [a1, a2] = await Promise.all([sync('fin', { invoices: { upsert: [one] } }), sync('fin', { invoices: { upsert: [{ ...one, id: 'inv_x2' }] } })]);
  const n1 = a2.data.invoices.find((p) => p.id === 'inv_x1').invoiceNo, n2 = a2.data.invoices.find((p) => p.id === 'inv_x2').invoiceNo;
  assert.notEqual(n1, 'SAME');
  assert.notEqual(n1, n2);
});

/* ---------------- Automations ---------------- */
test('cron needs the secret and is idempotent', async () => {
  assert.equal((await call('POST', '/cron')).status, 401);
  const r1 = await call('POST', '/cron', null, null, { 'x-cron-secret': CRON });
  assert.equal(r1.status, 200);
  const r2 = await call('POST', '/cron', null, null, { 'x-cron-secret': CRON });
  assert.equal(r2.body.created, 0);
});

test('reminder webhook: due reminders are POSTed once with ready-to-send text', async () => {
  const a = await data('admin');
  const url = `http://127.0.0.1:${hook.address().port}/hook`;
  hookHits = [];
  await sync('admin', {}, { settings: { ...a.settings, webhookUrl: url, autoWebhook: true } }); // saving settings runs automations right away
  await call('POST', '/cron', null, null, { 'x-cron-secret': CRON });
  assert.ok(hookHits.length > 0, 'at least one reminder sent');
  const hit = hookHits[0];
  assert.match(hit.event, /^invoice\.(overdue|due_soon)$/);
  assert.ok(hit.whatsappText.includes(hit.invoiceNo));
  assert.ok(hit.emailSubject && hit.emailBody);
  const count = hookHits.length;
  await call('POST', '/cron', null, null, { 'x-cron-secret': CRON });
  assert.equal(hookHits.length, count, 'no duplicate reminders');
  const d = await data('admin');
  assert.ok(d.invoices.some((p) => Object.values(p.reminders || {}).some((r) => r.channel === 'webhook')), 'invoices record the reminder');
  assert.ok(d.activity.some((x) => x.action === 'Reminder sent'), 'reminder logged');
  await sync('admin', {}, { settings: { ...(await data('admin')).settings, webhookUrl: '', autoWebhook: false } });
});

/* ---------------- People & passwords ---------------- */
test('password change, admin reset, and deactivated staff are locked out', async () => {
  assert.equal((await call('POST', '/auth/password', { current: 'wrong', next: 'NewPass#123' }, tokens.shoot)).status, 400);
  assert.equal((await call('POST', '/auth/password', { current: DEMO_PW, next: 'NewPass#123' }, tokens.shoot)).status, 200);
  assert.ok(await login('aditya@brightpixel.in', 'NewPass#123'));
  assert.equal((await call('POST', '/users/u_ed1/password', { password: 'EditorPass#1' }, tokens.des)).status, 403);
  assert.equal((await call('POST', '/users/u_ed1/password', { password: 'EditorPass#1' }, tokens.admin)).status, 200);
  const edTok = await login('imran@brightpixel.in', 'EditorPass#1');
  assert.ok(edTok);
  const ed = (await data('admin')).users.find((u) => u.id === 'u_ed1');
  await sync('admin', { users: { upsert: [{ ...ed, status: 'Inactive' }] } });
  assert.equal((await call('GET', '/data', null, edTok)).status, 401, 'existing session ends');
  assert.equal((await call('POST', '/auth/login', { email: 'imran@brightpixel.in', password: 'EditorPass#1' })).status, 401);
});

test('admin cannot demote themselves; duplicate emails are refused', async () => {
  const a = await data('admin');
  const me = a.users.find((u) => u.id === 'u_admin');
  const r = await sync('admin', { users: { upsert: [{ ...me, role: 'creative' }] } });
  assert.equal(r.data.users.find((u) => u.id === 'u_admin').role, 'admin');
  const dup = await call('POST', '/sync', { changes: { users: { upsert: [{ ...a.users.find((u) => u.id === 'u_des2'), email: 'arjun@brightpixel.in' }] } } }, tokens.admin);
  assert.equal(dup.status, 409);
});

/* ---------------- Audit trail ---------------- */
test('audit trail: actions attributed by the server and hash chain intact', async () => {
  await sync('des', {}, { activity: [{ action: 'Spoof', details: 'pretending', userId: 'u_admin', userName: 'Founder' }] });
  assert.equal((await call('GET', '/export', null, tokens.des)).status, 403);
  const full = (await call('GET', '/export', null, tokens.admin)).body;
  const spoof = full.activity.find((x) => x.action === 'Spoof');
  assert.equal(spoof.userId, 'u_des1');
  const { fnv } = require('../lib/shared');
  const L = full.activity;
  for (let i = L.length - 1; i >= 0; i--) {
    const e = L[i];
    assert.equal(e.hash, fnv(e.prev + '|' + e.ts + '|' + e.userId + '|' + e.action + '|' + e.details + '|' + e.entityId), `entry ${i} hash`);
    if (i < L.length - 1) assert.equal(e.prev, L[i + 1].hash, `entry ${i} chain`);
  }
  for (const needed of ['Workspace created', 'Signed in', 'Invoice generated', 'Password changed', 'Password set']) assert.ok(L.some((x) => x.action === needed), needed + ' logged');
});

/* ---------------- Validation & conflicts ---------------- */
test('validation: dangerous links, unknown values and missing fields are refused; long text is trimmed', async () => {
  const d = await data('admin');
  const t = d.tasks.find((x) => x.status === 'Backlog');
  const r = await sync('admin', { tasks: { upsert: [
    { ...t, link: 'javascript:alert(document.cookie)' },
    { ...t, id: 'tsk_badstatus', _rev: 0, status: 'Done-ish' },
    { ...t, id: 'tsk_notitle', _rev: 0, title: '' },
    { ...t, id: 'tsk_long', _rev: 0, title: 'x'.repeat(5000), link: 'https://drive.google.com/ok', sneaky: 'dropped' },
  ] } });
  assert.equal(r.invalid.length, 3);
  assert.match(r.invalid[0].error, /http/);
  const long = r.data.tasks.find((x) => x.id === 'tsk_long');
  assert.equal(long.title.length, 200);
  assert.ok(!('sneaky' in long), 'unknown fields are dropped');
  assert.equal(r.data.tasks.find((x) => x.id === t.id).link, t.link);
});

test('conflicts: when two people edit the same record, the second save is refused instead of overwriting', async () => {
  const a = await data('admin');
  const pmView = await data('pm1');
  const c = a.clients.find((x) => x.managerId === 'u_pm1');
  const first = await sync('admin', { clients: { upsert: [{ ...c, notes: 'Admin edit' }] } });
  assert.equal(first.conflicts.length, 0);
  const second = await sync('pm1', { clients: { upsert: [{ ...pmView.clients.find((x) => x.id === c.id), notes: 'PM edit from a stale copy' }] } });
  assert.equal(second.conflicts.length, 1);
  assert.equal(second.data.clients.find((x) => x.id === c.id).notes, 'Admin edit');
  const retry = await sync('pm1', { clients: { upsert: [{ ...second.data.clients.find((x) => x.id === c.id), notes: 'PM edit on the latest copy' }] } });
  assert.equal(retry.conflicts.length, 0);
  assert.equal(retry.data.clients.find((x) => x.id === c.id).notes, 'PM edit on the latest copy');
});

/* ---------------- Sessions, lockout, 2FA ---------------- */
test('sign out everywhere ends every session', async () => {
  const t1 = await login('karthik@brightpixel.in'), t2 = await login('karthik@brightpixel.in');
  assert.equal((await call('POST', '/auth/logout-all', null, t1)).status, 200);
  assert.equal((await call('GET', '/data', null, t1)).status, 401);
  assert.equal((await call('GET', '/data', null, t2)).status, 401);
});

test('account locks after repeated wrong passwords; an admin reset unlocks it', async () => {
  for (let i = 0; i < 8; i++) await call('POST', '/auth/login', { email: 'neha@brightpixel.in', password: 'wrong-' + i });
  const locked = await call('POST', '/auth/login', { email: 'neha@brightpixel.in', password: DEMO_PW });
  assert.equal(locked.status, 423, 'locked even with the right password');
  assert.equal((await call('POST', '/users/u_wr1/password', { password: 'Unlocked#2026' }, tokens.admin)).status, 200);
  assert.ok(await login('neha@brightpixel.in', 'Unlocked#2026'));
});

test('weak passwords are refused', async () => {
  assert.equal((await call('POST', '/users/u_wr1/password', { password: 'short1' }, tokens.admin)).status, 400);
  assert.equal((await call('POST', '/users/u_wr1/password', { password: 'onlyletterslong' }, tokens.admin)).status, 400);
});

test('two-factor: enrol, then sign-in needs a code; recovery codes work once; roles can be forced to use it', async () => {
  const totp = require('../lib/totp');
  const tok = await login('kavya@brightpixel.in');
  const setup = (await call('POST', '/auth/2fa/setup', null, tok)).body;
  assert.match(setup.otpauth, /^otpauth:\/\/totp\//);
  assert.equal((await call('POST', '/auth/2fa/enable', { code: '000000' }, tok)).status, 400);
  const en = await call('POST', '/auth/2fa/enable', { code: totp.code(setup.secret, Math.floor(Date.now() / 30000)) }, tok);
  assert.equal(en.status, 200);
  assert.equal(en.body.recoveryCodes.length, 8);
  assert.equal((await call('GET', '/data', null, tok)).status, 401, 'old sessions end when 2FA is turned on');
  const step1 = (await call('POST', '/auth/login', { email: 'kavya@brightpixel.in', password: DEMO_PW })).body;
  assert.ok(step1.needs2fa && step1.challenge && !step1.token);
  assert.equal((await call('POST', '/auth/2fa/verify', { challenge: step1.challenge, code: '123456' })).status, 401);
  const ok = await call('POST', '/auth/2fa/verify', { challenge: step1.challenge, code: totp.code(setup.secret, Math.floor(Date.now() / 30000)) });
  assert.ok(ok.body.token);
  const rc = en.body.recoveryCodes[0];
  const s2 = (await call('POST', '/auth/login', { email: 'kavya@brightpixel.in', password: DEMO_PW })).body;
  assert.ok((await call('POST', '/auth/2fa/verify', { challenge: s2.challenge, code: rc })).body.token, 'recovery code works');
  const s3 = (await call('POST', '/auth/login', { email: 'kavya@brightpixel.in', password: DEMO_PW })).body;
  assert.equal((await call('POST', '/auth/2fa/verify', { challenge: s3.challenge, code: rc })).status, 401, 'but only once');
  const users = (await data('admin')).users;
  assert.equal(users.find((u) => u.id === 'u_des2').twoFactor, true);
  assert.ok(!users.some((u) => 'totpSecret' in u || 'recoveryCodes' in u), '2FA secrets never leave the server');
  // Force 2FA for finance
  const a = await data('admin');
  await sync('admin', {}, { settings: { ...a.settings, require2fa: ['finance'] } });
  const f = await call('GET', '/data', null, tokens.fin);
  assert.equal(f.status, 403);
  assert.equal(f.body.code, '2FA_REQUIRED');
  assert.equal((await call('GET', '/auth/me', null, tokens.fin)).body.mustEnroll2fa, true);
  await sync('admin', {}, { settings: { ...(await data('admin')).settings, require2fa: [] } });
  assert.equal((await call('GET', '/data', null, tokens.fin)).status, 200);
});

/* ---------------- Email: reset, invites, notifications ---------------- */
test('forgot password: emailed one-time link, expires after use, ends old sessions', async () => {
  emails = [];
  const before = await login('karthik@brightpixel.in');
  assert.equal((await call('POST', '/auth/forgot', { email: 'nobody@nowhere.in' })).status, 200, 'same answer for unknown emails');
  await call('POST', '/auth/forgot', { email: 'karthik@brightpixel.in' });
  await new Promise((r) => setTimeout(r, 200));
  const mail = emails.find((e) => e.to[0] === 'karthik@brightpixel.in');
  assert.ok(mail, 'reset email sent');
  assert.equal(emails.length, 1, 'no email for unknown addresses');
  const url = new URL(mail.text.match(/http:\/\/app\.test\/#\/reset\?\S+/)[0].replace('#/reset?', 'reset?'));
  const token = url.searchParams.get('token');
  assert.equal((await call('POST', '/auth/reset', { email: 'karthik@brightpixel.in', token: 'forged', password: 'Brand#New2026' })).status, 400);
  const r = await call('POST', '/auth/reset', { email: 'karthik@brightpixel.in', token, password: 'Brand#New2026' });
  assert.ok(r.body.token);
  assert.equal((await call('POST', '/auth/reset', { email: 'karthik@brightpixel.in', token, password: 'Again#New2026' })).status, 400, 'link works once');
  assert.equal((await call('GET', '/data', null, before)).status, 401);
  assert.ok(await login('karthik@brightpixel.in', 'Brand#New2026'));
});

test('invites and leave notifications are emailed', async () => {
  const a = await data('admin');
  const base = a.users.find((u) => u.id === 'u_des1');
  await sync('admin', { users: { upsert: [{ ...base, id: 'u_new', _rev: 0, name: 'New Hire', email: 'newhire@brightpixel.in', twoFactor: true }] } });
  emails = [];
  assert.equal((await call('POST', '/users/u_new/invite', null, tokens.admin)).status, 200);
  assert.match(emails[0].subject, /invited you/);
  const token = emails[0].text.match(/token=([a-f0-9]+)/)[1];
  const r = await call('POST', '/auth/reset', { email: 'newhire@brightpixel.in', token, password: 'Welcome#2026' });
  assert.ok(r.body.token, 'invite link sets the first password');
  assert.equal((await data('admin')).users.find((u) => u.id === 'u_new').twoFactor, undefined, 'browser cannot switch 2FA on for someone');
  emails = [];
  await sync('des', { leaves: { upsert: [{ id: 'lv_mail', userId: 'u_des1', type: 'casual', from: '2031-02-03', to: '2031-02-03', reason: 'Errand', status: 'Pending' }] } });
  await new Promise((r2) => setTimeout(r2, 300));
  assert.ok(emails.some((e) => /Leave request: Arjun/.test(e.subject)), 'approvers emailed');
  emails = [];
  await sync('pm1', { leaves: { upsert: [{ ...(await data('pm1')).leaves.find((l) => l.id === 'lv_mail'), status: 'Approved' }] } });
  await new Promise((r2) => setTimeout(r2, 300));
  assert.ok(emails.some((e) => e.to[0] === 'arjun@brightpixel.in' && /approved/.test(e.subject)));
});

/* ---------------- Files ---------------- */
const upload = async (who, bytes, type, scope = 'general', name = 'file.pdf') => {
  const res = await fetch(`${BASE}/files?name=${encodeURIComponent(name)}&scope=${scope}`, { method: 'POST', headers: { Authorization: 'Bearer ' + tokens[who], 'Content-Type': type }, body: bytes });
  return { status: res.status, body: await res.json() };
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
let generalFile, hrFile;

test('uploads: type and content checked, HR documents restricted, downloads need a fresh signed link', async () => {
  assert.equal((await upload('des', Buffer.from('MZ\x90\x00 not a pdf'), 'application/pdf')).status, 415, 'renamed .exe refused');
  assert.equal((await upload('des', Buffer.from('<script>'), 'text/html')).status, 415, 'html refused');
  assert.equal((await upload('des', PDF, 'application/pdf', 'hr')).status, 403, 'only admin/finance upload HR docs');
  const g = await upload('des', PDF, 'application/pdf', 'general', 'Brief v2.pdf');
  assert.equal(g.status, 200);
  assert.match(g.body.ref, /^file:[a-f0-9]{24}\|Brief v2\.pdf$/);
  generalFile = g.body;
  hrFile = (await upload('admin', PDF, 'application/pdf', 'hr', 'NDA.pdf')).body;
  const link = (await call('GET', `/files/${generalFile.id}/link`, null, tokens.pm2)).body.url;
  const dl = await fetch(`http://127.0.0.1:${PORT}${link}`);
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(await dl.arrayBuffer()).toString(), PDF.toString());
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/files/${generalFile.id}/raw?sig=forged`)).status, 403);
  assert.equal((await call('GET', `/files/${hrFile.id}/link`, null, tokens.des)).status, 404, 'designers cannot see HR docs');
  assert.equal((await call('GET', `/files/${hrFile.id}/link`, null, tokens.admin)).status, 200);
});

/* ---------------- Client portal ---------------- */
test('client portal: PM creates a login; the client sees only their own account', async () => {
  const pm = await data('pm1');
  const apollo = pm.clients.find((c) => c.id === 'c_apollo');
  const green = (await data('admin')).clients.find((c) => c.id === 'c_green'); // Sneha's client
  const base = { name: 'Dr. Ramesh Iyer', email: 'ramesh@apollodental.in', phone: '', role: 'client', clientId: 'c_apollo', designation: 'Client', department: 'Management', workArrangement: 'Full-Time In-Office', status: 'Active', joinDate: today(), leaveQuota: { casual: 0, sick: 0, pto: 0 } };
  const r = await sync('pm1', { users: { upsert: [{ id: 'u_cl_apollo', ...base }, { id: 'u_cl_green', ...base, email: 'x@green.in', clientId: green.id }] } });
  assert.equal(r.rejected, 1, 'a PM cannot create logins for another PM’s client');
  assert.equal((await call('POST', '/users/u_cl_apollo/password', { password: 'Client#Pass2026' }, tokens.pm1)).status, 200);
  assert.equal((await call('POST', '/users/u_cl_apollo/password', { password: 'Client#Pass2026' }, tokens.pm2)).status, 403);
  tokens.client = await login('ramesh@apollodental.in', 'Client#Pass2026');
  const d = await data('client');
  assert.deepEqual(d.clients.map((c) => c.id), ['c_apollo']);
  assert.equal(d.clients[0].notes, '', 'internal notes hidden');
  assert.ok(d.invoices.length > 0 && d.invoices.every((p) => p.clientId === 'c_apollo'));
  assert.ok(d.tasks.length > 0 && d.tasks.every((t) => t.clientId === 'c_apollo' && t.timeLogs.length === 0));
  assert.equal(d.attendance.length + d.leaves.length + d.eod.length, 0);
  assert.ok(d.users.length <= 2 && d.users.every((u) => !u.ctc));
  assert.ok(!('webhookUrl' in d.settings) && !('graceMinutes' in d.settings));
  assert.equal((await call('GET', '/export', null, tokens.client)).status, 403);
  assert.equal((await upload('client', PDF, 'application/pdf')).status, 403);
  assert.ok(apollo);
});

test('client portal: approve, request changes (needs a comment, counts a revision), rate the month', async () => {
  const pm = await data('pm1');
  // PM sends a deliverable for approval, with the uploaded brief attached
  const cand = pm.tasks.find((t) => t.clientId === 'c_apollo' && t.type !== 'shoot' && !['Client Approval', 'Ready to Publish', 'Published'].includes(t.status));
  const withFile = { ...cand, status: 'Client Approval', link: generalFile.ref };
  const pr = await sync('pm1', { tasks: { upsert: [withFile] } });
  let d = await data('client');
  let t = d.tasks.find((x) => x.id === withFile.id);
  assert.equal((await call('GET', `/files/${generalFile.id}/link`, null, tokens.client)).status, 200, 'client can open files on their deliverables');
  assert.equal((await call('GET', `/files/${hrFile.id}/link`, null, tokens.client)).status, 404);
  // Changes without a comment are refused
  let r = await sync('client', { tasks: { upsert: [{ ...t, status: 'Design / Editing' }] } });
  assert.equal(r.rejected, 1);
  t = r.data.tasks.find((x) => x.id === t.id);
  r = await sync('client', { tasks: { upsert: [{ ...t, status: 'Design / Editing', title: 'Renamed by client', clientComments: [...(t.clientComments || []), { id: 'cc1', text: 'Use the blue logo', action: 'changes' }] }] } });
  t = r.data.tasks.find((x) => x.id === t.id);
  assert.equal(t.status, 'Design / Editing');
  assert.equal(t.revisions, withFile.revisions + 1);
  assert.equal(t.title, withFile.title, 'clients cannot rename tasks');
  assert.equal(t.clientComments.slice(-1)[0].byName, 'Dr. Ramesh Iyer');
  // Can't approve something that isn't waiting for approval
  assert.equal((await sync('client', { tasks: { upsert: [{ ...t, status: 'Published' }] } })).rejected, 1);
  // Approve another pending item (if there is one) or send this back and approve it
  const pm2 = await data('pm1');
  const back = pm2.tasks.find((x) => x.id === t.id);
  await sync('pm1', { tasks: { upsert: [{ ...back, status: 'Client Approval' }] } });
  d = await data('client');
  t = d.tasks.find((x) => x.id === t.id);
  r = await sync('client', { tasks: { upsert: [{ ...t, status: 'Ready to Publish' }] } });
  assert.equal(r.data.tasks.find((x) => x.id === t.id).status, 'Ready to Publish');
  // Invoices are read-only for clients
  const inv = d.invoices[0];
  assert.equal((await sync('client', { invoices: { upsert: [{ ...inv, amountDue: 1 }] } })).rejected, 1);
  // Monthly rating is appended with the server's attribution
  const c = d.clients[0];
  r = await sync('client', { clients: { upsert: [{ ...c, company: 'Hacked', notes: 'x', feedback: [...c.feedback, { id: 'fb_client', month: '2026-08', csat: 5, nps: 10, notes: 'Great month', by: 'u_admin' }] }] } });
  const saved = (await data('admin')).clients.find((x) => x.id === 'c_apollo');
  assert.equal(saved.company, 'Apollo Dental Care');
  const fb = saved.feedback.find((f) => f.id === 'fb_client');
  assert.equal(fb.by, 'u_cl_apollo');
  assert.ok(pr);
});

/* ---------------- Web security ---------------- */
test('security headers: CSP without inline scripts, no framing, no server fingerprint', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const h = await (await fetch(`${BASE}/health`)).json();
  assert.ok(h.ok && h.version);
});

/* ---------------- Abuse protection (last: it trips the limiter) ---------------- */
test('repeated failed logins are rate-limited', async () => {
  let last;
  for (let i = 0; i < 130; i++) { last = await call('POST', '/auth/login', { email: 'x@y.in', password: 'nope' }); if (last.status === 429) break; }
  assert.equal(last.status, 429);
});
