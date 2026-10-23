'use strict';
const S = require('../frontend/shared/shared.js');

/**
 * Validation gate. A reading may only be compared / alerted on when validationStatus === 'PASSED'.
 * `query` is what we asked for; `reading` is what the adapter returned.
 */
function validateReading(reading, query, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const maxAgeH = opts.maxFareAgeHours ?? 48;
  const reasons = [];

  const price = reading.price;
  if (price === null || price === undefined || price === '' || typeof price === 'boolean') reasons.push('price missing');
  else if (typeof price !== 'number' || !Number.isFinite(price)) reasons.push('price not numeric');
  else if (price <= 0) reasons.push('price <= 0');

  if (reading.currency && query.currency && String(reading.currency).toLowerCase() !== String(query.currency).toLowerCase()) {
    reasons.push(`currency mismatch (${reading.currency} vs ${query.currency})`);
  }
  if (reading.origin && S.normIata(reading.origin) !== S.normIata(query.origin)) reasons.push('origin mismatch');
  if (reading.destination && S.normIata(reading.destination) !== S.normIata(query.destination)) reasons.push('destination mismatch');
  if (reading.departDate && query.departDate && reading.departDate.slice(0, 10) !== query.departDate.slice(0, 10)) {
    reasons.push('departure date mismatch');
  }

  const range = (opts.ranges || S.CURRENCY_RANGE)[String(query.currency).toLowerCase()];
  if (range && typeof price === 'number' && Number.isFinite(price) && price > 0 && (price < range.min || price > range.max)) {
    reasons.push(`price ${price} outside plausible range ${range.min}-${range.max} (decimal shift / wrong column?)`);
  }

  let stale = false;
  const ts = reading.sourceTimestamp;
  if (ts) {
    const ageH = (now.getTime() - new Date(ts).getTime()) / 3600000;
    if (Number.isNaN(ageH)) reasons.push('source timestamp unparseable');
    else if (ageH > maxAgeH) stale = true;
  }

  if (reasons.length) return { validationStatus: 'FAILED', status: S.STATUS.EXTRACTION_ERROR, reasons };
  if (stale) return { validationStatus: 'STALE', status: S.STATUS.STALE, reasons: [`fare older than ${maxAgeH}h`] };
  return { validationStatus: 'PASSED', status: S.STATUS.LIVE, reasons: [] };
}

module.exports = { validateReading };
