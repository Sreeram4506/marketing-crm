/* File uploads stored in MongoDB (GridFS): NDAs, ID proofs, receipts, brand
   assets, deliverables. Files are private — downloads need a short-lived
   signed link that is only issued to people allowed to see the file. */
const { GridFSBucket, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cfg = require('./config');
const db = require('./db');

const ALLOWED = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/csv': 'csv', 'text/plain': 'txt', 'application/zip': 'zip', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff2': 'woff2',
};
/* Scopes: "hr" = employee documents (admin & finance only); "general" = everyone on the team;
   files attached to a client's deliverable are also visible to that client's portal users. */
const SCOPES = ['general', 'hr'];
const bucket = () => new GridFSBucket(db.db, { bucketName: 'files' });

/* Magic-number check so a renamed .exe can't pass as a PDF */
function sniff(buf, type) {
  const hex = buf.subarray(0, 8).toString('hex');
  const starts = (h) => hex.startsWith(h);
  if (type === 'application/pdf') return starts('25504446');
  if (type === 'image/png') return starts('89504e47');
  if (type === 'image/jpeg') return starts('ffd8ff');
  if (type === 'image/gif') return starts('47494638');
  if (type === 'image/webp') return buf.subarray(8, 12).toString() === 'WEBP';
  if (/openxmlformats|application\/zip/.test(type)) return starts('504b0304');
  return true;
}

async function save({ buffer, name, type, scope, user }) {
  if (!ALLOWED[type]) throw Object.assign(new Error('That file type isn’t allowed'), { status: 415 });
  if (!SCOPES.includes(scope)) throw Object.assign(new Error('Bad scope'), { status: 400 });
  if (scope === 'hr' && !['admin', 'finance'].includes(user.role)) throw Object.assign(new Error('Only admin and finance can upload HR documents'), { status: 403 });
  if (user.role === 'client') throw Object.assign(new Error('Uploads aren’t available in the client portal'), { status: 403 });
  if (!buffer.length) throw Object.assign(new Error('Empty file'), { status: 400 });
  if (!sniff(buffer, type)) throw Object.assign(new Error('The file contents don’t match its type'), { status: 415 });
  const safeName = String(name || 'file').replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'file';
  const id = new ObjectId();
  await new Promise((resolve, reject) => {
    const up = bucket().openUploadStreamWithId(id, safeName, { contentType: type, metadata: { scope, ownerId: user.id, ownerName: user.name, uploadedAt: Date.now() } });
    up.on('finish', resolve).on('error', reject);
    up.end(buffer);
  });
  return { id: id.toHexString(), name: safeName, ref: `file:${id.toHexString()}|${safeName}` };
}

async function find(idHex) {
  if (!/^[a-f0-9]{24}$/.test(idHex)) return null;
  return db.db.collection('files.files').findOne({ _id: new ObjectId(idHex) });
}

async function canRead(file, user) {
  const scope = file.metadata && file.metadata.scope;
  if (user.role === 'client') {
    const ref = new RegExp(`^file:${file._id.toHexString()}`);
    return !!(await db.col('tasks').findOne({ clientId: user.clientId, link: ref }));
  }
  if (scope === 'hr') return ['admin', 'finance'].includes(user.role) || (file.metadata.ownerId === user.id);
  return true;
}

/* Signed download link valid for 10 minutes */
const signLink = (file, user) => `/api/files/${file._id.toHexString()}/raw?sig=${jwt.sign({ fid: file._id.toHexString(), sub: user.id, purpose: 'file' }, cfg.jwtSecret, { expiresIn: '10m' })}`;
function checkSig(idHex, sig) {
  try { const p = jwt.verify(sig, cfg.jwtSecret); return p.purpose === 'file' && p.fid === idHex; } catch (e) { return false; }
}
const stream = (file) => bucket().openDownloadStream(file._id);

module.exports = { save, find, canRead, signLink, checkSig, stream, ALLOWED };
