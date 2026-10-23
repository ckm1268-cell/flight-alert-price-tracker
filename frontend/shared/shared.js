/* Shared module (UMD): status vocabulary, sources, formatting.
   Loaded by <script> in the browser AND require()d by the Node backend, so both sides never drift. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlightShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUS = Object.freeze({
    LIVE: 'LIVE',
    STALE: 'STALE',
    SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
    EXTRACTION_ERROR: 'EXTRACTION_ERROR',
    SIMULATED: 'SIMULATED',
    TARGET_REACHED: 'TARGET_REACHED',
  });

  const ALERT_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', TRIGGERED: 'TRIGGERED', DISABLED: 'DISABLED' });

  // dataKind tells the user what kind of fare they are looking at.
  const DATA_KIND = Object.freeze({ CACHED: 'CACHED', LIVE: 'LIVE' });

  const SOURCES = Object.freeze({
    travelpayouts: { id: 'travelpayouts', name: 'Travelpayouts (cached fares)', dataKind: 'CACHED', enabled: true },
    scraped_ota: { id: 'scraped_ota', name: 'Scraped OTA (live page)', dataKind: 'LIVE', enabled: false },
  });

  const CURRENCY_RANGE = Object.freeze({
    myr: { min: 30, max: 60000 },
    usd: { min: 10, max: 15000 },
    sgd: { min: 10, max: 20000 },
    cny: { min: 50, max: 100000 },
    eur: { min: 10, max: 15000 },
    gbp: { min: 10, max: 15000 },
  });

  const CONDITIONS = Object.freeze(['<=', '<', '>=', '>']);

  function normIata(s) { return String(s || '').trim().toUpperCase(); }
  function isIata(s) { return /^[A-Z]{3}$/.test(normIata(s)); }

  function formatPrice(value, currency) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    return Number(value).toLocaleString('en-MY', { maximumFractionDigits: 0 }) + ' ' + String(currency || '').toUpperCase();
  }

  function timeAgo(iso, now) {
    if (!iso) return 'never';
    const ms = (now ? new Date(now).getTime() : Date.now()) - new Date(iso).getTime();
    if (Number.isNaN(ms)) return 'unknown';
    const m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 48) return h + ' h ago';
    return Math.round(h / 24) + ' d ago';
  }

  function readingKey(r) {
    return [r.source, r.origin, r.destination, r.departDate, r.returnDate || '', r.currency].join('::');
  }

  return { STATUS, ALERT_STATUS, DATA_KIND, SOURCES, CURRENCY_RANGE, CONDITIONS, normIata, isIata, formatPrice, timeAgo, readingKey };
});
