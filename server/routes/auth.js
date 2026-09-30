/* Setup, sign-in (with lockout and 2FA), password change/reset, 2FA enrolment */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const cfg = require('../lib/config');
const db = require('../lib/db');
const shared = require('../lib/shared');
const totp = require('../lib/totp');
const notify = require('../lib/notify');
const A = require('../lib/auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clientIp = (req) => String(req.ip || '').replace(/^::ffff:/, '');
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT) || 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts — try again in 15 minutes' } });
const strong = (p) => typeof p === 'string' && p.length >= 10 && /[a-z]/i.test(p) && /\d|[^a-z0-9]/i.test(p);
const WEAK = 'Use at least 10 characters, including a number or symbol';
const audit = (u, action, details) => db.appendActivity([{ userId: u._id || u.id, userName: u.name, action, details, entity: 'employee', entityId: u._id || u.id }]);
const hashCode = (c) => crypto.createHash('sha256').update(String(c).replace(/[\s-]/g, '').toLowerCase()).digest('hex');

router.get('/setup-status', wrap(async (req, res) => {
  const s = await db.getSettings();
  res.json({ needsSetup: (await db.col('users').countDocuments()) === 0, agencyName: s ? s.agencyName : 'AgencyDesk', emailEnabled: cfg.emailEnabled && !!cfg.appUrl });
}));

/* First run only: creates the workspace and the first admin */
router.post('/setup', limiter, wrap(async (req, res) => {
  const { agencyName, name, email, password, sampleData, demoPassword } = req.body || {};
  if (!name || !/^\S+@\S+\.\S+$/.test(email || '')) return res.status(400).json({ error: 'Your name and a valid email are required' });
  if (!strong(password) || (demoPassword && !strong(demoPassword))) return res.status(400).json({ error: WEAK });
  await db.withLock(async () => {
    if (await db.col('users').countDocuments()) throw Object.assign(new Error('Already set up'), { status: 409 });
    const data = shared.buildSampleData();
    data.settings.agencyName = String(agencyName || data.settings.agencyName).slice(0, 100);
    Object.assign(data.settings, { emailReminders: false, notifyLeave: true, require2fa: [] });
    const hash = await bcrypt.hash(password, 12);
    const demoHash = sampleData && demoPassword ? await bcrypt.hash(demoPassword, 12) : null;
    const admin = { ...data.users.find((u) => u.id === 'u_admin'), name: String(name).slice(0, 100), email: String(email).trim() };
    let users = [admin];
    if (sampleData) users = data.users.map((u) => (u.id === 'u_admin' ? admin : u));
    else {
      Object.assign(data, { clients: [], invoices: [], tasks: [], attendance: [], leaves: [], eod: [] });
      Object.assign(data.settings, { billingStartMonth: shared.todayISO().slice(0, 7), attendanceStartDate: shared.todayISO(), invoiceSeq: 0, gstin: '', bankDetails: '', upiId: '', agencyAddress: '', agencyEmail: admin.email, agencyPhone: '' });
      Object.assign(admin, { ctc: 0, idProof: { type: 'PAN', number: '', verified: false }, docs: { nda: '', contract: '' } });
    }
    await db.saveSettings(data.settings);
    await db.upsertMany('users', users.map((u) => ({ ...u, emailLower: u.email.toLowerCase(), passwordHash: u.id === 'u_admin' ? hash : demoHash, tokenVersion: 0 })));
    for (const c of ['clients', 'invoices', 'tasks', 'attendance', 'leaves', 'eod']) await db.upsertMany(c, data[c]);
    const acts = sampleData ? data.activity.slice().reverse() : [];
    acts.push({ userId: 'u_admin', userName: admin.name, action: 'Workspace created', details: `${data.settings.agencyName} set up${sampleData ? ' with sample data' : ''}`, ts: Date.now() });
    await db.appendActivity(acts);
  });
  const u = await db.col('users').findOne({ _id: 'u_admin' });
  res.json({ token: A.sign(u), user: A.publicUser(u) });
}));

