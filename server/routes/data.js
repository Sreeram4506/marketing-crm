/* Loading data, saving changes (validated, conflict-checked, permission-checked), export */
const express = require('express');
const db = require('../lib/db');
const shared = require('../lib/shared');
const { filterForUser } = require('../lib/policy');
const { runAutomations } = require('../lib/automation');
const { applySync } = require('../lib/sync');
const A = require('../lib/auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clientIp = (req) => String(req.ip || '').replace(/^::ffff:/, '');

async function snapshotFor(user) { return filterForUser(await db.loadAll(), user); }

router.get('/data', A.auth(), wrap(async (req, res) => {
  await runAutomations(); // throttled to once per 5 minutes
  res.json(await snapshotFor(req.user));
}));

/* Browser sends only what changed:
   { changes: { tasks: { upsert: [...], delete: [ids] }, ... }, settings, activity }
   Each record carries the _rev it was based on; if someone saved it since, it's a conflict. */
router.post('/sync', A.auth(), wrap(async (req, res) => {
  const result = await applySync(req.user, req.body || {}, clientIp(req));
  res.json({ ok: true, ...result, data: await snapshotFor(req.user) });
}));

router.get('/export', A.auth(), A.roles('admin'), wrap(async (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="agencydesk-backup-${shared.todayISO()}.json"`);
  res.json(await db.loadAll({ activityLimit: 100000 }));
}));

module.exports = { router, snapshotFor };
