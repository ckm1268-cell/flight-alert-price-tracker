'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../frontend/shared/shared.js');
const tp = require('../backend/scrapers/travelpayouts.adapter');
const sc = require('../backend/scrapers/scraped_ota.adapter');
const { validateReading } = require('../backend/validation');
const { conditionMet, bestReading, evaluateAlert } = require('../backend/compare');
const { buildMessage, sendEmail, escapeHtml } = require('../backend/notifications');
const { run, groupQueries } = require('../backend/scheduler/run');

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/travelpayouts_ok.json'), 'utf8'));
const NOW = new Date('2026-10-23T08:00:00Z');
const q = { origin: 'KUL', destination: 'CAN', departDate: '2026-12-10', returnDate: '2026-12-14', currency: 'myr' };

// ---- adapter parsing
test('parser picks cheapest fare', () => { assert.equal(tp.parsePricesForDates(fx).price, 1290); assert.equal(tp.parsePricesForDates(fx).airline, 'MH'); });
test('parser returns null on empty / success=false / garbage', () => {
  assert.equal(tp.parsePricesForDates({ success: true, data: [] }), null);
  assert.equal(tp.parsePricesForDates({ success: false }), null);
  assert.equal(tp.parsePricesForDates(null), null);
  assert.equal(tp.parsePricesForDates({ data: [{ price: 'N/A' }] }), null);
});
test('buildUrl carries route, dates, currency', () => {
  const u = new URL(tp.buildUrl(q));
  assert.equal(u.searchParams.get('origin'), 'KUL'); assert.equal(u.searchParams.get('return_at'), '2026-12-14');
  assert.equal(u.searchParams.get('currency'), 'myr'); assert.equal(u.searchParams.get('one_way'), 'false');
});
test('fetchReading success / 401 / empty / network error', async () => {
  const ok = await tp.fetchReading(q, { token: 't', now: NOW, fetchImpl: async () => ({ ok: true, status: 200, json: async () => fx }) });
  assert.equal(ok.price, 1290); assert.equal(ok.dataKind, 'CACHED');
  const bad = await tp.fetchReading(q, { token: 't', now: NOW, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  assert.equal(bad.price, null); assert.equal(bad.status, S.STATUS.SOURCE_UNAVAILABLE); assert.match(bad.errorMessage, /rotate/);
  const empty = await tp.fetchReading(q, { token: 't', now: NOW, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: [] }) }) });
  assert.equal(empty.status, S.STATUS.EXTRACTION_ERROR); assert.match(empty.errorMessage, /no cached fare/);
  const net = await tp.fetchReading(q, { token: 't', now: NOW, fetchImpl: async () => { throw new Error('boom'); } });
  assert.match(net.errorMessage, /network error/);
  const noTok = await tp.fetchReading(q, { now: NOW });
  assert.match(noTok.errorMessage, /TOKEN/);
});

// ---- validation gate
const good = { price: 1290, currency: 'myr', origin: 'KUL', destination: 'CAN', departDate: '2026-12-10', sourceTimestamp: '2026-10-23T05:00:00Z' };
test('valid fare PASSES', () => assert.equal(validateReading(good, q, { now: NOW }).validationStatus, 'PASSED'));
test('rejects null / NaN / zero / negative / string', () => {
  for (const p of [null, undefined, NaN, 0, -5, '1290', '']) {
    assert.equal(validateReading({ ...good, price: p }, q, { now: NOW }).validationStatus, 'FAILED', 'price=' + String(p));
  }
});
test('rejects decimal shift and absurd magnitude', () => {
  assert.equal(validateReading({ ...good, price: 0.1290 }, q, { now: NOW }).validationStatus, 'FAILED');
  assert.equal(validateReading({ ...good, price: 129000000 }, q, { now: NOW }).validationStatus, 'FAILED');
});
test('rejects wrong currency / origin / destination / date', () => {
  assert.equal(validateReading({ ...good, currency: 'usd' }, q, { now: NOW }).validationStatus, 'FAILED');
  assert.equal(validateReading({ ...good, origin: 'SIN' }, q, { now: NOW }).validationStatus, 'FAILED');
  assert.equal(validateReading({ ...good, destination: 'SZX' }, q, { now: NOW }).validationStatus, 'FAILED');
  assert.equal(validateReading({ ...good, departDate: '2026-12-11' }, q, { now: NOW }).validationStatus, 'FAILED');
});
test('old cached fare is STALE and cannot be LIVE', () => {
  const v = validateReading({ ...good, sourceTimestamp: '2026-10-19T00:00:00Z' }, q, { now: NOW, maxFareAgeHours: 48 });
  assert.equal(v.validationStatus, 'STALE'); assert.equal(v.status, S.STATUS.STALE);
});

// ---- comparison + dedupe
test('conditions', () => {
  assert.ok(conditionMet(100, 100, '<=')); assert.ok(!conditionMet(100, 100, '<'));
  assert.ok(conditionMet(100, 100, '>=')); assert.ok(!conditionMet(100, 100, '>')); assert.ok(conditionMet(99, 100, undefined));
});
test('bestReading ignores non-PASSED and picks cheapest', () => {
  const b = bestReading([{ price: 10, validationStatus: 'FAILED' }, { price: 500, validationStatus: 'PASSED' }, { price: 400, validationStatus: 'PASSED' }, { price: 1, validationStatus: 'SIMULATED' }]);
  assert.equal(b.price, 400);
  assert.equal(bestReading([{ price: 1, validationStatus: 'FAILED' }]), null);
});
test('evaluateAlert: notify, dedupe, disabled, no data', () => {
  const alert = { status: 'ACTIVE', target_price: 1300, condition: '<=' };
  const r = [{ price: 1290, validationStatus: 'PASSED' }];
  assert.equal(evaluateAlert(alert, r).action, 'NOTIFY');
  assert.equal(evaluateAlert({ ...alert, status: 'TRIGGERED' }, r).action, 'NONE');
  assert.equal(evaluateAlert({ ...alert, status: 'DISABLED' }, r).action, 'NONE');
  assert.equal(evaluateAlert(alert, []).action, 'NONE');
  assert.equal(evaluateAlert({ ...alert, target_price: 1000 }, r).action, 'NONE');
});

