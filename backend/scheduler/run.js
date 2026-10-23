'use strict';
/**
 * Scheduler: fetch each unique (source,route,dates,currency) ONCE, validate, store, then fan out to every alert.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TRAVELPAYOUTS_TOKEN, RESEND_API_KEY, RESEND_FROM
 * Flags: DRY_RUN=1 (no DB writes / emails), MOCK=1 (no network; readings are labelled SIMULATED)
 */
const S = require('../../frontend/shared/shared.js');
const { validateReading } = require('../validation');
const { evaluateAlert } = require('../compare');
const { buildMessage, sendEmail } = require('../notifications');
const travelpayouts = require('../scrapers/travelpayouts.adapter');
const scraped = require('../scrapers/scraped_ota.adapter');

const ADAPTERS = { travelpayouts, scraped_ota: scraped };

function makeDb(env, fetchImpl = fetch) {
  const base = env.SUPABASE_URL + '/rest/v1';
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
  const check = async (r) => { if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 200)); return r; };
  return {
    async activeAlerts() {
      const r = await check(await fetchImpl(base + '/alerts?status=in.(ACTIVE,TRIGGERED)&select=*', { headers: h }));
      return r.json();
    },
    async insertPrices(rows) {
      if (!rows.length) return;
      await check(await fetchImpl(base + '/prices', { method: 'POST', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify(rows) }));
    },
    async updateAlert(id, patch) {
      await check(await fetchImpl(base + '/alerts?id=eq.' + id, { method: 'PATCH', headers: h, body: JSON.stringify(patch) }));
    },
    async insertNotification(row) {
      await check(await fetchImpl(base + '/notifications', { method: 'POST', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify(row) }));
    },
    async userEmail(userId) {
      const r = await check(await fetchImpl(env.SUPABASE_URL + '/auth/v1/admin/users/' + userId, { headers: h }));
      return (await r.json()).email || null;
    },
  };
}

function mockReading(q, source) {
  // Clearly SIMULATED. Never persisted unless MOCK mode is explicit.
  const seed = (q.origin + q.destination + q.departDate).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    source, dataKind: S.SOURCES[source].dataKind, origin: q.origin, destination: q.destination, departDate: q.departDate,
    returnDate: q.returnDate || null, currency: q.currency, price: 300 + (seed % 700), airline: 'XX', link: null,
    retrievedAt: new Date().toISOString(), sourceTimestamp: new Date().toISOString(),
    status: S.STATUS.SIMULATED, validationStatus: 'SIMULATED', dataSource: 'mock', errorMessage: 'SIMULATED DATA',
  };
}

function groupQueries(alerts) {
  const map = new Map();
  for (const a of alerts) {
    for (const src of a.sources || ['travelpayouts']) {
      const q = { origin: a.origin, destination: a.destination, departDate: a.depart_date, returnDate: a.return_date || null, currency: a.currency };
      const key = S.readingKey({ source: src, ...q });
      if (!map.has(key)) map.set(key, { source: src, query: q });
    }
  }
  return [...map.entries()];
}

async function run(env = process.env, deps = {}) {
  const dry = env.DRY_RUN === '1';
  const mock = env.MOCK === '1';
  const db = deps.db || (mock ? null : makeDb(env));
  const DEMO = [{ id: 'demo', user_id: 'demo', origin: 'KUL', destination: 'CAN', depart_date: '2026-12-10', return_date: '2026-12-14', currency: 'myr', target_price: 99999, condition: '<=', sources: ['travelpayouts'], status: 'ACTIVE', notify_email: false }];
  const alerts = deps.alerts || (mock ? DEMO : await db.activeAlerts());
  const results = new Map();
  const toStore = [];
  const log = deps.log || console.log;

  for (const [key, { source, query }] of groupQueries(alerts)) {
    const adapter = ADAPTERS[source];
    let reading;
    if (!adapter) continue;
    if (mock) reading = mockReading(query, source);
    else {
      reading = await adapter.fetchReading(query, { token: env.TRAVELPAYOUTS_TOKEN });
      if (reading.price !== null) {
        const v = validateReading(reading, query, { maxFareAgeHours: Number(env.MAX_FARE_AGE_HOURS || 48) });
        reading = { ...reading, validationStatus: v.validationStatus, status: v.status, errorMessage: v.reasons.join('; ') || reading.errorMessage };
      }
    }
    results.set(key, reading);
    log(`[${source}] ${key} -> ${reading.status}/${reading.validationStatus} ${reading.price ?? ''} ${reading.errorMessage || ''}`);
    toStore.push({
      source: reading.source, origin: reading.origin, destination: reading.destination, depart_date: reading.departDate,
      return_date: reading.returnDate, currency: reading.currency, price: reading.price, airline: reading.airline,
      retrieved_at: reading.retrievedAt, source_timestamp: reading.sourceTimestamp, status: reading.status,
      validation_status: reading.validationStatus, data_kind: reading.dataKind, error_message: reading.errorMessage,
    });
  }

  let notified = 0;
  for (const alert of alerts) {
    const readings = (alert.sources || ['travelpayouts'])
      .map((src) => results.get(S.readingKey({ source: src, origin: alert.origin, destination: alert.destination, departDate: alert.depart_date, returnDate: alert.return_date || '', currency: alert.currency })))
      .filter(Boolean)
      .filter((r) => r.validationStatus === 'PASSED'); // SIMULATED readings can never alert
    const decision = evaluateAlert(alert, readings);
    if (decision.action !== 'NOTIFY') continue;
    notified++;
    const msg = buildMessage(alert, decision.best);
    log('TRIGGER ' + msg.subject);
    if (dry || mock) continue;
    let delivery = 'skipped';
    if (alert.notify_email) {
      const to = await db.userEmail(alert.user_id).catch(() => null);
      const r = await sendEmail({ to, message: msg, apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
      delivery = r.ok ? 'sent' : 'failed: ' + r.error;
    }
    await db.updateAlert(alert.id, { status: S.ALERT_STATUS.TRIGGERED, last_notified_price: decision.best.price, last_notified_at: new Date().toISOString() });
    await db.insertNotification({ alert_id: alert.id, user_id: alert.user_id, type: 'email', price: decision.best.price, delivery_status: delivery });
  }

  if (!dry && !mock) await db.insertPrices(toStore);
  log(`done: ${results.size} unique queries, ${alerts.length} alerts, ${notified} notified`);
  return { queries: results.size, alerts: alerts.length, notified };
}

if (require.main === module) {
  run().catch((e) => { console.error('RUN FAILED:', e.message); process.exit(1); });
}

module.exports = { run, groupQueries, makeDb };
