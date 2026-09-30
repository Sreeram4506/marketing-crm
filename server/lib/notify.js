/* Email notifications triggered by changes. Fire-and-forget: they never slow
   down or fail a save. */
const crypto = require('crypto');
const cfg = require('./config');
const db = require('./db');
const email = require('./email');
const shared = require('./shared');
const log = require('./log');

const appLink = (hash) => (cfg.appUrl ? `${cfg.appUrl}/#${hash}` : '');

/* One-time link to set a password (invites last 3 days, resets 30 minutes) */
async function issuePasswordLink(userId, { minutes }) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.col('users').updateOne({ _id: userId }, { $set: { resetTokenHash: crypto.createHash('sha256').update(token).digest('hex'), resetExpires: Date.now() + minutes * 60000 } });
  const u = await db.col('users').findOne({ _id: userId });
  return appLink(`/reset?email=${encodeURIComponent(u.email)}&token=${token}`);
}

async function sendInvite(userId, inviter) {
  const u = await db.col('users').findOne({ _id: userId });
  const s = (await db.getSettings()) || {};
  const url = await issuePasswordLink(userId, { minutes: 3 * 24 * 60 });
  if (!url) return false;
  const portal = u.role === 'client';
  return email.send({ to: u.email, subject: `${inviter.name} invited you to ${s.agencyName || 'AgencyDesk'}`,
    text: `Hi ${u.name.split(' ')[0]},\n\n${inviter.name} has set up ${portal ? 'a client portal login for you, where you can approve deliverables, see invoices and share feedback' : 'your AgencyDesk account'}.\n\nChoose your password using the button below. The link works for 3 days.`,
    button: { label: 'Set your password', url } });
}

async function sendReset(raw) {
  const url = await issuePasswordLink(raw._id, { minutes: 30 });
  if (!url) return false;
  return email.send({ to: raw.email, subject: 'Reset your AgencyDesk password',
    text: `Hi ${raw.name.split(' ')[0]},\n\nSomeone (hopefully you) asked to reset your password. The link below works for 30 minutes. If it wasn't you, ignore this email — your password stays the same.`,
    button: { label: 'Choose a new password', url } });
}

/* Notes collected during a sync → emails */
async function afterSync(notes, actor) {
  if (!notes.length || !email.enabled()) return;
  try {
    const s = (await db.getSettings()) || {};
    const users = await db.col('users').find({}).toArray();
    const byId = new Map(users.map((u) => [u._id, u]));
    for (const n of notes) {
      if ((n.type === 'leave-requested' || n.type === 'leave-decided') && s.notifyLeave === false) continue;
      if (n.type === 'leave-requested') {
        const l = await db.col('leaves').findOne({ _id: n.leaveId });
        const who = byId.get(l.userId);
        const approvers = users.filter((u) => u.status !== 'Inactive' && u._id !== l.userId && (u.role === 'admin' || (u.role === 'pm' && ['creative', 'shoot'].includes(who.role))));
        const days = shared.leaveDays(l, s);
        for (const a of approvers) await email.send({ to: a.email, subject: `Leave request: ${who.name}, ${days} day(s)`, text: `${who.name} asked for ${l.type} leave from ${l.from} to ${l.to} (${days} day(s)).\nReason: ${l.reason || '—'}`, button: appLink('/team?tab=leave') ? { label: 'Review request', url: appLink('/team?tab=leave') } : null });
      }
      if (n.type === 'leave-decided') {
        const l = await db.col('leaves').findOne({ _id: n.leaveId });
        const who = byId.get(l.userId);
        await email.send({ to: who.email, subject: `Your leave was ${l.status.toLowerCase()}`, text: `Hi ${who.name.split(' ')[0]},\n\n${actor.name} ${l.status.toLowerCase()} your leave from ${l.from} to ${l.to}.` });
      }
      if (n.type === 'client-decision') {
        const t = await db.col('tasks').findOne({ _id: n.taskId });
        const c = await db.col('clients').findOne({ _id: t.clientId });
        const last = (t.clientComments || []).slice(-1)[0] || {};
        const to = [byId.get(c.managerId), byId.get(t.assigneeId)].filter(Boolean);
        for (const u of to) await email.send({ to: u.email, subject: `${c.company} ${n.action === 'approved' ? 'approved' : 'requested changes to'} “${t.title}”`, text: `${actor.name} (${c.company}) ${n.action === 'approved' ? 'approved' : 'asked for changes on'} “${t.title}”.${last.text ? `\n\n“${last.text}”` : ''}`, button: appLink('/tasks') ? { label: 'Open the board', url: appLink('/tasks') } : null });
      }
      if (n.type === 'client-feedback') {
        const c = await db.col('clients').findOne({ _id: n.clientId });
        const m = byId.get(c.managerId);
        if (m) await email.send({ to: m.email, subject: `${c.company} rated ${n.entry.month}: ${n.entry.csat}/5, NPS ${n.entry.nps}`, text: `${actor.name} left a review for ${n.entry.month}.\n\nCSAT: ${n.entry.csat}/5\nNPS: ${n.entry.nps}/10\n${n.entry.notes ? `\n“${n.entry.notes}”` : ''}` });
      }
    }
  } catch (e) { log.error('Notification failed', { error: e.message }); }
}

module.exports = { sendInvite, sendReset, afterSync, appLink };