// ---- scraped adapter
test('scraped adapter parses prices defensively and refuses while disabled', async () => {
  assert.equal(sc.parsePriceText('RM 1,290.50').price, 1290.5);
  assert.equal(sc.parsePriceText('N/A'), null); assert.equal(sc.parsePriceText(''), null);
  const r = await sc.fetchReading(q, { now: NOW });
  assert.equal(r.price, null); assert.match(r.errorMessage, /disabled/);
  assert.match(sc.diagnoseFailure({ httpStatus: 403 }), /do not bypass/);
  assert.match(sc.diagnoseFailure({ hasPriceEl: false }), /STRUCTURE MAY HAVE CHANGED/);
});

// ---- notifications
test('message labels cached fares and escapes html', () => {
  const m = buildMessage({ origin: 'KUL', destination: 'CAN', depart_date: '2026-12-10', return_date: null, currency: 'myr', target_price: 1300, condition: '<=' },
    { price: 1290, source: 'travelpayouts', dataKind: 'CACHED', retrievedAt: NOW.toISOString(), link: 'https://x/?a=1&b=<2>' });
  assert.match(m.text, /CACHED/); assert.match(m.text, /one-way/); assert.ok(!m.html.includes('<2>'));
  assert.equal(escapeHtml('"<>&\''), '&quot;&lt;&gt;&amp;&#39;');
});
test('sendEmail success / failure / missing key', async () => {
  const msg = { subject: 's', text: 't', html: 'h' };
  assert.equal((await sendEmail({ to: 'a@b.c', message: msg, apiKey: 'k', fetchImpl: async () => ({ ok: true }) })).ok, true);
  const f = await sendEmail({ to: 'a@b.c', message: msg, apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 422, text: async () => 'bad' }) });
  assert.equal(f.ok, false); assert.match(f.error, /422/);
  assert.equal((await sendEmail({ to: 'a@b.c', message: msg })).ok, false);
});

// ---- scheduler
const mkAlert = (o) => ({ id: o.id, user_id: 'u' + o.id, origin: 'KUL', destination: 'CAN', depart_date: '2026-12-10', return_date: '2026-12-14', currency: 'myr', target_price: 1300, condition: '<=', sources: ['travelpayouts'], status: 'ACTIVE', notify_email: true, ...o });
test('scheduler fetches each unique query once and fans out to users', () => {
  const g = groupQueries([mkAlert({ id: 1 }), mkAlert({ id: 2, target_price: 900 }), mkAlert({ id: 3, destination: 'SZX' })]);
  assert.equal(g.length, 2);
});
test('MOCK mode never notifies (SIMULATED readings cannot alert)', async () => {
  const logs = [];
  const res = await run({ MOCK: '1' }, { alerts: [mkAlert({ id: 1, target_price: 99999 })], log: (l) => logs.push(l) });
  assert.equal(res.notified, 0); assert.ok(logs.some((l) => /SIMULATED/.test(l)));
});
test('scheduler end-to-end with fake db: notifies once, marks TRIGGERED, stores prices', async () => {
  const calls = { updates: [], notifs: [], prices: [] };
  const db = {
    updateAlert: async (id, p) => calls.updates.push([id, p]), insertNotification: async (r) => calls.notifs.push(r),
    insertPrices: async (rows) => calls.prices.push(...rows), userEmail: async () => 'me@example.com',
  };
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('travelpayouts')) return { ok: true, status: 200, json: async () => ({ ...fx, data: fx.data.map((d) => ({ ...d, found_at: new Date().toISOString() })) }) };
    if (String(url).includes('resend')) return { ok: true, status: 200, text: async () => '' };
    throw new Error('unexpected ' + url);
  };
  try {
    const env = { TRAVELPAYOUTS_TOKEN: 't', RESEND_API_KEY: 'k' };
    const alerts = [mkAlert({ id: 1 }), mkAlert({ id: 2, status: 'TRIGGERED' }), mkAlert({ id: 3, target_price: 500 })];
    const res = await run(env, { db, alerts, log: () => {} });
    assert.equal(res.queries, 1); assert.equal(res.notified, 1);
    assert.equal(calls.updates.length, 1); assert.equal(calls.updates[0][1].status, 'TRIGGERED');
    assert.equal(calls.prices.length, 1); assert.equal(calls.prices[0].validation_status, 'PASSED'); assert.equal(calls.prices[0].data_kind, 'CACHED');
    assert.equal(calls.notifs[0].delivery_status, 'sent');
  } finally { global.fetch = realFetch; }
});

// ---- shared
test('shared helpers', () => {
  assert.ok(S.isIata('kul')); assert.ok(!S.isIata('123')); assert.ok(!S.isIata('KULX'));
  assert.equal(S.formatPrice(1290, 'myr'), '1,290 MYR'); assert.equal(S.formatPrice(null, 'myr'), '—');
  assert.equal(S.timeAgo('2026-10-23T07:00:00Z', NOW), '1 h ago'); assert.equal(S.timeAgo(null), 'never');
});
