# Earnings Trio Implementation — Project Idea Session

> Scope: Implement `EARNINGS`, `EARNINGS_ESTIMATES`, and `EARNINGS_CALENDAR` as a coordinated unit, with a calendar-triggered smart refresh that ties them together.
>
> Related: `planning/av-non-time-series-plan.md` (broader non-time-series plan), `.devin/rules/data-maintainer.md` (architecture rules)
>
> Date: 2026-08-22

---

## Why These Three as a Unit

These endpoints have a natural data dependency that makes implementing them together more valuable than implementing them independently:

- **EARNINGS_CALENDAR** tells you *when* a company will report earnings.
- **EARNINGS** tells you *what* they actually reported (historical EPS, annual + quarterly).
- **EARNINGS_ESTIMATES** tells you *what analysts expected* (EPS/revenue estimates, revision history).

A consumer viewing an earnings event needs all three: the upcoming date, the consensus estimate, and — once the report lands — the actual result. Implementing them independently with fixed TTLs would mean EARNINGS could be up to 30 days stale after an actual report lands. Implementing them as a unit with a calendar trigger means EARNINGS refreshes immediately after the earnings date passes.

---

## Current State

All three endpoints have **configs but no handlers, no TypeScript types, and no factory wiring**.

| Endpoint | Config | TTL (current) | firestorePath | Handler | Types |
|---|---|---|---|---|---|
| `EARNINGS` | `av-endpoint-configs.ts:105` | 30 days | `symbol-data/{symbol}/earnings/av-earnings` | None | None |
| `EARNINGS_ESTIMATES` | `av-endpoint-configs.ts:149` | 7 days | `symbol-data/{symbol}/earnings-estimates/av-earnings-estimates` | None | None |
| `EARNINGS_CALENDAR` | `av-endpoint-configs.ts:254` | 1 day | `symbol-data/{symbol}/earnings-calendar/av-earnings-calendar` | None | None |

Firestore collection names already exist in the `FirestoreCollection` enum (`firestore.ts:74-77`).

The existing `AlphaVantageStandardHandlerBase` + `saveAvData` pattern handles the full fetch → transform → Firestore write pipeline for non-time-series endpoints and is ready to use.

---

## Decisions from Session

### 1. EARNINGS_CALENDAR: Both global + per-symbol

