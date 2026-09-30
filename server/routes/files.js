/* Upload a file, get a short-lived download link, download */
const express = require('express');
const cfg = require('../lib/config');
const db = require('../lib/db');
const files = require('../lib/files');
const A = require('../lib/auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* Body is the raw file; name/scope in the query, type in Content-Type */
router.post('/files', A.auth(), express.raw({ type: () => true, limit: `${cfg.maxUploadMb}mb` }), wrap(async (req, res) => {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const saved = await files.save({ buffer: req.body, name: req.query.name, type, scope: req.query.scope || 'general', user: req.user });
  await db.appendActivity([{ userId: req.user.id, userName: req.user.name, action: 'File uploaded', details: `${saved.name} (${Math.ceil(req.body.length / 1024)} KB, ${req.query.scope || 'general'})`, entity: 'file', entityId: saved.id }]);
  res.json(saved);
}));

router.get('/files/:id/link', A.auth(), wrap(async (req, res) => {
  const f = await files.find(req.params.id);
  if (!f || !(await files.canRead(f, req.user))) return res.status(404).json({ error: 'File not found' });
  res.json({ url: files.signLink(f, req.user), name: f.filename });
}));

router.get('/files/:id/raw', wrap(async (req, res) => {
  if (!files.checkSig(req.params.id, String(req.query.sig || ''))) return res.status(403).send('This download link has expired. Open the file again from AgencyDesk.');
  const f = await files.find(req.params.id);
  if (!f) return res.status(404).send('File not found');
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/mp4)$/.test(f.contentType);
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Length', f.length);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${f.filename.replace(/[^\w.\- ()]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  files.stream(f).on('error', () => res.destroy()).pipe(res);
}));

module.exports = { router };
