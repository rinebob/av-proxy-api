# Alpha Vantage Non–Time-Series Endpoints – Implementation Plan

> Scope: AV endpoints that are **not** time-series OHLCV (those are handled by the time-series pipeline and separate configs).

## Shared Implementation Pattern

For each non–time-series AV endpoint we will standardize on this pattern:

1. **Endpoint config**
   - Add entry to `AV_ENDPOINT_CONFIGS` with:
     - `id` = `AlphaVantageEndpoint.*`
     - `category` = appropriate `AvEndpointCategory` (fundamental, alpha-intel, options, etc.)
     - `ttl` in **seconds** per design
     - `symbolUsage` from `EndpointSymbolUsage`
     - `firestorePath` = `symbol-data/{symbol}/{endpoint-name-human-readable}/av-{endpoint-name-human-readable}` whenever symbol-scoped.
   - This config is the **single source of truth** for TTL and Firestore path.

2. **Handler wiring**
   - Implement a handler in `functions/src/v2/alpha-vantage`:
     - Use the central AV client (same pattern as time-series handlers) to call `/query` with `function=*` and params.
     - Use the config’s `firestorePath` to build the document path.
     - Normalize AV response into `{ data: <raw AV payload>, metadata: { fetchedAt, provider, endpointId, requestParams } }` or the latest normalized schema once finalized.

3. **Refresh & scheduling**
   - Use the shared refresh manager (same mechanism as time-series but without bar-level sharding):
     - Read TTL from `getEndpointTtlSecondsById(endpointId)`.
     - Maintain one document per `{symbol, endpoint}` (or per endpoint for market-wide data).
     - Refresh when `now >= lastUpdated + ttl`.
   - For earnings-related endpoints, layer on **calendar-aware** refresh:
     - Use `EARNINGS_CALENDAR` to schedule follow-up refreshes **6–24 hours after actuals** for each symbol.

4. **Partner-facing and internal usage**
   - Expose only **selected endpoints** via partner gateways (e.g. `partnerproxy`) using the same config + handler stack.
   - All clients (internal and partner) must **read from Firestore only**, never call AV directly.

---

## Endpoint Status Checklist

Legend:
- **[x]** Done / implemented end-to-end
- **[c]** Config only (no handler/refresh yet)
- **[ ]** Not started

### Quotes
- **GLOBAL_QUOTE**
  - [x] Config in `AV_ENDPOINT_CONFIGS`
  - [x] Handler implemented (v2 gateway)
  - [ ] Refresh integration (TTL-driven snapshot persistence, optional)
- **REALTIME_BULK_QUOTES**
  - [x] Config in `AV_ENDPOINT_CONFIGS`
  - [ ] Handler
  - [ ] Refresh / Firestore persistence strategy (likely no persistence; gateway-only)

### Search
- **SYMBOL_SEARCH**
  - [x] Config in `AV_ENDPOINT_CONFIGS` (TTL=30d, writes into `tracked-symbols` as part of bulk import flow)
  - [x] Used by `bulkImportSymbolsV2` (backend script)
  - [ ] Generic handler for ad-hoc search (if needed for other clients)

### Fundamental – Company / ETF / Statements
- **OVERVIEW**
  - [x] Config (TTL=7d, `symbol-data/{symbol}/company-overview/...`)
  - [x] Handler implemented (in v2)
  - [ ] Refresh schedule finalized (likely 7–30d cadence)
- **ETF_PROFILE** (ETF Profile & Holdings)
  - [x] Config (TTL=30d, `symbol-data/{symbol}/etf-profile-holdings/...`)
  - [ ] Handler to fetch AV ETF profile + holdings and persist
  - [ ] Backfill & validation versus existing `etf-holdings` import (State Street script)
- **INCOME_STATEMENT**
  - [x] Config (TTL=7d, symbol-scoped)
  - [ ] Handler
  - [ ] Refresh integration (align with quarterly release schedule)
- **BALANCE_SHEET**
  - [x] Config (TTL=7d, symbol-scoped)
  - [ ] Handler
  - [ ] Refresh integration (quarterly)
- **CASH_FLOW**
  - [x] Config (TTL=7d, symbol-scoped)
  - [ ] Handler
  - [ ] Refresh integration (quarterly)

