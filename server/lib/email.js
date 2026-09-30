/* Transactional email through Resend (https://resend.com). Any failure is logged, never thrown. */
const cfg = require('./config');
const log = require('./log');

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function htmlFrom(text, button) {
  const body = escapeHtml(text).replace(/\n/g, '<br>');
  const btn = button ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(button.label)}</a></p>` : '';
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1b1f24;max-width:560px">${body}${btn}</div>`;
}

async function send({ to, subject, text, button, replyTo }) {
  if (!cfg.emailEnabled || !to) return false;
  try {
    const res = await fetch(cfg.email.apiUrl, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${cfg.email.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.email.from, to: [to], subject, text: text + (button ? `\n\n${button.label}: ${button.url}` : ''), html: htmlFrom(text, button), ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    log.info('Email sent', { to, subject });
    return true;
  } catch (e) {
    log.error('Email failed', { to, subject, error: e.message });
    return false;
  }
}
module.exports = { send, enabled: () => cfg.emailEnabled };
