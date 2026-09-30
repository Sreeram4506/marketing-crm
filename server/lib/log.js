/* One JSON line per event — readable in Render's log viewer and easy to ship to any log tool */
function log(level, msg, extra = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  (level === 'error' ? console.error : console.log)(line);
}
module.exports = { info: (m, e) => log('info', m, e), warn: (m, e) => log('warn', m, e), error: (m, e) => log('error', m, e) };
