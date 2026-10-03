/* The AI co-founder's endpoints.
   POST /api/assistant — one user message in, a Server-Sent Events stream out:
     start · text deltas · tool progress · confirm prompts · navigate · done
   GET  /api/assistant/signals — what needs attention right now (rules only, no AI call)
   GET/DELETE /api/assistant/memory — what the co-founder remembers */
const express = require('express');
const rateLimit = require('express-rate-limit');
const cfg = require('../lib/config');
const db = require('../lib/db');
const A = require('../lib/auth');
const log = require('../lib/log');
const { chat, describeError } = require('../lib/assistant/agent');
const insights = require('../lib/assistant/insights');
const memory = require('../lib/assistant/memory');
const { viewFor, bind } = require('../lib/assistant/tools');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const STAFF = ['admin', 'pm', 'creative', 'shoot', 'finance'];
const limiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: cfg.ai.perUserPer10Min, keyGenerator: (req) => req.user.id, standardHeaders: true, legacyHeaders: false,
  message: { error: 'You’ve sent a lot of requests to the co-founder — give it a few minutes.' } });

/* Shared gate: the co-founder must be configured, switched on, and the caller a team member */
const gate = wrap(async (req, res, next) => {
  if (!cfg.aiEnabled) return res.status(503).json({ error: 'The AI co-founder isn’t set up on this server (OPENAI_API_KEY is missing).' });
  if (!STAFF.includes(req.user.role)) return res.status(403).json({ error: 'The co-founder is available to team members only.' });
  const s = await db.getSettings().catch(() => null);
  if (s && s.aiDisabled) return res.status(403).json({ error: 'An admin has turned the co-founder off in Settings.' });
  next();
});

router.get('/assistant/signals', A.auth(), gate, wrap(async (req, res) => {
  const view = bind(await viewFor(req.user));
  res.json({ signals: insights.signals(view, req.user) });
}));

router.get('/assistant/memory', A.auth(), gate, wrap(async (req, res) => {
  const items = await memory.list(req.user);
  res.json({ items: items.map((m) => ({ ...m, canRemove: memory.canRemove(req.user, m) })) });
}));
router.delete('/assistant/memory/:id', A.auth(), gate, wrap(async (req, res) => {
  const r = await memory.remove(req.user, req.params.id);
  if (r.error === 'not_found') return res.status(404).json({ error: 'Not found.' });
  if (r.error === 'forbidden') return res.status(403).json({ error: 'Only an admin can remove that.' });
  res.json({ ok: true });
}));

router.post('/assistant', A.auth(), gate, (req, res, next) => {
  const { message } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'Say or type something first.' });
  next();
}, limiter, async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  let open = true;
  res.on('close', () => { open = false; });
  const send = (ev) => { if (open) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
  const ping = setInterval(() => open && res.write(': keep-alive\n\n'), 15000);
  const { message, conversationId, mode, page } = req.body;
  try {
    await chat({ user: req.user, ip: String(req.ip || '').replace(/^::ffff:/, ''), conversationId, message, mode: mode === 'voice' ? 'voice' : 'text', page, send });
  } catch (e) {
    log.error('Assistant failed', { user: req.user.id, error: e.message, status: e.status });
    send({ type: 'error', message: describeError(e) });
  } finally {
    clearInterval(ping);
    if (open) res.end();
  }
});

module.exports = { router };
