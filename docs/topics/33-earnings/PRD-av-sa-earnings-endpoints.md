**Topic:** Implement AV earnings-related endpoints (3)
**Issue:** #34
**Topic Parent:** #33
**Domain:** EARNINGS
**Type:** PRD
**Status:** Approved
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

## Problem Statement

Consumer applications need access to earnings data (historical actuals, forward estimates, and upcoming earnings dates) for tracked symbols. Currently, the three relevant Alpha Vantage endpoints — `EARNINGS`, `EARNINGS_ESTIMATES`, and `EARNINGS_CALENDAR` — have configurations and Firestore collection definitions but no handlers, no TypeScript types, and no refresh logic. The data is not being fetched or stored. Consumers have no way to read earnings data from Firestore.

This is the data layer for a broader earnings strategy: an earnings event calendar that will drive options trading strategies around earnings dates (60-45 days before earnings, day-of, post-earnings volatility crush). That event calendar is a future topic; this spec covers only getting the three endpoints' data into Firestore with the right shape and refresh behavior.

## Solution

Implement three Alpha Vantage endpoints as first-class members of the existing AV data refresh pipeline:

1. **EARNINGS** (per-symbol, JSON) — historical annual and quarterly EPS with surprise metrics
2. **EARNINGS_ESTIMATES** (per-symbol, JSON) — forward EPS and revenue estimates with analyst counts and revision history
3. **EARNINGS_CALENDAR_GLOBAL** (global, CSV) — upcoming earnings dates for all market companies, filtered to tracked symbols before storing

All three write to Firestore via the existing `saveAvData` mechanism. Two per-symbol docs are grouped under a single `earnings` subcollection per symbol. The global calendar doc lives at `market-data/av-earnings-calendar`.

A new `SavantApiEndpoint` enum (SA- prefix) provides the internal endpoint identity layer, separate from the raw AV API function names. This allows one AV function (e.g., `EARNINGS_CALENDAR`) to map to multiple internal endpoints without conflating "the AV API call" with "our internal endpoint concept."

A placeholder post-earnings refresh trigger reads the global calendar doc and force-refreshes EARNINGS for symbols whose earnings date has passed. This will be replaced by a proactive event calendar in a future topic.

## User Stories

1. As a consumer application developer, I want to read a tracked symbol's historical earnings (annual and quarterly EPS, surprise metrics) from Firestore, so that I can display earnings history without calling AV directly.
2. As a consumer application developer, I want to read a tracked symbol's forward earnings estimates (EPS, revenue, analyst counts, revision history) from Firestore, so that I can show analyst expectations.
3. As a consumer application developer, I want to read a specific symbol's upcoming earnings date from the earnings calendar, so that I can see when a company I'm tracking is reporting next — without making a new AV API call (derived from the global calendar doc).
4. As a consumer application developer, I want to read the global earnings calendar (filtered to tracked symbols) from Firestore, so that I can see which tracked symbols have upcoming earnings dates.
5. As a consumer application developer, I want all earnings data for a symbol grouped under a single Firestore subcollection, so that I can read all earnings data with one collection query instead of multiple separate reads.
6. As a system operator, I want EARNINGS to refresh on a 7-day TTL, so that historical earnings data is reasonably fresh without excessive API calls.
7. As a system operator, I want EARNINGS_ESTIMATES to refresh on an independent 7-day TTL, so that forward estimates stay current with analyst revisions.
8. As a system operator, I want the global earnings calendar to refresh daily, so that upcoming earnings dates are always current.
9. As a system operator, I want the global calendar to be filtered to tracked symbols before storing, so that the Firestore doc stays small and only contains relevant companies.
10. As a system operator, I want EARNINGS to be force-refreshed when a symbol's earnings date passes, so that actuals are captured promptly after earnings land.
11. As a system operator, I want EARNINGS_ESTIMATES to NOT be force-refreshed post-earnings, so that we don't fetch stale unrevised estimates (analyst revisions trickle in over days/weeks).
12. As a developer, I want a `SavantApiEndpoint` enum with SA- prefix that is separate from the raw AV function names, so that consumer-facing endpoint identity is decoupled from the AV API contract.
13. As a developer, I want the EARNINGS_CALENDAR handler to parse CSV (not JSON), so that it works with AV's CSV-only response format for this endpoint.
14. As a developer, I want the refresh manager to process NOT_SUPPORTED endpoints (no symbol in path) once per cycle, not once per tracked symbol, so that the global calendar and other symbol-less endpoints aren't wastefully re-checked N times.
15. As a future event calendar developer, I want the per-symbol earnings data structured so that a scheduler can read earnings dates and compute strategy start dates from them, so that the data model doesn't preclude the earnings event calendar.
16. As a consumer application developer, I want the global calendar to cover a 12-month horizon, so that I have a full year of earnings visibility for planning.
17. As a developer, I want the EARNINGS response to preserve `reportedDate` and `reportTime` from quarterly entries, so that the calendar trigger can cross-reference actual report timing.
18. As a developer, I want the EARNINGS_ESTIMATES response to handle nullable fields (e.g., `eps_estimate_revision_down_trailing_7_days` can be null), so that the TypeScript types are accurate.
19. As a developer, I want the CSV parser to handle quoted fields defensively, so that if a company name contains a comma in the future, parsing doesn't break.
20. As a future analyst, I want a market-wide earnings inventory report (hits/misses, surprises, track records) generated before filtering to tracked symbols, so that interesting companies not on the radar can be discovered. (Future topic — not built in this spec, but the handler preserves the full AV response in memory before filtering.)