### Fundamental – Earnings
- **EARNINGS** (Earnings history – annual & quarterly EPS)
  - [x] Config (TTL=30d, `symbol-data/{symbol}/earnings/...`)
  - [ ] Handler to fetch & persist AV earnings history
  - [ ] Calendar-aware refresh scheduling based on `EARNINGS_CALENDAR`
- **EARNINGS_CALENDAR**
  - [x] Config (TTL=1d, `symbol-data/{symbol}/earnings-calendar/...`, `symbolUsage=OPTIONAL`)
  - [ ] Handler to fetch upcoming + recent earnings events
  - [ ] Job to refresh calendar weekly/daily
  - [ ] Logic to emit follow-up jobs 6–24h after each earnings release to re-pull **EARNINGS** and **EARNINGS_ESTIMATES**
- **EARNINGS_ESTIMATES** (EPS & revenue estimates, revisions)
  - [x] Config (TTL=7d, `symbol-data/{symbol}/earnings-estimates/...`)
  - [ ] Handler to fetch & persist estimates
  - [ ] Integration with earnings-calendar scheduler (heavier refresh around earnings windows)

### Fundamental – Listings, IPOs
- **LISTING_DELISTING_STATUS**
  - [x] Config (TTL=7d, symbol-scoped)
  - [ ] Handler
  - [ ] Batch refresh strategy (likely market-wide rather than per-symbol calls)
- **IPO_CALENDAR**
  - [x] Config (TTL=1d, `market-data/ipo-calendar/...`)
  - [ ] Handler
  - [ ] Scheduler job (e.g. daily) to keep IPO calendar fresh

### Economic Indicators (legacy collections)
All of these currently use `economic-indicators/{indicator}/av-{indicator}` paths:
- **REAL_GDP**
- **REAL_GDP_PER_CAPITA**
- **TREASURY_YIELD**
- **FEDERAL_FUNDS_RATE**
- **CPI**
- **INFLATION**
- **RETAIL_SALES**
- **DURABLE_GOODS_ORDERS**
- **UNEMPLOYMENT_RATE**
- **NONFARM_PAYROLL**

For each:
- [x] Config in `AV_ENDPOINT_CONFIGS` (TTL=1d)
- [ ] Handler to fetch AV series and persist into the legacy econ collections or a new normalized schema
- [ ] Scheduled refresh job (daily / weekly depending on indicator)

### Options
- **HISTORICAL_OPTIONS**
  - [x] Config (TTL=1d, symbol-scoped path into `symbol-data/{symbol}/options/...`)
  - [x] Handler implemented (used by v2 gateway)
  - [ ] Finalize long-term storage strategy (hybrid Firestore + GCS for large chains)

### Alpha Intelligence (News, Transcripts, Insider, Top Gainers/Losers)
Config work is partially done elsewhere; plan:
- **NEWS_SENTIMENT** (NEWS_SENTIMENTS)
  - [ ] Config entry
  - [ ] Handler and Firestore schema under `news-sentiments`
  - [ ] Scheduler for backfill / rolling window
- **EARNINGS_CALL_TRANSCRIPT**
  - [ ] Config entry
  - [ ] Handler and Firestore schema under `earnings-call-transcript`
  - [ ] Integration with `EARNINGS_CALENDAR` so we can fetch transcripts shortly after calls
- **TOP_GAINERS_LOSERS**
  - [ ] Config entry
  - [ ] Handler writing into `market-data/top-gainers-losers`
  - [ ] Intraday refresh strategy (5–15 min during US market hours)
- **INSIDER_TRANSACTIONS**
  - [ ] Config entry
  - [ ] Handler writing into `insider-transactions` (symbol-data scoped)
  - [ ] Daily refresh job

---

## Next Steps

1. Implement handlers for the **three core fundamentals** we care about first:
   - [ ] `OVERVIEW` (if any missing v2 wiring)
   - [ ] `EARNINGS` (history)
   - [ ] `EARNINGS_ESTIMATES`
2. Implement **`EARNINGS_CALENDAR` handler + scheduler**, and use it as the driver for post-earnings refresh jobs (6–24h after release).
3. Implement **`ETF_PROFILE` handler** and reconcile with existing `etf-holdings` import so future ETF work always reads from AV-backed Firestore data.
4. Gradually fill in the rest of the list (statements, econ, alpha-intel) as time permits, always following the shared pattern above.
