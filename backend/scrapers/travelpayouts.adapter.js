'use strict';
const S = require('../../frontend/shared/shared.js');

/**
 * Travelpayouts Data API adapter. Fares are CACHED (found by other users' searches), never live inventory.
 * Pure parser is exported so tests can run it on fixtures.
 */
const ENDPOINT = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

function parsePricesForDates(json) {
  // Contract: returns { price, airline, flightNumber, transfers, link, foundAt, departAt } | null
  if (!json || json.success === false || !Array.isArray(json.data) || json.data.length === 0) return null;
  const cheapest = json.data
    .filter((d) => d && Number.isFinite(Number(d.price)))
    .sort((a, b) => Number(a.price) - Number(b.price))[0];
  if (!cheapest) return null;
  return {
    price: Number(cheapest.price),
    airline: cheapest.airline || null,
    flightNumber: cheapest.flight_number || null,
    transfers: cheapest.transfers ?? null,
    link: cheapest.link || null,
    foundAt: cheapest.found_at || null, // not always present on this endpoint
    departAt: cheapest.departure_at || null,
    origin: cheapest.origin || null,
    destination: cheapest.destination || null,
  };
}

function buildUrl(q) {
  const u = new URL(ENDPOINT);
  u.searchParams.set('origin', S.normIata(q.origin));
  u.searchParams.set('destination', S.normIata(q.destination));
  u.searchParams.set('departure_at', q.departDate);
  if (q.returnDate) u.searchParams.set('return_at', q.returnDate);
  u.searchParams.set('currency', String(q.currency).toLowerCase());
  u.searchParams.set('sorting', 'price');
  u.searchParams.set('limit', '10');
  u.searchParams.set('one_way', q.returnDate ? 'false' : 'true');
  return u.toString();
}

/** Classify why a request failed so the stored errorMessage is self-diagnosing. */
function diagnose(httpStatus, body) {
  if (httpStatus === 401 || httpStatus === 403) return 'HTTP ' + httpStatus + ': token rejected/expired — rotate TRAVELPAYOUTS_TOKEN';
  if (httpStatus === 429) return 'HTTP 429: rate limited — back off';
  if (httpStatus >= 500) return 'HTTP ' + httpStatus + ': source down';
  if (httpStatus !== 200) return 'HTTP ' + httpStatus;
  if (!body || body.success === false) return 'API returned success=false';
  if (!Array.isArray(body.data)) return 'unexpected response shape (no data array) — API may have changed';
  if (body.data.length === 0) return 'no cached fare found for this route/date (not an error in the source)';
  return 'could not read a numeric price';
}

async function fetchReading(query, { token, fetchImpl = fetch, now = new Date() } = {}) {
  const base = {
    source: 'travelpayouts', dataKind: 'CACHED',
    origin: S.normIata(query.origin), destination: S.normIata(query.destination),
    departDate: query.departDate, returnDate: query.returnDate || null, currency: String(query.currency).toLowerCase(),
    price: null, airline: null, link: null,
    retrievedAt: now.toISOString(), sourceTimestamp: null,
    status: S.STATUS.SOURCE_UNAVAILABLE, validationStatus: 'NOT_RUN', dataSource: 'travelpayouts:prices_for_dates', errorMessage: null,
  };
  if (!token) return { ...base, errorMessage: 'TRAVELPAYOUTS_TOKEN not set' };
  let res, body = null;
  try {
    res = await fetchImpl(buildUrl(query), { headers: { 'X-Access-Token': token, Accept: 'application/json' } });
    try { body = await res.json(); } catch (_) { body = null; }
  } catch (e) {
    return { ...base, errorMessage: 'network error: ' + e.message };
  }
  if (!res.ok) return { ...base, errorMessage: diagnose(res.status, body) };
  const parsed = parsePricesForDates(body);
  if (!parsed) return { ...base, status: S.STATUS.EXTRACTION_ERROR, errorMessage: diagnose(200, body) };
  return {
    ...base, price: parsed.price, airline: parsed.airline, link: parsed.link,
    sourceTimestamp: parsed.foundAt, status: S.STATUS.LIVE, // provisional; validateReading decides final status
    departDate: parsed.departAt ? parsed.departAt.slice(0, 10) : query.departDate,
  };
}

module.exports = { id: 'travelpayouts', parsePricesForDates, buildUrl, diagnose, fetchReading };
