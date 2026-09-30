/* AgencyDesk API — entry point. Deploys to Render (or Docker); the frontend can be
   served from here too, or from Vercel with /api proxied to this server. */
process.env.TZ = process.env.TZ || 'Asia/Kolkata'; // billing days and attendance follow Indian time
require('./lib/env');
const cfg = require('./lib/config');
const db = require('./lib/db');
const log = require('./lib/log');
const { runAutomations } = require('./lib/automation');
const { createApp, VERSION } = require('./app');

async function main() {
  await db.connect(cfg.mongoUri, cfg.mongoDb);
  const server = createApp().listen(cfg.port, () => log.info('AgencyDesk API started', { port: cfg.port, version: VERSION, tz: process.env.TZ, email: cfg.emailEnabled }));
  const automate = () => runAutomations({ force: true }).catch((e) => log.error('Automation failed', { error: e.message }));
  automate();
  const timer = setInterval(automate, 60 * 60 * 1000);

  /* Graceful shutdown: finish in-flight requests, then close the database */
  let stopping = false;
  const stop = (sig) => {
    if (stopping) return; stopping = true;
    log.info('Shutting down', { signal: sig });
    clearInterval(timer);
    server.close(async () => { await db.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('unhandledRejection', (e) => log.error('Unhandled rejection', { error: String(e && e.stack || e) }));
}
main().catch((e) => { log.error('Startup failed', { error: e.message }); process.exit(1); });
