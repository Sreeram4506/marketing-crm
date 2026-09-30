/* Reads and checks environment variables once, at startup */
const log = require('./log');

function load() {
  const env = process.env;
  const problems = [];
  if (!env.MONGODB_URI) problems.push('MONGODB_URI is required');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be a random string of at least 32 characters');
  if (problems.length) { problems.forEach((p) => log.error('Config error: ' + p)); process.exit(1); }
  const cfg = {
    port: Number(env.PORT) || 4000,
    mongoUri: env.MONGODB_URI,
    mongoDb: env.MONGODB_DB || 'agencydesk',
    jwtSecret: env.JWT_SECRET,
    cronSecret: env.CRON_SECRET || '',
    appUrl: (env.APP_URL || '').replace(/\/$/, ''),
    origins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    serveFrontend: env.SERVE_FRONTEND !== 'false',
    email: { apiKey: env.RESEND_API_KEY || '', from: env.EMAIL_FROM || '', apiUrl: env.EMAIL_API_URL || 'https://api.resend.com/emails' },
    maxUploadMb: Number(env.MAX_UPLOAD_MB) || 10,
  };
  cfg.emailEnabled = !!(cfg.email.apiKey && cfg.email.from);
  if (!cfg.emailEnabled) log.warn('Email is off (set RESEND_API_KEY and EMAIL_FROM): no password-reset emails, invites or emailed reminders');
  if (cfg.emailEnabled && !cfg.appUrl) log.warn('APP_URL is not set: emails cannot include links back to the app');
  if (!cfg.cronSecret) log.warn('CRON_SECRET is not set: /api/cron is disabled');
  return cfg;
}
module.exports = load();
