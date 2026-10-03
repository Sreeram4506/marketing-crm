/* The co-founder's long-term memory: agency goals and notes everyone's co-founder knows,
   plus personal notes per team member. Server-only collection (never synced to browsers). */
const db = require('../db');
const S = require('../shared');

const KINDS = ['goal', 'note', 'personal'];
const MAX_AGENCY = 40, MAX_PERSONAL = 20;
const col = () => db.col('ai_memory');
let version = Date.now(); // bumped on every change so conversations know to re-read

async function list(user) {
  const docs = await col().find({ $or: [{ scope: 'agency' }, { scope: 'user', userId: user.id }] }).sort({ createdAt: 1 }).toArray();
  return docs.map(({ _id, ...m }) => m);
}

async function add(user, { text, kind }) {
  text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!text) throw new Error('Nothing to remember.');
  if (!KINDS.includes(kind)) kind = 'note';
  const scope = kind === 'personal' ? 'user' : 'agency';
  const cap = scope === 'agency' ? MAX_AGENCY : MAX_PERSONAL;
  const filter = scope === 'agency' ? { scope } : { scope, userId: user.id };
  if ((await col().countDocuments(filter)) >= cap) throw new Error(`Memory is full (${cap} ${scope === 'agency' ? 'agency' : 'personal'} items). Forget something first.`);
  const m = { id: S.uid('mem'), scope, kind, text, userId: scope === 'user' ? user.id : '', by: user.name, createdAt: Date.now() };
  await col().insertOne({ ...m, _id: m.id });
  if (scope === 'agency') await db.appendActivity([{ userId: user.id, userName: user.name, action: kind === 'goal' ? 'AI goal set' : 'AI memory added', details: `${text} (via AI assistant)`, entity: 'memory', entityId: m.id }]);
  version = Date.now();
  return m;
}

/* Who may remove an item: its owner for personal notes; admins (and the author) for agency items */
const canRemove = (user, m) => (m.scope === 'user' ? m.userId === user.id : user.role === 'admin' || m.by === user.name);

async function remove(user, id) {
  const m = await col().findOne({ _id: String(id) });
  if (!m || (m.scope === 'user' && m.userId !== user.id)) return { error: 'not_found' };
  if (!canRemove(user, m)) return { error: 'forbidden' };
  await col().deleteOne({ _id: m._id });
  if (m.scope === 'agency') await db.appendActivity([{ userId: user.id, userName: user.name, action: 'AI memory removed', details: m.text, entity: 'memory', entityId: m.id }]);
  version = Date.now();
  return { removed: m.text };
}

/* Compact block for the model's context */
function describe(items) {
  if (!items.length) return 'Nothing saved yet.';
  const line = (m) => `[${m.id}] ${m.text}`;
  const g = items.filter((m) => m.kind === 'goal'), n = items.filter((m) => m.kind === 'note'), p = items.filter((m) => m.kind === 'personal');
  return [g.length && `Agency goals: ${g.map(line).join(' | ')}`, n.length && `Agency notes: ${n.map(line).join(' | ')}`, p.length && `About this user: ${p.map(line).join(' | ')}`].filter(Boolean).join('\n');
}

module.exports = { list, add, remove, describe, canRemove, KINDS, get version() { return version; } };
