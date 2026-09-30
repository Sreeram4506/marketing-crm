/* Sessions: signed JWTs that carry the user's token version, so changing a
   password, resetting it, or "sign out everywhere" instantly ends old sessions. */
const jwt = require('jsonwebtoken');
const cfg = require('./config');
const db = require('./db');

const SESSION_HOURS = 12;
const MAX_FAILED = 8;          // failed logins before the account locks
const LOCK_MINUTES = 15;

const sign = (u) => jwt.sign({ sub: u._id || u.id, tv: u.tokenVersion || 0, purpose: 'session' }, cfg.jwtSecret, { expiresIn: `${SESSION_HOURS}h` });
const signChallenge = (u) => jwt.sign({ sub: u._id || u.id, tv: u.tokenVersion || 0, purpose: '2fa' }, cfg.jwtSecret, { expiresIn: '5m' });
const verifyToken = (token, purpose) => { try { const p = jwt.verify(token, cfg.jwtSecret); return p.purpose === purpose ? p : null; } catch (e) { return null; } };
const publicUser = (u) => ({ id: u._id || u.id, name: u.name, role: u.role, email: u.email, clientId: u.clientId || '', twoFactor: !!u.twoFactor });

async function mustEnroll2fa(u) {
  if (u.twoFactor) return false;
  const s = await db.getSettings();
  return !!(s && (s.require2fa || []).includes(u.role));
}

/* Express middleware. Options: allowUnenrolled — let people without required 2FA reach the enrolment endpoints. */
function auth({ allowUnenrolled = false } = {}) {
  return async (req, res, next) => {
    try {
      const p = verifyToken((req.headers.authorization || '').replace(/^Bearer /, ''), 'session');
      if (!p) return res.status(401).json({ error: 'Please sign in again', code: 'AUTH' });
      const raw = await db.col('users').findOne({ _id: p.sub });
      if (!raw || raw.status === 'Inactive' || !raw.passwordHash || (raw.tokenVersion || 0) !== p.tv) return res.status(401).json({ error: 'Your session has ended — please sign in again', code: 'AUTH' });
      req.rawUser = raw;
      req.user = { ...db.fromDoc(raw), twoFactor: !!raw.twoFactor };
      if (!allowUnenrolled && (await mustEnroll2fa(raw))) return res.status(403).json({ error: 'Two-factor authentication is required for your role', code: '2FA_REQUIRED' });
      next();
    } catch (e) { next(e); }
  };
}
const roles = (...allowed) => (req, res, next) => (allowed.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' }));

async function recordFailure(raw) {
  const failed = (raw.failedLogins || 0) + 1;
  const update = { failedLogins: failed };
  if (failed >= MAX_FAILED) { update.lockedUntil = Date.now() + LOCK_MINUTES * 60000; update.failedLogins = 0; }
  await db.col('users').updateOne({ _id: raw._id }, { $set: update });
}
const isLocked = (raw) => raw.lockedUntil && raw.lockedUntil > Date.now();
const clearFailures = (raw) => db.col('users').updateOne({ _id: raw._id }, { $set: { failedLogins: 0, lockedUntil: null } });
const bumpTokenVersion = async (id) => { await db.col('users').updateOne({ _id: id }, { $inc: { tokenVersion: 1 } }); return db.col('users').findOne({ _id: id }); };

module.exports = { sign, signChallenge, verifyToken, publicUser, auth, roles, mustEnroll2fa, recordFailure, isLocked, clearFailures, bumpTokenVersion, LOCK_MINUTES };