/* Step 1: email + password. If 2FA is on, returns a short-lived challenge instead of a session. */
router.post('/auth/login', limiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const raw = await db.col('users').findOne({ emailLower: String(email || '').toLowerCase().trim() });
  if (raw && A.isLocked(raw)) return res.status(423).json({ error: `Too many wrong passwords. This account is locked for ${A.LOCK_MINUTES} minutes — or ask an admin to reset your password.` });
  const ok = raw && raw.passwordHash && raw.status !== 'Inactive' && (await bcrypt.compare(String(password || ''), raw.passwordHash));
  if (!ok) { if (raw) await A.recordFailure(raw); return res.status(401).json({ error: 'Wrong email or password' }); }
  await A.clearFailures(raw);
  if (raw.twoFactor) return res.json({ needs2fa: true, challenge: A.signChallenge(raw) });
  await audit(raw, 'Signed in', `${raw.name} signed in from ${clientIp(req)}`);
  res.json({ token: A.sign(raw), user: A.publicUser(raw), mustEnroll2fa: await A.mustEnroll2fa(raw) });
}));

/* Step 2: authenticator code (or a one-time recovery code) */
router.post('/auth/2fa/verify', limiter, wrap(async (req, res) => {
  const { challenge, code } = req.body || {};
  const p = A.verifyToken(challenge, '2fa');
  if (!p) return res.status(401).json({ error: 'That took too long — sign in again' });
  const raw = await db.col('users').findOne({ _id: p.sub });
  if (!raw || (raw.tokenVersion || 0) !== p.tv || A.isLocked(raw)) return res.status(401).json({ error: 'Sign in again' });
  let ok = totp.verify(raw.totpSecret, code);
  let usedRecovery = false;
  if (!ok && (raw.recoveryCodes || []).includes(hashCode(code))) {
    ok = usedRecovery = true;
    await db.col('users').updateOne({ _id: raw._id }, { $pull: { recoveryCodes: hashCode(code) } });
  }
  if (!ok) { await A.recordFailure(raw); return res.status(401).json({ error: 'That code didn’t work — check your authenticator app' }); }
  await A.clearFailures(raw);
  await audit(raw, 'Signed in', `${raw.name} signed in with 2FA${usedRecovery ? ' (recovery code)' : ''} from ${clientIp(req)}`);
  res.json({ token: A.sign(raw), user: A.publicUser(raw), recoveryCodesLeft: (raw.recoveryCodes || []).length - (usedRecovery ? 1 : 0) });
}));

router.get('/auth/me', A.auth({ allowUnenrolled: true }), wrap(async (req, res) => {
  res.json({ user: A.publicUser(req.rawUser), mustEnroll2fa: await A.mustEnroll2fa(req.rawUser) });
}));

router.post('/auth/password', A.auth({ allowUnenrolled: true }), wrap(async (req, res) => {
  const { current, next } = req.body || {};
  const raw = req.rawUser;
  if (!(await bcrypt.compare(String(current || ''), raw.passwordHash || ''))) return res.status(400).json({ error: 'Current password is wrong' });
  if (!strong(next)) return res.status(400).json({ error: WEAK });
  await db.col('users').updateOne({ _id: raw._id }, { $set: { passwordHash: await bcrypt.hash(next, 12) }, $inc: { tokenVersion: 1 } });
  await audit(raw, 'Password changed', `${raw.name} changed their password (other sessions signed out)`);
  const fresh = await db.col('users').findOne({ _id: raw._id });
  res.json({ ok: true, token: A.sign(fresh) });
}));

/* Ends every session for this account, including this one */
router.post('/auth/logout-all', A.auth({ allowUnenrolled: true }), wrap(async (req, res) => {
  await A.bumpTokenVersion(req.rawUser._id);
  await audit(req.rawUser, 'Signed out everywhere', `${req.rawUser.name} ended all sessions`);
  res.json({ ok: true });
}));

