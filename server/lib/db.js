/* MongoDB access. Each app record keeps its string `id`; we store it as `_id` too. */
const { MongoClient } = require('mongodb');
const shared = require('./shared');

const COLLECTIONS = ['users', 'clients', 'invoices', 'tasks', 'attendance', 'leaves', 'eod'];
let client, db;

async function connect(uri, dbName) {
  if (!uri) throw new Error('MONGODB_URI is not set');
  client = new MongoClient(uri, { maxPoolSize: 10 });
  await client.connect();
  db = client.db(dbName);
  await Promise.all([
    db.collection('users').createIndex({ emailLower: 1 }, { unique: true, sparse: true }),
    db.collection('activity').createIndex({ seq: -1 }),
    db.collection('invoices').createIndex({ clientId: 1, month: 1 }),
    db.collection('tasks').createIndex({ clientId: 1 }),
    db.collection('attendance').createIndex({ userId: 1, date: 1 }),
    db.collection('files.files').createIndex({ 'metadata.ownerId': 1 }),
    db.collection('ai_memory').createIndex({ scope: 1, userId: 1 }),
  ]);
  return db;
}
const col = (name) => db.collection(name);
const toDoc = (x) => ({ ...x, _id: x.id });
/* Account-security fields live only on the server; they are stripped from everything sent to browsers */
const SECRET_USER_FIELDS = ['passwordHash', 'emailLower', 'tokenVersion', 'failedLogins', 'lockedUntil', 'totpSecret', 'totpPending', 'recoveryCodes', 'resetTokenHash', 'resetExpires'];
const SERVER_ONLY_USER_FIELDS = [...SECRET_USER_FIELDS, 'twoFactor'];
const fromDoc = (doc) => { const { _id, ...rest } = doc; SECRET_USER_FIELDS.forEach((f) => delete rest[f]); return rest; };

async function getSettings() { const s = await col('meta').findOne({ _id: 'settings' }); return s ? s.value : null; }
async function saveSettings(value) { await col('meta').updateOne({ _id: 'settings' }, { $set: { value } }, { upsert: true }); }

/* Everything the app needs, as one object shaped like the browser's Store.data */
async function loadAll({ activityLimit = 1500 } = {}) {
  const out = { version: shared.DATA_VERSION, settings: await getSettings() };
  await Promise.all(COLLECTIONS.map(async (c) => { out[c] = (await col(c).find({}).toArray()).map(fromDoc); }));
  out.activity = (await col('activity').find({}).sort({ seq: -1 }).limit(activityLimit).toArray()).map(({ _id, seq, ...a }) => a);
  return out;
}

async function upsertMany(name, docs) {
  if (!docs.length) return;
  await col(name).bulkWrite(docs.map((d) => ({ replaceOne: { filter: { _id: d.id }, replacement: toDoc(d), upsert: true } })));
}
async function deleteMany(name, ids) { if (ids.length) await col(name).deleteMany({ _id: { $in: ids } }); }

/* Append-only audit trail. Each entry's hash covers the previous one, using the
   same formula as the browser so the admin integrity check keeps working. */
async function appendActivity(entries) {
  if (!entries.length) return;
  const head = await col('activity').find({}).sort({ seq: -1 }).limit(1).next();
  let prev = head ? head.hash : '00000000';
  let seq = head ? head.seq : 0;
  const docs = entries.map((e) => {
    const entry = { id: shared.uid('act'), ts: e.ts || Date.now(), userId: e.userId, userName: e.userName, action: String(e.action || '').slice(0, 120),
      details: String(e.details || '').slice(0, 1000), entity: e.entity || '', entityId: e.entityId || '', clientId: e.clientId || '', prev };
    entry.hash = shared.fnv(prev + '|' + entry.ts + '|' + entry.userId + '|' + entry.action + '|' + entry.details + '|' + entry.entityId);
    prev = entry.hash;
    return { ...entry, _id: entry.id, seq: ++seq };
  });
  await col('activity').insertMany(docs);
}

/* Serialise writes (sync, automations) so invoice numbers and the audit chain stay consistent */
let chain = Promise.resolve();
function withLock(fn) { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; }

module.exports = { connect, col, COLLECTIONS, SERVER_ONLY_USER_FIELDS, toDoc, fromDoc, getSettings, saveSettings, loadAll, upsertMany, deleteMany, appendActivity, withLock, get db() { return db; }, close: () => client && client.close() };
