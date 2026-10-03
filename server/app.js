/* Express app: security headers, CORS, JSON, routes, optional static frontend, errors */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cfg = require('./lib/config');
const db = require('./lib/db');
const log = require('./lib/log');

const ROOT = path.join(__dirname, '..');
const VERSION = require('./package.json').version;

/* Same policy is set on Vercel (vercel.json) */
const CSP = {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], mediaSrc: ["'self'", 'blob:'],
  frameSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'self'"],
};

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render / Vercel proxies — needed for real client IPs and rate limiting
  app.use(helmet({ contentSecurityPolicy: { useDefaults: false, directives: CSP }, crossOriginEmbedderPolicy: false }));
  app.use('/api', cors({ origin: (o, cb) => cb(null, !o || cfg.origins.includes(o)), allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.API_RATE_LIMIT) || 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Slow down — too many requests' } }));

  /* Request log (skips health checks) */
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    const start = Date.now();
    req.id = crypto.randomBytes(6).toString('hex');
    res.setHeader('X-Request-Id', req.id);
    res.on('finish', () => { if (req.path.startsWith('/api')) log.info('request', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start, user: req.user && req.user.id }); });
    next();
  });

  app.get('/api/health', async (req, res) => {
    try { await db.db.command({ ping: 1 }); res.json({ ok: true, app: 'agencydesk', version: VERSION }); }
    catch (e) { res.status(503).json({ ok: false, app: 'agencydesk', error: 'database unavailable' }); }
  });
  app.use('/api', require('./routes/files').router); // before the JSON parser: uploads are raw bytes
  app.use('/api', express.json({ limit: '5mb' }));
  app.use('/api', require('./routes/auth').router);
  app.use('/api', require('./routes/data').router);
  app.use('/api', require('./routes/admin').router);
  app.use('/api', require('./routes/assistant').router);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  /* Frontend (optional: lets one Render service host everything) */
  if (cfg.serveFrontend) {
    app.use('/css', express.static(path.join(ROOT, 'css'), { maxAge: '7d' }));
    app.use('/js', express.static(path.join(ROOT, 'js'), { maxAge: '7d' }));
    app.get('/', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(ROOT, 'index.html')); });
  }

  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) log.error('Unhandled error', { id: req.id, path: req.path, error: err.message, stack: err.stack });
    res.status(status).json({ error: status === 413 ? `File too large (max ${cfg.maxUploadMb} MB)` : status < 500 ? err.message : `Server error — please try again (ref ${req.id || '-'})` });
  });
  return app;
}
module.exports = { createApp, VERSION };
