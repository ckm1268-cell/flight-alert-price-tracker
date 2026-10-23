# Project status

**Version:** 0.1.0 (not yet a git repo / not deployed) · **Tests:** 19 passing (`node --test tests/*.test.js`) · **Shell cache:** v1 (CI replaces with commit sha)

## Verified in the build sandbox
- Unit tests for parsing, validation gate, compare/dedupe, email sender, scheduler fan-out, MOCK safety.
- `node --check` on frontend JS; cache-bust script output checked.

## NOT verified (needs a human / first CI run)
- Real Travelpayouts response shape (fixture is **synthetic**). Confirm `prices_for_dates` fields and whether `found_at` is present; if absent, `sourceTimestamp` is null and the staleness check cannot fire, so check `data[].departure_at`/response metadata and adjust.
- Supabase schema applied, magic-link login, RLS behaviour with two real users.
- Resend delivery. Frontend rendered in a real browser (UI is code-traced only).
- Scraped OTA source: not chosen, not discovered, disabled.

## Open items
1. Pick the scraped source and complete discovery/ToS review.
2. Replace synthetic fixture with a captured real response.
3. Add PWA icons; Phase 3 (Telegram, push, admin/source-health).
4. Consider origin→alternate-airport alerts (the old tracker documented but never implemented this — do it end-to-end or not at all).

## Next single step
Create the Supabase project, run `database/schema.sql`, add secrets, then run the Price monitor workflow once.