/* Forgot password → emailed link. Always answers the same way so it can't be used to discover accounts. */
router.post('/auth/forgot', limiter, wrap(async (req, res) => {
  const raw = await db.col('users').findOne({ emailLower: String((req.body || {}).email || '').toLowerCase().trim() });
  if (raw && raw.status !== 'Inactive' && cfg.emailEnabled && cfg.appUrl) {
    await notify.sendReset(raw);
    await audit(raw, 'Password reset requested', `Reset link emailed to ${raw.email}`);
  }
  res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
}));

router.post('/auth/reset', limiter, wrap(async (req, res) => {
  const { email, token, password } = req.body || {};
  const raw = await db.col('users').findOne({ emailLower: String(email || '').toLowerCase().trim() });
  const valid = raw && raw.resetTokenHash && raw.resetExpires > Date.now()
    && crypto.timingSafeEqual(Buffer.from(raw.resetTokenHash), Buffer.from(crypto.createHash('sha256').update(String(token || '')).digest('hex')));
  if (!valid) return res.status(400).json({ error: 'This link has expired or was already used. Ask for a new one.' });
  if (!strong(password)) return res.status(400).json({ error: WEAK });
  await db.col('users').updateOne({ _id: raw._id }, { $set: { passwordHash: await bcrypt.hash(password, 12), resetTokenHash: null, resetExpires: null, failedLogins: 0, lockedUntil: null }, $inc: { tokenVersion: 1 } });
  await audit(raw, 'Password reset', `${raw.name} set a new password from an emailed link`);
  const fresh = await db.col('users').findOne({ _id: raw._id });
  if (fresh.twoFactor) return res.json({ needs2fa: true, challenge: A.signChallenge(fresh) });
  res.json({ token: A.sign(fresh), user: A.publicUser(fresh) });
}));

/* ---------- 2FA enrolment ---------- */
router.post('/auth/2fa/setup', A.auth({ allowUnenrolled: true }), wrap(async (req, res) => {
  const raw = req.rawUser;
  const secret = totp.generateSecret();
  await db.col('users').updateOne({ _id: raw._id }, { $set: { totpPending: secret } });
  const s = (await db.getSettings()) || {};
  res.json({ secret, otpauth: totp.otpauthUrl(secret, raw.email, s.agencyName || 'AgencyDesk') });
}));

router.post('/auth/2fa/enable', A.auth({ allowUnenrolled: true }), wrap(async (req, res) => {
  const raw = req.rawUser;
  if (!raw.totpPending || !totp.verify(raw.totpPending, (req.body || {}).code)) return res.status(400).json({ error: 'That code didn’t match — try the newest code in your app' });
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
  await db.col('users').updateOne({ _id: raw._id }, { $set: { totpSecret: raw.totpPending, totpPending: null, twoFactor: true, recoveryCodes: codes.map(hashCode) }, $inc: { tokenVersion: 1 } });
  await audit(raw, '2FA enabled', `${raw.name} turned on two-factor authentication`);
  const fresh = await db.col('users').findOne({ _id: raw._id });
  res.json({ ok: true, recoveryCodes: codes, token: A.sign(fresh) });
}));

router.post('/auth/2fa/disable', A.auth({ allowUnenrolled: true }), wrap(async (req, res) => {
  const raw = req.rawUser;
  const { password, code } = req.body || {};
  if (!(await bcrypt.compare(String(password || ''), raw.passwordHash || '')) || !totp.verify(raw.totpSecret, code)) return res.status(400).json({ error: 'Password or code is wrong' });
  if (await A.mustEnroll2fa({ ...raw, twoFactor: false })) return res.status(400).json({ error: 'Your role requires two-factor authentication' });
  await db.col('users').updateOne({ _id: raw._id }, { $set: { twoFactor: false, totpSecret: null, recoveryCodes: [] }, $inc: { tokenVersion: 1 } });
  await audit(raw, '2FA disabled', `${raw.name} turned off two-factor authentication`);
  const fresh = await db.col('users').findOne({ _id: raw._id });
  res.json({ ok: true, token: A.sign(fresh) });
}));

module.exports = { router, strong, WEAK };