## Implementation Decisions

### New: SavantApiEndpoint enum (SA- prefix)

A new consumer-facing endpoint identity layer, separate from the existing `AlphaVantageEndpoint` enum (which uses raw AV function names). The existing enum is kept as-is; the new SA- enum is used going forward.

**Critical distinction — two separate layers:**

1. **AV API calls** (backend → AV): what our refresh system does to fetch data. One call to `function=EARNINGS_CALENDAR` (no symbol, 12-month horizon) fetches the full market calendar. We filter to tracked symbols and store once.

2. **SA endpoints** (consumer → our Firestore): what consumer applications call to read data. These read from Firestore, not from AV. A per-symbol SA endpoint reads the global doc and filters — no new AV call.

```
SavantApiEndpoint.SA_EARNINGS                  → reads symbol-data/{symbol}/earnings/av-earnings (per-symbol Firestore doc)
SavantApiEndpoint.SA_EARNINGS_ESTIMATES        → reads symbol-data/{symbol}/earnings/av-earnings-estimates (per-symbol Firestore doc)
SavantApiEndpoint.SA_EARNINGS_CALENDAR         → reads market-data/av-earnings-calendar, filters to requested symbol (no AV call, no per-symbol doc)
SavantApiEndpoint.SA_EARNINGS_CALENDAR_GLOBAL  → reads market-data/av-earnings-calendar, returns all tracked symbols (no AV call)
```

The AV function names are unchanged — `EARNINGS`, `EARNINGS_ESTIMATES`, `EARNINGS_CALENDAR`. The SA- enum is our consumer-facing identity. Multiple SA endpoints can derive from the same AV call / Firestore doc.

### Three AV calls, four SA endpoints

One AV call to `EARNINGS_CALENDAR` (no symbol, 12-month horizon) fetches the full market calendar. We filter to tracked symbols and store once in `market-data/av-earnings-calendar`. Two SA endpoints derive from this one doc: `SA_EARNINGS_CALENDAR` (per-symbol view, filtered from global doc) and `SA_EARNINGS_CALENDAR_GLOBAL` (full tracked-symbols view). No per-symbol AV call needed for the calendar — the per-symbol SA endpoint filters the global doc in memory.

### Firestore schema

Per-symbol docs grouped under a single `earnings` subcollection:
- `symbol-data/{symbol}/earnings/av-earnings` — EARNINGS data
- `symbol-data/{symbol}/earnings/av-earnings-estimates` — EARNINGS_ESTIMATES data

Global doc:
- `market-data/av-earnings-calendar` — EARNINGS_CALENDAR_GLOBAL data (filtered to tracked symbols, 12-month horizon)

Config path changes:
- `EARNINGS`: `symbol-data/{symbol}/earnings/av-earnings` (already correct)
- `EARNINGS_ESTIMATES`: change from `symbol-data/{symbol}/earnings-estimates/av-earnings-estimates` → `symbol-data/{symbol}/earnings/av-earnings-estimates`
- Remove existing per-symbol `EARNINGS_CALENDAR` config
- Add `EARNINGS_CALENDAR_GLOBAL`: `market-data/av-earnings-calendar`, no symbol, `horizon=12month`

