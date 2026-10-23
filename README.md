# Flight Alert Price Tracker

Multi-user flight fare alert PWA. **LIVE DATA → VALIDATE → COMPARE → ALERT → ACTION.**
Static UI on GitHub Pages, Supabase (Postgres + RLS + magic-link auth), scheduled backend on GitHub Actions, email via Resend, in-browser alerts.

> Honesty rule: Travelpayouts returns **cached fares** found by other searches. The UI labels them `CACHED FARE` and alerts say "verify before booking". Nothing simulated is ever shown as live.

## Repo layout
```
frontend/    index.html app.js styles.css sw.js config.js manifest.webmanifest shared/shared.js (UMD, shared with backend)
backend/     scrapers/*.adapter.js  validation.js  compare.js  notifications/  scheduler/run.js
config/websites/   travelpayouts.json  scraped_ota.json (disabled template)
database/schema.sql          idempotent; tables + RLS + re-arm trigger
tests/       core.test.js + fixtures/   (node --test tests/*.test.js)
.github/     workflows/monitor.yml  workflows/pages.yml  scripts/cache_bust_frontend.py
docs/architecture-review.md  project-status.md
```

## Setup (about 20 minutes)
1. **GitHub**: create a new public repo, push this folder. Settings → Pages → Source: *GitHub Actions*.
2. **Supabase**: new project → SQL editor → run `database/schema.sql`. Authentication → URL configuration → set Site URL to your Pages URL (and add it to redirect URLs).
3. **Repo variables** (Settings → Secrets and variables → Actions → *Variables*): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (public, publishable/anon key only).
4. **Repo secrets**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TRAVELPAYOUTS_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM`. Paste these yourself; never share them in chat.
5. **Resend**: verify a sending domain (the default `onboarding@resend.dev` sender only delivers to your own Resend account email).
6. Push to `main` → Pages deploys. Run **Actions → Price monitor → Run workflow** once and read the log.

## Local
```
npm test                 # 19 unit tests, no network
MOCK=1 node backend/scheduler/run.js     # SIMULATED data, never notifies
DRY_RUN=1 node backend/scheduler/run.js  # real fetches, no DB writes/emails (needs env)
```

## Status vocabulary
`LIVE` (retrieved from the intended source within the freshness window) · `STALE` (cached fare older than `MAX_FARE_AGE_HOURS`) · `SOURCE_UNAVAILABLE` · `EXTRACTION_ERROR` · `SIMULATED` · `TARGET_REACHED`. Hover the status pill to see the stored `error_message`.

## Adding the scraped source (hybrid)
Disabled on purpose. Before enabling `config/websites/scraped_ota.json`: open the site in a real browser, record whether the price is in raw HTML or JS-filled, whether the page calls an unauthenticated JSON endpoint, robots.txt (404 ≠ permission), Terms of Use (read by a human), CAPTCHA/login, and whether an official API exists. Never bypass CAPTCHA, login or anti-bot controls. Then fill the selectors, set `"enabled": true`, enable the checkbox in `frontend/index.html`, and capture a real fixture into `tests/fixtures/`.

## Scheduler reliability
GitHub's `schedule:` is best-effort and may lag. For tighter timing, have an external cron (e.g. cron-job.org) POST `https://api.github.com/repos/OWNER/REPO/actions/workflows/monitor.yml/dispatches` with body `{"ref":"main"}` and headers `Authorization: Bearer <fine-grained PAT, Actions: write>`, `Accept: application/vnd.github+json`. **Fine-grained PATs expire** — set a calendar reminder to rotate; an expired token returns 401 "Bad credentials" and the monitor silently stops.

## Security
Browser holds only the publishable key. Per-user isolation is Postgres RLS. Service-role, Resend and Travelpayouts keys exist only as Actions secrets. `prices` is read-only to users.

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| Pill says SOURCE UNAVAILABLE, tooltip "token rejected" | Rotate `TRAVELPAYOUTS_TOKEN` |
| "no cached fare found" | Normal for sparse routes/dates; try a nearby date or a month |
| New HTML but old behaviour / TypeError | Stale service-worker cache; bump `SHELL_VERSION` (CI does) and hard-reload |
| No emails | Resend domain not verified, or `RESEND_FROM` mismatched; check `notifications.delivery_status` |
| Alert never re-fires | By design (dedupe). Edit target/dates or press Re-arm |
| Magic link opens wrong page | Supabase Site URL / redirect URLs |

## Changelog
- 0.1.0 — Initial build: Phase 1 + 2 (accounts, RLS, history chart, email, browser alerts), Travelpayouts adapter, disabled scraped-OTA template.
