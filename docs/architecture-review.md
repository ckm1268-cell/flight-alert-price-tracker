# Flight Price Alert Tracker — Architecture Review

Rule that drives every decision: **LIVE DATA → VALIDATE → COMPARE → ALERT → ACTION.**
A wrong "LIVE" label is worse than an honest "UNAVAILABLE".

## Decisions (confirmed with owner)
| Topic | Decision |
|---|---|
| Price source | **Hybrid**: Travelpayouts Data API as baseline + config-driven Playwright adapter(s) for live confirmation |
| Scope | Phase 1 + Phase 2 (accounts, per-user RLS, history chart, email) |
| Notifications | Browser notification + on-page banner, Email (Resend). Telegram deferred. |
| Frontend | Static PWA on GitHub Pages (publishable Supabase key only) |

## Diagram
```
User (mobile/desktop PWA)
  → GitHub Pages (static, no secrets)
  → Supabase: Postgres + RLS + magic-link auth   (browser uses publishable key only)
        ▲ service-role key, server-side only
  GitHub Actions (cron / workflow_dispatch)
     adapters → validation → compare + dedupe → notifications (Resend)
```

## Honest data model for flights
Flights differ from FX: a fare is a *quote for a route+dates*, and Travelpayouts returns **cached** fares
found by other users' searches, not a live inventory lookup.

- Every reading carries `dataKind`: `CACHED` (Travelpayouts) or `LIVE` (scraped page, fresh).
- `status = LIVE` means "retrieved from the intended source inside the freshness window".
  The UI additionally shows a **CACHED FARE · found Xh ago** badge so a cached fare is never read as live inventory.
- A cached fare whose `found_at` is older than `MAX_FARE_AGE_HOURS` (default 48) becomes `STALE` and cannot alert.
- Alerts say "fare of X found at <source>, verify before booking".

## Status vocabulary (fixed)
`LIVE`, `STALE`, `SOURCE_UNAVAILABLE`, `EXTRACTION_ERROR`, `SIMULATED`, `TARGET_REACHED`.
Alert row status: `ACTIVE`, `TRIGGERED`, `DISABLED`.

## Validation gate (before any comparison)
Reject and flag, never alert on: null / non-numeric / ≤0, wrong currency, wrong origin/destination/date,
price outside per-currency plausible range (decimal-shift guard), stale fare, page-load error.

## Alert logic
Default `<=` target. Also `<`, `>=`, `>`. Dedupe via `TRIGGERED` + `last_notified_price`; re-arm on edit/reset.
Fetch each unique (source, origin, destination, depart, return, currency) **once per run**, fan out to all users.

## Sources and compliance (OPEN — must be done by a human)
| Source | Method | Status |
|---|---|---|
| Travelpayouts `prices_for_dates` | JSON API, token in `X-Access-Token` | Implemented. Response shape from docs; **verify with a real token on first CI run.** |
| Scraped OTA/airline #1 | Playwright, config-driven | Adapter framework implemented, **disabled** until discovery (raw HTML vs JS-filled, JSON endpoint, robots.txt, ToS, CAPTCHA) is recorded in `config/websites/*.json`. |

No CAPTCHA/login/anti-bot bypass. Default interval 30 min for flights (fares move slowly; keeps the scraping footprint small).

## Security
- Browser: Supabase URL + publishable key only. Service-role, Resend key, Travelpayouts token live in Actions secrets.
- Isolation enforced by Postgres RLS (`auth.uid() = user_id`), not JS.
- Prices table readable by authenticated users, writable only by service role.

## Risks
1. Cached fares ≠ bookable fares → labelled everywhere.
2. Scraped OTA sites are fragile/ToS-sensitive → disabled by default, diagnostics on failure.
3. GitHub `schedule:` cron is best-effort → optional external cron hitting `workflow_dispatch`.
4. Fine-grained PATs expire (this bit the old tracker) → documented rotation in README.

## Phases
1. MVP: form, Travelpayouts adapter, current price vs target, status pills, browser alert, Pages deploy.
2. Accounts + RLS, history chart, Resend email, scheduler, second source.
3. Telegram, PWA push, admin/source-health dashboard.
