/* Staff & portal logins (set password, invite, end sessions), reminders, webhook test, cron */
const express = require('express');
const bcrypt = require('bcryptjs');
const cfg = require('../lib/config');
const db = require('../lib/db');
const notify = require('../lib/notify');
const { runAutomations } = require('../lib/automation');
const A = require('../lib/auth');
const { strong, WEAK } = require('./auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const audit = (me, action, details, entityId) => db.appendActivity([{ userId: me.id, userName: me.name, action, details, entity: 'employee', entityId }]);

/* Admins manage every login; PMs manage portal logins for their own clients */
async function manageable(req, res) {
  const u = await db.col('users').findOne({ _id: req.params.id });
  if (!u) { res.status(404).json({ error: 'No such person' }); return null; }
  if (req.user.role === 'admin') return u;
  if (req.user.role === 'pm' && u.role === 'client') {
    const c = await db.col('clients').findOne({ _id: u.clientId });
    if (c && c.managerId === req.user.id) return u;
  }
  res.status(403).json({ error: 'Not allowed' });
  return null;
}

router.post('/users/:id/password', A.auth(), A.roles('admin', 'pm'), wrap(async (req, res) => {
  const u = await manageable(req, res); if (!u) return;
  if (!strong((req.body || {}).password)) return res.status(400).json({ error: WEAK });
  await db.col('users').updateOne({ _id: u._id }, { $set: { passwordHash: await bcrypt.hash(req.body.password, 12), failedLogins: 0, lockedUntil: null }, $inc: { tokenVersion: 1 } });
  await audit(req.user, 'Password set', `Login password set for ${u.name} (their other sessions ended)`, u._id);
  res.json({ ok: true });
}));

router.post('/users/:id/invite', A.auth(), A.roles('admin', 'pm'), wrap(async (req, res) => {
  const u = await manageable(req, res); if (!u) return;
  if (!cfg.emailEnabled || !cfg.appUrl) return res.status(400).json({ error: 'Email isn’t set up on the server (RESEND_API_KEY, EMAIL_FROM, APP_URL). Set a password instead.' });
  if (!(await notify.sendInvite(u._id, req.user))) return res.status(502).json({ error: 'The invite email could not be sent — try again or set a password instead' });
  await audit(req.user, 'Invite sent', `Invite emailed to ${u.name} <${u.email}>`, u._id);
  res.json({ ok: true });
}));

/* Admin: end all of someone's sessions (lost laptop, leaver) */
router.post('/users/:id/logout', A.auth(), A.roles('admin'), wrap(async (req, res) => {
  const u = await manageable(req, res); if (!u) return;
  await A.bumpTokenVersion(u._id);
  await audit(req.user, 'Sessions ended', `All sessions ended for ${u.name}`, u._id);
  res.json({ ok: true });
}));

/* Admin: reset someone's 2FA if they lose their phone */
router.post('/users/:id/reset-2fa', A.auth(), A.roles('admin'), wrap(async (req, res) => {
  const u = await manageable(req, res); if (!u) return;
  await db.col('users').updateOne({ _id: u._id }, { $set: { twoFactor: false, totpSecret: null, recoveryCodes: [] }, $inc: { tokenVersion: 1 } });
  await audit(req.user, '2FA reset', `Two-factor authentication reset for ${u.name}`, u._id);
  res.json({ ok: true });
}));

/* Send every due payment reminder now (webhook and/or email) */
router.post('/reminders/send', A.auth(), A.roles('admin', 'finance'), wrap(async (req, res) => {
  res.json(await runAutomations({ force: true, sendNow: true }));
}));

router.post('/webhook/test', A.auth(), A.roles('admin'), wrap(async (req, res) => {
  const s = await db.getSettings();
  if (!s.webhookUrl) return res.status(400).json({ error: 'Save a webhook URL first' });
  try {
    const r = await fetch(s.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ event: 'test', from: s.agencyName, at: new Date().toISOString() }) });
    res.json({ ok: r.ok, status: r.status });
  } catch (e) { res.json({ ok: false, error: e.message }); }
}));

/* Hit this from a Render Cron Job (or any scheduler) so invoices and reminders run even when nobody opens the app */
router.post('/cron', wrap(async (req, res) => {
  if (!cfg.cronSecret || req.headers['x-cron-secret'] !== cfg.cronSecret) return res.status(401).json({ error: 'Bad cron secret' });
  res.json(await runAutomations({ force: true }));
}));

module.exports = { router };