### AV API response shapes (verified against live responses)

**EARNINGS** (JSON): `{ symbol, annualEarnings: [{ fiscalDateEnding, reportedEPS }], quarterlyEarnings: [{ fiscalDateEnding, reportedDate, reportedEPS, estimatedEPS, surprise, surprisePercentage, reportTime }] }`. `reportTime` is `"pre-market"` or `"post-market"`.

**EARNINGS_ESTIMATES** (JSON): `{ symbol, estimates: [{ date, horizon, eps_estimate_average, eps_estimate_high, eps_estimate_low, eps_estimate_analyst_count, eps_estimate_average_7_days_ago, eps_estimate_average_30_days_ago, eps_estimate_average_60_days_ago, eps_estimate_average_90_days_ago, eps_estimate_revision_up_trailing_7_days, eps_estimate_revision_down_trailing_7_days, eps_estimate_revision_up_trailing_30_days, eps_estimate_revision_down_trailing_30_days, revenue_estimate_average, revenue_estimate_high, revenue_estimate_low, revenue_estimate_analyst_count }] }`. All numeric values are strings. Some fields can be `null`. `horizon` is `"fiscal year"` or `"fiscal quarter"`.

**EARNINGS_CALENDAR** (CSV): columns `symbol, name, reportDate, fiscalDateEnding, estimate, currency, timeOfTheDay`. `estimate` and `timeOfTheDay` can be empty strings. 12-month global response: ~1,814 data rows, ~99KB raw CSV. Zero embedded commas in real data.

### Handler architecture

- `AvEarningsHandler` — per-symbol, JSON, extends `AlphaVantageStandardHandlerBase`, implements `transformResponse`. Standard pattern.
- `AvEarningsEstimatesHandler` — per-symbol, JSON, extends `AlphaVantageStandardHandlerBase`, implements `transformResponse`. Standard pattern. Must handle nullable fields.
- `AvEarningsCalendarHandler` — global, CSV, extends `AlphaVantageBaseHandler`, overrides `fetch()`. Same override pattern as `AvHistoricalOptionsHandler`. The base's `fetch()` assumes JSON; CSV requires a custom fetch path. The handler: calls AV with CSV params → parses CSV → filters to tracked symbols → calls `saveAvData()` → returns `ApiResponse`. No separate retrieval service — CSV parse + filter is inline.

### CSV parsing

Hand-rolled parser, no external library. Verified zero embedded commas in 1,814 real rows. Add quoted-field handling as a defensive measure. Keeps the functions package lean.

### TTLs

- EARNINGS: 7 days (changed from existing 30d config)
- EARNINGS_ESTIMATES: 7 days (already configured)
- EARNINGS_CALENDAR_GLOBAL: 1 day (already configured for per-symbol; carry over to global)

### Global calendar filtering

The handler fetches the full 12-month CSV response from AV (~1,814 rows), parses it, filters to only symbols in the `tracked_symbols` Firestore collection, and stores the filtered list. After filtering to ~100 tracked symbols with ~4 earnings each, the stored doc is ~60-80KB — well under Firestore's 1MB limit.

### Refresh manager fix

The existing refresh manager loops per-symbol. For `NOT_SUPPORTED` endpoints (no `{symbol}` in path), it resolves the same doc path on every iteration — first call refreshes, rest skip. This is existing waste that affects `IPO_CALENDAR`, economic indicators, and now `EARNINGS_CALENDAR_GLOBAL`. Fix: process `NOT_SUPPORTED` endpoints once, outside the per-symbol loop. Design the correct approach first, then reconcile with existing code.

### Design principle

The existing non-time-series refresh code (refresh manager, handler base classes, factory) was written a long time ago and should be considered suspect. Design the correct approach first, then reconcile with existing code. If existing code is usable, use it; if not, correct it.

### Calendar-triggered refresh (Phase 1 placeholder)

A daily scheduled job reads the global calendar doc, finds entries where `reportDate` is in the past 24 hours, and enqueues Cloud Tasks to force-refresh EARNINGS for those symbols. This is a placeholder for the future earnings event calendar, which will be proactive (schedule all events from known dates upfront) rather than reactive (sweep for past dates). EARNINGS_ESTIMATES is NOT part of this trigger.

### Note on saveAvData

The existing `saveAvData` writer (`av-standard-data.writer.ts`) has no test coverage. Handler tests should mock it rather than rely on it. This is noted as a risk but not in scope for this spec to fix.

