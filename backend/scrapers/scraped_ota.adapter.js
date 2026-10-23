'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../../frontend/shared/shared.js');

/**
 * Config-driven Playwright adapter for ONE scraped OTA/airline page (LIVE data kind).
 * It refuses to run while config/websites/scraped_ota.json has enabled=false or placeholder selectors,
 * so it can never silently present fake data. Fill the config after human discovery + ToS review.
 */
function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/websites/scraped_ota.json'), 'utf8'));
}

/** Pure parse: given rendered HTML, return {price} | null. Header/selector-agnostic number parsing. */
function parsePriceText(text) {
  if (!text) return null;
  const m = String(text).replace(/\s+/g, ' ').match(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? { price: n } : null;
}

function fillUrl(tpl, q) {
  return tpl.replace('{origin}', S.normIata(q.origin)).replace('{destination}', S.normIata(q.destination))
    .replace('{departDate}', q.departDate).replace('{returnDate}', q.returnDate || '');
}

/** Classify failures: no price element at all vs element present but unparsable. */
function diagnoseFailure({ httpStatus, hasPriceEl, text }) {
  if (httpStatus && httpStatus >= 400) return 'HTTP ' + httpStatus + ' — blocked or down (do not bypass anti-bot controls)';
  if (!hasPriceEl) return 'price element not found — bot-check/maintenance page or redesign (SOURCE STRUCTURE MAY HAVE CHANGED if repeated)';
  return 'price element found but text "' + String(text).slice(0, 40) + '" is not a number';
}

async function fetchReading(query, { now = new Date(), cfg = loadConfig(), launch } = {}) {
  const base = {
    source: 'scraped_ota', dataKind: 'LIVE',
    origin: S.normIata(query.origin), destination: S.normIata(query.destination),
    departDate: query.departDate, returnDate: query.returnDate || null, currency: String(query.currency).toLowerCase(),
    price: null, airline: null, link: null, retrievedAt: now.toISOString(), sourceTimestamp: now.toISOString(),
    status: S.STATUS.SOURCE_UNAVAILABLE, validationStatus: 'NOT_RUN', dataSource: 'playwright:dom', errorMessage: null,
  };
  if (!cfg.enabled) return { ...base, errorMessage: 'source disabled until discovery/ToS review is recorded in config' };
  if (/REPLACE/.test(cfg.url + cfg.priceSelector + cfg.waitForSelector)) return { ...base, errorMessage: 'config still has placeholder selectors' };

  let browser;
  try {
    const pw = launch || (await import('playwright')).chromium;
    browser = await pw.launch();
    const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (compatible; FlightAlertTracker/1.0; personal use)' });
    const url = fillUrl(cfg.url, query);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const httpStatus = resp ? resp.status() : null;
    const el = await page.waitForSelector(cfg.waitForSelector, { timeout: 20000 }).then(() => page.$(cfg.priceSelector)).catch(() => null);
    const text = el ? await el.innerText() : null;
    const parsed = parsePriceText(text);
    if (!parsed) return { ...base, status: S.STATUS.EXTRACTION_ERROR, link: url, errorMessage: diagnoseFailure({ httpStatus, hasPriceEl: !!el, text }) };
    return { ...base, price: parsed.price, link: url, status: S.STATUS.LIVE };
  } catch (e) {
    return { ...base, status: S.STATUS.EXTRACTION_ERROR, errorMessage: 'browser error: ' + e.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { id: 'scraped_ota', parsePriceText, fillUrl, diagnoseFailure, fetchReading };