**Decision:** Store the calendar in two forms:
- A **global doc** containing the broad upcoming earnings list (no symbol filter, using AV's `horizon` parameter for 3/6/12 month windows). This matches the data-maintainer rules' "broad list of upcoming company earnings" description and lets consumers browse upcoming earnings across all tracked symbols.
- **Per-symbol docs** for each tracked symbol's calendar entry. These are what the calendar-triggered refresh logic scans to detect when an earnings date has passed.

**Implications:**
- Modeled as two separate enum values: `EARNINGS_CALENDAR` (per-symbol) and `EARNINGS_CALENDAR_GLOBAL` (global). Each has its own config entry with its own `firestorePath` and `parameters`. This keeps the config model clean — one endpoint = one path — and `saveAvData` works unchanged for both.
- `EARNINGS_CALENDAR` config: `firestorePath = symbol-data/{symbol}/earnings-calendar/av-earnings-calendar`, `symbol` required.
- `EARNINGS_CALENDAR_GLOBAL` config: `firestorePath = market-data/av-earnings-calendar`, no `symbol` parameter, `horizon=12month` parameter.
- The handler fetches the global calendar (no symbol, 12-month horizon), parses CSV, filters to tracked symbols, and stores the filtered doc.

### 2. Refresh model: Calendar-triggered

**Decision:** When an earnings date in the calendar passes, trigger an immediate EARNINGS refresh for that symbol, regardless of TTL.

**How it works:**
1. EARNINGS_CALENDAR is refreshed on its own TTL (daily) to catch date changes/delays.
2. A daily sweep job reads the global calendar doc, finds all earnings dates that have passed in the last 24 hours, and enqueues Cloud Tasks to force-refresh EARNINGS (and optionally EARNINGS_ESTIMATES) for those symbols.
3. EARNINGS and EARNINGS_ESTIMATES still have baseline TTLs as a safety net — they refresh on TTL even if no earnings event triggers them.

**TTLs are not obsoleted by the smart trigger — they serve different purposes:**
- **TTL = floor/baseline cadence.** Ensures data refreshes even when nothing eventful happens. EARNINGS_ESTIMATES needs this because analyst estimates drift over time with no discrete trigger. EARNINGS_CALENDAR needs this because earnings dates shift.
- **Calendar trigger = event-driven refresh on top of TTL.** Gets actual results in fast after an earnings event.

The effective refresh schedule becomes: `refresh when now >= nextUpdate (TTL-based) OR when a calendar event triggers a force-refresh`.

### 3. Consumer access: Firestore reads (recommended), partner endpoint as future option

**Recommendation:** Firestore reads for consumers. No partner endpoint needed for now.

**Rationale:**
- Earnings payloads are small (a few KB — quarterly EPS numbers, estimate arrays, calendar entries). No Firestore 1MB doc limit concern.
- The data-maintainer architecture is Firestore-first: backend keeps Firestore fresh, clients read from it.
- Partner endpoints (`partnerHistoricalOptionsV2`, etc.) exist for cases where Firestore isn't suitable (e.g., options chains exceeding 1MB). That constraint doesn't apply here.
- A partner endpoint can be added later if a use case demands live fallback to AV.

**Tradeoff table (for future reference):**

| | Firestore reads | Partner endpoint |
|---|---|---|
| Latency | ~50-100ms (direct doc read) | ~500ms-2s (HTTP + possible live AV fetch) |
| Freshness | As fresh as last refresh cycle | Can do live fetch if stale/missing |
| Cost | Firestore read charges (cheap) | Cloud Run + AV API calls |
| Auth | Firestore Security Rules | OIDC/service account auth (existing pattern) |
| Complexity | Low — clients just read docs | Medium — new HTTP function, auth, error handling |
| Fallback | None if doc is missing/stale | Can fall back to live AV fetch |

**Open question (deferred):** Whether to add a partner endpoint later for on-demand fallback. Decide after the Firestore-first path is live and we see if consumers hit missing/stale data.

### 4. TTL values: TTL as floor + calendar trigger as accelerator

**Decision:** Keep TTLs as baseline floor values, with the calendar trigger as an accelerator. The TTLs need adjustment from current config values:

| Endpoint | Current config TTL | Proposed TTL | Rationale |
|---|---|---|---|
| `EARNINGS` | 30 days | 7 days | Floor refresh; calendar trigger handles post-earnings freshness. 7d as starting point; may tighten to 1d later if freshness demands it. |
| `EARNINGS_ESTIMATES` | 7 days | 7 days (keep) | Estimates drift; 7d is reasonable. Independent TTL only — not part of the calendar trigger (see decision below). |
| `EARNINGS_CALENDAR` | 1 day | 1 day (keep) | Dates shift frequently; daily re-fetch catches changes. |

These are starting points — adjustable in `av-endpoint-configs.ts` without code changes.

---

## Implementation Design

### TypeScript Types (new files in `shared/alpha-vantage/`)

Response shapes verified against live AV API responses (demo key, 2026-08-22):

**EARNINGS** (JSON response):
- `shared/alpha-vantage/av-earnings.ts` — `AvEarningsResponse` with `symbol`, `annualEarnings[]`, `quarterlyEarnings[]`
- `AvAnnualEarning`: `{ fiscalDateEnding, reportedEPS }`
- `AvQuarterlyEarning`: `{ fiscalDateEnding, reportedDate, reportedEPS, estimatedEPS, surprise, surprisePercentage, reportTime }`
- Note: `quarterlyEarnings` includes `estimatedEPS` and `surprise` metrics — overlaps with EARNINGS_ESTIMATES but for historical quarters only.
- Note: `reportedDate` and `reportTime` (`"pre-market"` / `"post-market"`) are present in quarterly entries — useful for the calendar trigger as a cross-reference.

**EARNINGS_ESTIMATES** (JSON response):
- `shared/alpha-vantage/av-earnings-estimates.ts` — `AvEarningsEstimatesResponse` with `symbol`, `estimates[]`
- `AvEarningsEstimate`: `{ date, horizon ("fiscal year" | "fiscal quarter"), eps_estimate_average, eps_estimate_high, eps_estimate_low, eps_estimate_analyst_count, eps_estimate_average_7_days_ago, eps_estimate_average_30_days_ago, eps_estimate_average_60_days_ago, eps_estimate_average_90_days_ago, eps_estimate_revision_up_trailing_7_days, eps_estimate_revision_down_trailing_7_days, eps_estimate_revision_up_trailing_30_days, eps_estimate_revision_down_trailing_30_days, revenue_estimate_average, revenue_estimate_high, revenue_estimate_low, revenue_estimate_analyst_count }`
- All numeric values are returned as strings (e.g., `"13.1749"`, `"73259816370.00"`). Some fields can be `null` (e.g., `eps_estimate_revision_down_trailing_7_days`).

**EARNINGS_CALENDAR** (CSV response — NOT JSON):
- `shared/alpha-vantage/av-earnings-calendar.ts` — `AvEarningsCalendarEntry`, `AvEarningsCalendarResponse`
- CSV columns: `symbol, name, reportDate, fiscalDateEnding, estimate, currency, timeOfTheDay`
- `AvEarningsCalendarEntry`: `{ symbol, name, reportDate, fiscalDateEnding, estimate?, currency, timeOfTheDay? }`
- `estimate` and `timeOfTheDay` can be empty strings in the CSV.
- **Critical:** This endpoint returns CSV, not JSON. The handler cannot use the standard `AlphaVantageStandardHandlerBase` fetch path (which reads `response.data` as JSON). It must parse CSV.
- **Critical:** The global response (no symbol filter, 12-month horizon) contains ~1,800 entries (~99KB raw CSV) — too large for a single Firestore doc as-is. The handler must filter to tracked symbols before storing. After filtering, the doc is ~60-80KB — well under Firestore's 1MB limit.
- **No per-symbol calendar endpoint.** The global doc (filtered to tracked symbols) is sufficient. Verified that per-symbol AV response is an exact subset of the global response — same fields, same values. If longer visibility is needed later, extend the global horizon.

### Handlers (new files in `functions/src/v2/alpha-vantage/handlers/`)

- `av-earnings.handler.ts` — `AvEarningsHandler` (per-symbol, JSON, extends `AlphaVantageStandardHandlerBase`, standard pattern — just implement `transformResponse`)
- `av-earnings-estimates.handler.ts` — `AvEarningsEstimatesHandler` (per-symbol, JSON, extends `AlphaVantageStandardHandlerBase`, standard pattern — just implement `transformResponse`)
- `av-earnings-calendar.handler.ts` — `AvEarningsCalendarHandler` (CSV parsing, global only — `SA_EARNINGS_CALENDAR_GLOBAL`). Extends `AlphaVantageBaseHandler` and overrides `fetch()` — same pattern as `AvHistoricalOptionsHandler`. The base's `fetch()` and `StandardHandlerBase`'s `fetch()` both assume JSON (`response.data` as object); CSV requires a custom fetch path. The handler gets `this.apiClient`, `this.baseParams`, `this.config`, `createSuccessResponse()` from the base, then does: call AV with CSV params → parse CSV → filter to tracked symbols → call `saveAvData()` → return `ApiResponse`. No separate retrieval service needed (unlike historical options) — CSV parse + filter is simple enough to be inline.

### Factory Wiring

Add all three to `HANDLER_MAP` in `alpha-vantage-factory.ts` and to `AV_IMPLEMENTED_ENDPOINTS` in `av-endpoints.ts`.

### Firestore Schema

**Per-symbol docs** — grouped under a single `earnings` subcollection per symbol (written by `saveAvData`):
```
symbol-data/{symbol}/earnings/av-earnings             → { data, metadata: { lastUpdated, nextUpdate, ttlSeconds, ... } }
symbol-data/{symbol}/earnings/av-earnings-estimates   → { data, metadata: { ... } }
```
Two per-symbol docs in the same `earnings` collection, distinguished by doc name. This groups related data together — one collection query gets all earnings data for a symbol.

**Config path changes required:**
- `EARNINGS`: keep `symbol-data/{symbol}/earnings/av-earnings` (already correct)
- `EARNINGS_ESTIMATES`: change from `symbol-data/{symbol}/earnings-estimates/av-earnings-estimates` → `symbol-data/{symbol}/earnings/av-earnings-estimates`

**Global calendar doc** (new path needed):
```
market-data/av-earnings-calendar                             → { data: [...entries filtered to tracked symbols], metadata: { lastUpdated, nextUpdate, ttlSeconds, horizon: "12month", ... } }
```
The global calendar is filtered to tracked symbols only before storing. The full AV response contains ~1,800 entries (every company reporting in the next 12 months, ~99KB raw CSV) — too large for a single Firestore doc and mostly irrelevant since we only have data for tracked symbols. The handler fetches the full CSV response, parses it, filters to symbols in `tracked_symbols`, and stores only the filtered entries (~60-80KB).

Extension point: if longer horizons are added later, use separate docs (e.g., `market-data/av-earnings-calendar-6mo`, `market-data/av-earnings-calendar-12mo`). The `horizon` value in metadata distinguishes them.

### Strategic Context: Earnings Event Calendar (Future Phase)

The earnings data is not just for display — it's the foundation for an **earnings event calendar** that drives options trading strategies. The vision:

- For each tracked symbol, we synthesize the three endpoints' data into a per-symbol earnings timeline: historical actuals (EARNINGS), forward estimates (EARNINGS_ESTIMATES), and upcoming dates (EARNINGS_CALENDAR).
- Options strategies around earnings have specific timing windows: some start 60-45 days before earnings (DBE), some 1 day before, some day-of, and post-earnings there's volatility crush to monitor.
- We'll develop a list of options strategies that work for earnings, then for each symbol tie the strategy schedule to that company's earnings dates.
- The earnings dates are known 12 months out (from EARNINGS_CALENDAR), so we can compute the entire cycle timeline upfront and schedule timed triggers for each phase — not react after the fact.
- This repeats every quarter for many tracked symbols.

**Implication for this implementation:** The three endpoints are the data layer. The event calendar and options strategy triggers are a future phase that consumes this data. For now, we get the data into Firestore with the right shape. The data model must not preclude the event calendar — specifically, the per-symbol earnings data should be structured so a future scheduler can read earnings dates and compute strategy start dates from them.

**Implication for the calendar trigger:** The original "reactive sweep" model (scan for past earnings dates, refresh EARNINGS) is the wrong framing. The real trigger will be **proactive** — we already have the dates, so we schedule events against them. The post-earnings EARNINGS refresh is just one event in the cycle. For now, we'll implement a simple post-earnings refresh as a placeholder, but the architecture should anticipate the fuller event calendar.

### Calendar-Triggered Refresh (Phase 1 — Placeholder for Event Calendar)

For now, a simple post-earnings refresh:

New component: a daily scheduled job (Cloud Scheduler → Pub/Sub → Cloud Function) that:
1. Reads the global `market-data/av-earnings-calendar` doc (filtered to tracked symbols, refreshed daily).
2. Finds entries where `reportDate` is in the past 24 hours (i.e., earnings have just landed).
3. For each such symbol, enqueues a Cloud Task to force-refresh `EARNINGS` only.
4. The Cloud Task handler calls the existing `AvEarningsHandler.fetch({ symbol })` with a force flag that bypasses TTL.

This is a new function, tentatively `triggerPostEarningsRefresh`, living alongside the existing refresh schedulers.

**Note:** This is a placeholder. The future earnings event calendar will replace this with a proactive scheduler that computes all event dates (strategy starts, monitoring windows, post-earnings refresh) from the known earnings dates upfront. The sweep timing concern (pre-market vs post-market) becomes moot because the event calendar will know the `timeOfTheDay` for each earnings date and schedule accordingly.

**EARNINGS_ESTIMATES is NOT part of the calendar trigger.** Estimates are forward-looking expectations; the calendar trigger is about getting fresh actuals. Post-earnings, the estimates for the just-reported quarter are irrelevant, and analyst revisions for future quarters trickle in over days/weeks — not immediately. Force-refreshing estimates the moment earnings lands would likely fetch stale estimates that haven't been revised yet. EARNINGS_ESTIMATES lives on its own independent 7d TTL.

### Config Changes

**New: `SavantApiEndpoint` enum (SA- prefix)**

We need a new internal endpoint identity layer that's separate from the raw AV API function names. The existing `AlphaVantageEndpoint` enum uses raw AV names (e.g., `EARNINGS`, `EARNINGS_CALENDAR`) and conflates "the AV API function we call" with "our internal endpoint concept." This breaks down when one AV function serves multiple SA endpoints (e.g., per-symbol calendar view vs. global calendar view both derive from one AV call).

**Critical distinction — two separate layers:**

1. **AV API calls** (backend → AV): what our refresh system does to fetch data from Alpha Vantage. One call to `function=EARNINGS_CALENDAR` (no symbol, 12-month horizon) fetches the full market calendar. We filter to tracked symbols and store once in `market-data/av-earnings-calendar`.

2. **SA endpoints** (consumer → our Firestore): what consumer applications call to read data. These read from Firestore, not from AV. A per-symbol SA endpoint reads the global doc and filters — no new AV call.

```
SavantApiEndpoint.SA_EARNINGS                  → reads symbol-data/{symbol}/earnings/av-earnings (per-symbol Firestore doc)
SavantApiEndpoint.SA_EARNINGS_ESTIMATES        → reads symbol-data/{symbol}/earnings/av-earnings-estimates (per-symbol Firestore doc)
SavantApiEndpoint.SA_EARNINGS_CALENDAR         → reads market-data/av-earnings-calendar, filters to requested symbol (no AV call, no per-symbol doc)
SavantApiEndpoint.SA_EARNINGS_CALENDAR_GLOBAL  → reads market-data/av-earnings-calendar, returns all tracked symbols (no AV call)
```

The AV function names are unchanged — `EARNINGS`, `EARNINGS_ESTIMATES`, `EARNINGS_CALENDAR`. The SA- enum is our consumer-facing identity. Multiple SA endpoints can derive from the same AV call / Firestore doc.

**Design principle:** The existing non-time-series refresh code (refresh manager, handler base classes, factory) was written a long time ago and should be considered suspect. Design the correct approach first, then reconcile with existing code. If existing code is usable, use it; if not, correct it. Don't be constrained by legacy patterns.

1. `av-endpoint-configs.ts`:
   - Change `EARNINGS_ESTIMATES` `firestorePath` from `symbol-data/{symbol}/earnings-estimates/av-earnings-estimates` → `symbol-data/{symbol}/earnings/av-earnings-estimates`.
   - `EARNINGS` `firestorePath` is already correct: `symbol-data/{symbol}/earnings/av-earnings`.
   - Remove the existing `EARNINGS_CALENDAR` per-symbol config (no longer needed — global only).
   - Add new `EARNINGS_CALENDAR_GLOBAL` config entry: no `symbol` parameter, `horizon=12month` parameter, `firestorePath = market-data/av-earnings-calendar`.
   - Adjust `EARNINGS` TTL from 30d to 7d.

2. `av-endpoints.ts`:
   - Add `EARNINGS_CALENDAR_GLOBAL` to the `AlphaVantageEndpoint` enum (for the AV function name).
   - Add `EARNINGS`, `EARNINGS_ESTIMATES`, `EARNINGS_CALENDAR_GLOBAL` to `AV_IMPLEMENTED_ENDPOINTS` (three, not four — no per-symbol calendar).

3. New: `savant-endpoints.ts` (or similar):
   - Define `SavantApiEndpoint` enum with `SA_` prefix.
   - Map each SA- endpoint to its AV function name and config.

4. `alpha-vantage-factory.ts`:
   - Add `EARNINGS`, `EARNINGS_ESTIMATES`, `EARNINGS_CALENDAR_GLOBAL` to `HANDLER_MAP`.

---

## Implementation Phases

### Phase 1: Types + Handlers + Factory Wiring
- Define TypeScript types for all three endpoints (verified against AV docs — see above).
- Implement `AvEarningsHandler` and `AvEarningsEstimatesHandler` (JSON, extend `AlphaVantageStandardHandlerBase`).
- Implement `AvEarningsCalendarHandler` (CSV, extends `AlphaVantageBaseHandler`, overrides `fetch()`).
- Define `SavantApiEndpoint` enum with `SA_` prefix.
- Wire all three into factory and `AV_IMPLEMENTED_ENDPOINTS`.
- Verify: manual fetch for a test symbol (e.g., AAPL) writes to Firestore for EARNINGS and EARNINGS_ESTIMATES; manual fetch for global calendar writes filtered doc to `market-data/av-earnings-calendar`.

### Phase 2: Standard Refresh
- Confirm EARNINGS and EARNINGS_ESTIMATES refresh correctly via the refresh manager per-symbol path.
- Resolve the `EARNINGS_CALENDAR_GLOBAL` refresh path (open question #8) — either fix the refresh manager for `NOT_SUPPORTED` endpoints or add a dedicated scheduled function.
- Verify: refresh cycle picks up all three endpoints.

### Phase 3: Calendar-Triggered Smart Refresh
- Implement `triggerPostEarningsRefresh` scheduled function.
- Implement Cloud Task queue for post-earnings force-refresh.
- Wire EARNINGS as the task handler (EARNINGS_ESTIMATES is not part of this trigger).
- Verify: simulate an earnings date passing, confirm EARNINGS is force-refreshed.

### Phase 4: Consumer Access + Firestore Rules
- Confirm Firestore security rules allow client read access to the earnings collections.
- Document the Firestore paths and data shapes for consumer app developers.
- (Deferred) Evaluate whether a partner endpoint is needed based on consumer feedback.

---

## Open Questions

1. ~~**EARNINGS_ESTIMATES in the calendar trigger?**~~ **Resolved:** No. EARNINGS_ESTIMATES lives on its own independent 7d TTL. The calendar trigger is for getting fresh actuals (EARNINGS), not forward-looking estimates. Post-earnings, estimates for the just-reported quarter are irrelevant and analyst revisions for future quarters trickle in over days/weeks, so an immediate force-refresh would likely fetch stale unrevised estimates.

2. ~~**Global calendar `horizon` value:**~~ **Resolved:** 12-month horizon. Verified against real AV response (1,814 data rows, 99KB raw CSV) — only ~8KB larger than 3-month (1,639 rows, 92KB) because most companies only have 1-2 confirmed earnings dates even in a 12-month window. Full year of visibility for the event calendar at negligible extra cost. One global doc at `market-data/av-earnings-calendar`. After filtering to tracked symbols, the stored doc is ~60-80KB — well under Firestore's 1MB limit.

3. ~~**EARNINGS_CALENDAR config split:**~~ **Resolved:** Global only — `SA_EARNINGS_CALENDAR_GLOBAL` (global, `market-data/av-earnings-calendar`, `horizon=12month`). No per-symbol calendar endpoint. The global doc is filtered to tracked symbols before storing. `saveAvData` works unchanged.

4. ~~**EARNINGS TTL adjustment:**~~ **Resolved:** Set to 7 days as the floor. May tighten to 1 day later if freshness demands it, but 7d is the starting point. The calendar trigger handles post-earnings freshness; the TTL is just the safety net for non-earnings periods.

5. ~~**AV API response shapes:**~~ **Resolved:** Verified against live AV API responses (demo key, 2026-08-22). See the TypeScript Types section above for the exact field names and shapes. Key findings: EARNINGS and EARNINGS_ESTIMATES return JSON; EARNINGS_CALENDAR returns CSV. EARNINGS quarterly entries include `reportedDate` and `reportTime` (useful for calendar trigger cross-reference). EARNINGS_ESTIMATES returns all numeric values as strings with some nullable fields.

6. ~~**Internal endpoint identity vs. AV function name:**~~ **Resolved:** New `SavantApiEndpoint` enum with `SA_` prefix. See the Config Changes section. The existing `AlphaVantageEndpoint` enum is kept as-is (raw AV names); the new SA- enum is our internal identity layer. Two SA- endpoints can map to the same AV function (e.g., per-symbol and global calendar both call `function=EARNINGS_CALENDAR`).

7. ~~**Per-symbol EARNINGS_CALENDAR redundancy:**~~ **Resolved:** Drop per-symbol calendar. The global doc (filtered to tracked symbols) is sufficient. Verified that the per-symbol AV response is an exact subset of the global response — same fields, same values, just filtered to one company. If longer visibility is needed later, extend the global horizon (6 or 12 months) and filter that. No `SA_EARNINGS_CALENDAR` per-symbol endpoint; only `SA_EARNINGS_CALENDAR_GLOBAL`.

8. ~~**EARNINGS_CALENDAR_GLOBAL refresh path:**~~ **Resolved:** Fix the refresh manager. The correct approach is to process `NOT_SUPPORTED` endpoints (no symbol in path) once, outside the per-symbol loop — not N times inside it. This is an existing bug that affects all `NOT_SUPPORTED` endpoints (IPO_CALENDAR, economic indicators, and now EARNINGS_CALENDAR_GLOBAL). Per the design principle: design the correct approach first (process `NOT_SUPPORTED` endpoints in a separate pass before/after the per-symbol loop), then reconcile with existing code. This also benefits the existing `NOT_SUPPORTED` endpoints.

9. ~~**CSV parsing dependency:**~~ **Resolved:** Hand-rolled parser. Verified against real 12-month AV response (1,814 data rows, 99KB): zero rows with embedded commas, all rows have exactly 7 fields. The AV CSV format is simple and consistent. A hand-rolled parser that handles the basic case (split on comma, trim) is sufficient. Add quoted-field handling as a defensive measure (in case a company name contains a comma in the future), but no external library dependency needed. Keeps the functions package lean.

10. ~~**Empty response handling:**~~ **Resolved:** The global calendar will always have data (thousands of companies report earnings in any 12-month window), so empty response is not a concern for `SA_EARNINGS_CALENDAR_GLOBAL`. After filtering to tracked symbols, if zero tracked symbols have upcoming earnings (extremely unlikely), store an empty array — don't skip the write, so the doc's metadata (lastUpdated, nextUpdate) still gets updated.

---

## Future Topics (Create Later — Do Not Forget)

This implementation is the data layer. Three follow-on topics should be created as separate Ideas via `/proj idea` when ready:

1. **Earnings Research Venue** — A research venue by company and tracked-symbols-wide. Synthesizes the three endpoints' data into a per-symbol earnings profile (history, estimates, upcoming dates) for analysis. Consumers can research earnings patterns, surprise history, estimate revisions, etc.

2. **Earnings Options Trading Calendar** — Just the calendar (for consumers to implement trading on). Uses the earnings dates to compute options strategy timelines (60-45 DBE, 1 day before, day-of, post-earnings volatility crush). Drives timed triggers for strategy entry/exit. This is the proactive event calendar described in the Strategic Context section above.

3. **Market-Wide Earnings Inventory Report** — Before filtering the global calendar to tracked symbols, capture a market-wide earnings summary report: hits/misses, surprise +/-, track records for companies with long earnings history. This is a discovery tool — surfacing interesting companies that aren't on the tracked-symbols radar. The handler preserves the full AV response in memory before filtering, so a future report generator can use it. Not built in this phase, but the data flow doesn't preclude it.

These are noted here so we don't forget. They are out of scope for Topic #33 — that topic is only the Firestore data layer for the three AV endpoints.