## Testing Decisions

### Seam 1: Handler tests (Jest, mock axios)

Test each handler's transformation/fetch logic with mock AV responses, following the pattern in `historical-options-retrieval.service.test.ts`:

- `AvEarningsHandler.transformResponse()` — feed mock EARNINGS JSON, verify transformed output shape (annual + quarterly arrays, field names, `reportTime` preserved)
- `AvEarningsEstimatesHandler.transformResponse()` — feed mock EARNINGS_ESTIMATES JSON, verify transformed output shape including null field handling
- `AvEarningsCalendarHandler.fetch()` — feed mock EARNINGS_CALENDAR CSV, verify: CSV parsing, tracked-symbol filtering, empty-response handling (headers only → empty array), and that `saveAvData` is called with the filtered result

Mock `saveAvData` in the calendar handler test — do not rely on the untested writer.

### Seam 2: Config tests (Jest, pure assertions)

Following the pattern in `av-technical-indicators-config.test.ts`:

- Verify `SavantApiEndpoint` enum has the four SA- values
- Verify each SA- endpoint maps to the correct AV function name (or derives from the correct Firestore doc)
- Verify `EARNINGS_CALENDAR` config has `horizon=12month`, no symbol parameter, correct firestorePath
- Verify `EARNINGS` and `EARNINGS_ESTIMATES` configs have the grouped `earnings/` firestorePath
- Verify `EARNINGS` TTL is 7 days (not the old 30 days)

### Seam 3: CSV parser utility tests (Jest, pure function)

- Test parsing with a real 12-month response sample (verify row count, field values)
- Test edge cases: empty fields (`estimate` and `timeOfTheDay` can be empty), empty response (headers only → empty array), quoted fields with embedded commas (defensive test)

### What NOT to test

- `saveAvData` — untested in the codebase, not in scope to fix. Mock it in handler tests.
- Firestore integration — the write path goes through existing infrastructure. No emulator-based integration tests for this spec.
- The refresh manager fix — tested separately if/when that fix is implemented; not coupled to the handler tests.

## Out of Scope

- **Earnings Research Venue** — a per-symbol earnings profile synthesizing all three endpoints. Future topic.
- **Earnings Options Trading Calendar** — the proactive event calendar that computes options strategy timelines from earnings dates. Future topic.
- **Market-Wide Earnings Inventory Report** — hits/misses, surprises, track records for all companies before filtering to tracked symbols. Discovery tool for finding interesting companies off the radar. Future topic. The handler preserves the full AV response in memory before filtering, so a future report generator can use it.
- **Per-symbol EARNINGS_CALENDAR AV call** — no per-symbol AV call needed. The per-symbol SA endpoint derives from the global doc. No per-symbol Firestore doc for the calendar.
- **6-month or 12-month horizon variants as separate docs** — the global doc uses 12-month horizon. If longer is needed, extend the horizon. No separate horizon docs.
- **Partner API endpoints for earnings data** — consumers read directly from Firestore. A partner endpoint can be evaluated later based on consumer feedback.
- **Fixing `saveAvData` test coverage** — noted as a risk but not in scope.
- **Benzinga earnings data** — the data-maintainer plan references Benzinga's "Future Earnings Dates & Results" endpoint. That's a separate provider and not part of this AV-only spec.

## Further Notes

- **Strategic context:** This is the data layer for an earnings event calendar that will drive options trading strategies. The event calendar will be proactive — earnings dates are known 12 months out, so all strategy start dates can be computed upfront. The placeholder post-earnings refresh trigger in this spec will be replaced by that proactive scheduler.
- **Future topics to create (do not forget):** (1) Earnings Research Venue — research by company and tracked-symbols-wide. (2) Earnings Options Trading Calendar — just the calendar for consumers to implement trading on. (3) Market-Wide Earnings Inventory Report — pre-filter discovery tool for finding interesting companies off the radar.
- **EARNINGS/ESTIMATES field overlap:** EARNINGS quarterly entries include `estimatedEPS` and `surprise` — this overlaps with EARNINGS_ESTIMATES but for historical quarters only. Different purposes (historical actuals vs. forward estimates); not a conflict.
- **Design session document:** Full grilling session notes at `planning/earnings-trio-implementation-session.md`.
- **Domain glossary:** Earnings Event Calendar added to `CONTEXT.md`.
