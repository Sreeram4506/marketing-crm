/* Loading data, saving changes (validated, conflict-checked, permission-checked), export */
const express = require('express');
const db = require('../lib/db');
const shared = require('../lib/shared');
const { clean } = require('../lib/validate');
const { filterForUser, bindPerm, rules, canDelete } = require('../lib/policy');
const { runAutomations } = require('../lib/automation');
const notify = require('../lib/notify');
const log = require('../lib/log');
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
  const { changes = {}, settings, activity = [] } = req.body || {};
  const me = req.user;
  const result = { rejected: 0, conflicts: [], invalid: [] };
  const notes = [];
  let touchedBilling = false;
  await db.withLock(async () => {
    const data = await db.loadAll({ activityLimit: 1 });
    const Perm = bindPerm(data, me);
    const settingsNow = data.settings;
    const ctx = {
      ip: clientIp(req), clientIds: Perm.visibleClientIds(), users: new Map(data.users.map((u) => [u.id, u])), notes,
      clientExists: (id) => data.clients.some((c) => c.id === id),
      nextInvoiceNo: (mk) => shared.nextInvoiceNo({ settings: settingsNow }, mk || shared.todayISO().slice(0, 7)),
    };
    const seqBefore = settingsNow.invoiceSeq;
    for (const name of db.COLLECTIONS) {
      const c = changes[name];
      if (!c || typeof c !== 'object') continue;
      const existing = new Map(data[name].map((x) => [x.id, x]));
      if (name === 'users') (await db.col('users').find({}).toArray()).forEach((r) => existing.set(r._id, { ...r, id: r._id }));
      const writes = [];
      for (const raw of (Array.isArray(c.upsert) ? c.upsert : []).slice(0, 2000)) {
        const v = clean(name, raw || {});
        if (!v.ok) { result.invalid.push({ collection: name, id: raw && raw.id, error: v.error }); result.rejected++; continue; }
        const inc = v.doc;
        const ex = existing.get(inc.id);
        if (ex && (inc._rev || 0) !== (ex._rev || 0)) { result.conflicts.push({ collection: name, id: inc.id }); continue; }
        const out = rules[name](me, inc, ex && name === 'users' ? { ...ex } : ex, ctx);
        if (!out) { result.rejected++; continue; }
        delete out._id;
        out._rev = (ex ? ex._rev || 0 : 0) + 1;
        writes.push(out);
        existing.set(out.id, out);
      }
      const dels = (Array.isArray(c.delete) ? c.delete : []).slice(0, 500).filter((id) => { const ex = existing.get(id); const ok = ex && canDelete(name, me, ex, ctx); if (!ok) result.rejected++; return ok; });
      if (name === 'users') {
        await db.col('users').bulkWrite(writes.map((w) => ({ replaceOne: { filter: { _id: w.id }, replacement: { ...w, _id: w.id }, upsert: true } })), { ordered: false })
          .catch((e) => { if (e.code === 11000) throw Object.assign(new Error('That email is already used by someone else'), { status: 409 }); throw e; });
      } else await db.upsertMany(name, writes);
      await db.deleteMany(name, dels);
      if (['clients', 'invoices'].includes(name) && (writes.length || dels.length)) touchedBilling = true;
    }
    let newSettings = null;
    if (settings && typeof settings === 'object') {
      if (me.role !== 'admin') result.rejected++;
      else {
        const v = clean('settings', settings);
        if (v.ok) { newSettings = v.doc; touchedBilling = true; } else { result.invalid.push({ collection: 'settings', error: v.error }); result.rejected++; }
      }
    }
    if (newSettings || settingsNow.invoiceSeq !== seqBefore) {
      // invoiceSeq is owned by the server so two people can't create the same invoice number
      await db.saveSettings({ ...settingsNow, ...(newSettings || {}), invoiceSeq: settingsNow.invoiceSeq });
    }
    await db.appendActivity((Array.isArray(activity) ? activity : []).slice(0, 200).map((a) => ({
      action: a.action, details: a.details, entity: a.entity, entityId: a.entityId, clientId: a.clientId, userId: me.id, userName: me.name, ts: Date.now(),
    })));
  });
  if (touchedBilling) await runAutomations({ force: true });
  if (result.invalid.length) log.warn('Sync rejected invalid records', { user: me.id, invalid: result.invalid.slice(0, 5) });
  notify.afterSync(notes, me); // emails in the background
  res.json({ ok: true, ...result, data: await snapshotFor(req.user) });
}));

router.get('/export', A.auth(), A.roles('admin'), wrap(async (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="agencydesk-backup-${shared.todayISO()}.json"`);
  res.json(await db.loadAll({ activityLimit: 100000 }));
}));

module.exports = { router };
