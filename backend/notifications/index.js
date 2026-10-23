'use strict';
const S = require('../../frontend/shared/shared.js');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildMessage(alert, reading) {
  const kind = reading.dataKind === 'CACHED'
    ? 'This is a CACHED fare (found by other searches), not confirmed live inventory — verify before booking.'
    : 'Fare read live from the source page.';
  const subject = `Flight alert: ${alert.origin}→${alert.destination} ${S.formatPrice(reading.price, alert.currency)}`;
  const lines = [
    `${alert.origin} → ${alert.destination}, depart ${alert.depart_date}${alert.return_date ? ', return ' + alert.return_date : ' (one-way)'}`,
    `Price: ${S.formatPrice(reading.price, alert.currency)}  (target ${alert.condition} ${S.formatPrice(alert.target_price, alert.currency)})`,
    `Source: ${S.SOURCES[reading.source] ? S.SOURCES[reading.source].name : reading.source}${reading.airline ? ' · airline ' + reading.airline : ''}`,
    `Retrieved: ${reading.retrievedAt}`,
    kind,
  ];
  if (reading.link) lines.push(`Link: ${reading.link}`);
  return { subject, text: lines.join('\n'), html: '<p>' + lines.map(escapeHtml).join('<br>') + '</p>' };
}

/** Email via Resend REST API. Key stays server-side (Actions secret). */
async function sendEmail({ to, message, apiKey, from, fetchImpl = fetch }) {
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not set' };
  if (!to) return { ok: false, error: 'no recipient' };
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from || 'Flight Alerts <onboarding@resend.dev>', to: [to], subject: message.subject, text: message.text, html: message.html }),
    });
    if (!res.ok) return { ok: false, error: 'Resend HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { buildMessage, sendEmail, escapeHtml };
