'use strict';
const S = require('../frontend/shared/shared.js');

function conditionMet(price, target, condition) {
  switch (condition || '<=') {
    case '<=': return price <= target;
    case '<': return price < target;
    case '>=': return price >= target;
    case '>': return price > target;
    default: return false;
  }
}

/** Only PASSED readings count. Cheapest PASSED reading across the alert's selected sources wins. */
function bestReading(readings) {
  const ok = readings.filter((r) => r && r.validationStatus === 'PASSED' && typeof r.price === 'number');
  if (!ok.length) return null;
  return ok.reduce((a, b) => (b.price < a.price ? b : a));
}

/**
 * Decide what to do for one alert given the readings for its sources.
 * Returns { action: 'NOTIFY' | 'NONE' | 'REARM', best, reason }.
 * Dedupe: once TRIGGERED, no repeat notification until user re-arms (edit/reset).
 */
function evaluateAlert(alert, readings) {
  const best = bestReading(readings);
  if (alert.status === S.ALERT_STATUS.DISABLED) return { action: 'NONE', best, reason: 'disabled' };
  if (!best) return { action: 'NONE', best: null, reason: 'no validated reading' };
  const met = conditionMet(best.price, Number(alert.target_price), alert.condition);
  if (!met) return { action: 'NONE', best, reason: 'target not met' };
  if (alert.status === S.ALERT_STATUS.TRIGGERED) return { action: 'NONE', best, reason: 'already triggered (deduped)' };
  return { action: 'NOTIFY', best, reason: 'target reached' };
}

module.exports = { conditionMet, bestReading, evaluateAlert };
