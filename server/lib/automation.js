/* Server-side automations: monthly invoices, overdue status, reminder webhooks.
   Runs hourly while the server is awake, after relevant edits, and via /api/cron. */
const shared = require('./shared');
const db = require('./db');
const email = require('./email');
const log = require('./log');

let lastRun = 0;

async function runAutomations({ force = false, sendNow = false } = {}) {
  if (!force && Date.now() - lastRun < 5 * 60 * 1000) return { skipped: true };
  return db.withLock(async () => {
    lastRun = Date.now();
    const settings = await db.getSettings();
    if (!settings) return { skipped: true };
    const data = { settings, clients: (await db.col('clients').find({}).toArray()).map(db.fromDoc), invoices: (await db.col('invoices').find({}).toArray()).map(db.fromDoc), activity: [], session: {} };
    const before = new Map(data.invoices.map((p) => [p.id, JSON.stringify(p)]));
    const seqBefore = settings.invoiceSeq;
    shared.generateInvoices(data);
    shared.refreshPaymentStatuses(data);
    const reminders = await sendReminders(data, { force: sendNow });
    const changed = data.invoices.filter((p) => before.get(p.id) !== JSON.stringify(p));
    changed.forEach((p) => { p._rev = (p._rev || 0) + 1; }); // automated edits count for conflict detection
    await db.upsertMany('invoices', changed);
    if (data.settings.invoiceSeq !== seqBefore) await db.saveSettings(data.settings);
    // generateInvoices logs newest-first; store oldest-first so the chain reads in order
    await db.appendActivity(data.activity.slice().reverse().map((a) => ({ ...a, userId: 'system', userName: 'System' })));
    return { created: changed.filter((p) => !before.has(p.id)).length, updated: changed.length, reminders };
  });
}

/* Send due reminders: POST to the agency's webhook (WhatsApp via Zapier / Make / Gupshup / Twilio)
   and/or email the client directly. A reminder is marked sent if any channel succeeds. */
async function sendReminders(data, { force = false } = {}) {
  const s = data.settings;
  const useHook = !!s.webhookUrl && (s.autoWebhook || force);
  const useEmail = email.enabled() && (s.emailReminders || force);
  if (!useHook && !useEmail) return 0;
  const due = shared.remindersDue(data.invoices);
  let sent = 0;
  for (const r of due) {
    const c = data.clients.find((x) => x.id === r.p.clientId) || {};
    const msg = shared.reminderMessage(r.p, c, s, s.agencyName);
    const channels = [];
    if (useHook) {
      try {
        const res = await fetch(s.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
          body: JSON.stringify({ event: r.kind === 'overdue' ? 'invoice.overdue' : 'invoice.due_soon', invoiceNo: r.p.invoiceNo, client: c.company, contact: c.contact,
            email: c.email, whatsapp: c.whatsapp, amountDue: shared.balance(r.p), dueDate: r.milestone.due, whatsappText: msg.whatsapp, emailSubject: msg.subject, emailBody: msg.email }) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        channels.push('webhook');
      } catch (e) { log.warn('Reminder webhook failed', { invoice: r.p.invoiceNo, error: e.message }); }
    }
    if (useEmail && c.email && (await email.send({ to: c.email, subject: msg.subject, text: msg.email, replyTo: s.agencyEmail || undefined }))) channels.push('email');
    if (!channels.length) continue;
    r.p.reminders = { ...(r.p.reminders || {}), [r.key]: { at: Date.now(), channel: channels.join('+'), by: 'system' } };
    data.activity.unshift({ action: 'Reminder sent', details: `${r.kind === 'overdue' ? 'Overdue' : 'Pre-due'} reminder for ${r.p.invoiceNo} (${c.company}) via ${channels.join(' + ')}`, entity: 'payment', entityId: r.p.id, clientId: c.id, ts: Date.now() });
    sent++;
  }
  return sent;
}

module.exports = { runAutomations };
