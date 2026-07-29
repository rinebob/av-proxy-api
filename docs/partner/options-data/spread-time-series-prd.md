# PRD: Spread Time Series

## Status

**Phase 1 & 2 deployed** — 2026-07-28

## Overview

Compute and return historical time series for multi-leg options spread positions (verticals, straddles, strangles, iron condors) as a single price chart, just like an individual stock or option contract. The spread price is computed daily from the mark prices of the constituent contracts, weighted by long/short direction. Greeks are computed as the signed sum of stored leg Greeks.

The core goal is visual: seeing how a spread's price (and volatility) evolves over the life of its constituent contracts, overlaid against market conditions, to develop entry/exit filters for systematic strategy testing.

## Background

The existing `partnerHistoricalOptionsContractV2` endpoint returns time series for individual option contracts stored as JSONL files in GCS. Each file contains daily observations with mark, bid, ask, volume, open interest, implied volatility, and Greeks.

Consumers want to view spread positions — combinations of individual contracts — as a single time series. No charting software provides this; they show theoretical expiration P/L diagrams, not the actual historical price evolution of the spread.

## Phased Delivery

| Phase | Feature | Mode | Priority |
|---|---|---|---|
| 1 | Single-spread endpoint | Synchronous | Deployed |
| 2 | Batch endpoint | Synchronous (max 200) | Deployed |
| 3 | Strategy scan | Async (Cloud Tasks, GCS output) | High |
| 4 | Caching | GCS persistence | Future |

This PRD covers Phase 1 in detail and Phase 2 at a summary level. Phases 3–4 are outlined for architectural compatibility but are not specified here.

---

## Phase 1: Single-Spread Endpoint

### Endpoint

- **URL:** `POST /partnerSpreadTimeSeries`
- **Auth:** Same as existing partner endpoints (service account ID token, `EXPECTED_GOOGLE_AUDIENCE` secret)
- **Timeout:** 30s
- **Memory:** 256MiB
- **Max instances:** 20

### Supported Spread Types (Phase 1)

| Spread Type | Legs | Constraints |
|---|---|---|
| `vertical` | 2 | Same `optionType`, same `expiration`, different `strike`, one `long` + one `short` |
| `straddle` | 2 | Same `strike`, same `expiration`, one `call` + one `put`, same `direction` |
| `strangle` | 2 | Different `strike`, same `expiration`, one `call` + one `put`, same `direction` |
| `iron_condor` | 4 | Same `expiration`, two `call` + two `put`, two `long` + two `short`, all different `strike` |

Phase 1 validation enforces that all legs share the same expiration for these four types. Per-leg `expiration` is supported in the schema for future spread types (calendars, diagonals, double diagonals, ratios).

### Request Shape

```typescript
{
  spreadType: "vertical" | "straddle" | "strangle" | "iron_condor",
  symbol: "QQQ",
  legs: [
    {
      expiration: "2024-07-19",
      strike: 450,
      optionType: "call",
      direction: "long"   // "long" | "short"
    },
    {
      expiration: "2024-07-19",
      strike: 455,
      optionType: "call",
      direction: "short"
    }
  ],
  startDate?: "2024-05-01",   // optional date filter
  endDate?: "2024-07-18"      // optional date filter
}
```

- `symbol` must be in the allowed set (`QQQ`, `TQQQ`).
- `strike` is a number (e.g., `450`, `455.5`).
- `startDate`/`endDate` are optional `YYYY-MM-DD` strings. If both are present, `startDate` must be ≤ `endDate`.

### Contract ID Resolution

The server constructs the OCC contract ID directly from the leg parameters:

```
{SYMBOL}{YYMMDD}{C|P}{STRIKE×1000 padded to 8 digits}
```

Example: QQQ, 2024-07-19, call, strike 450 → `QQQ240719C00450000`

No Firestore lookup is needed. The constructed ID is used to read the JSONL file from GCS. If the file does not exist, the response includes a clear error for that leg.

### Mark Resolution Fallback Chain

For each leg on each day, the resolved mark is determined by:

1. **`mark`** if present in the observation
2. **`(bid + ask) / 2`** if `mark` is missing but both `bid` and `ask` are present
3. **Carry forward** the last known resolved mark from the previous observation
4. **Skip the day** only as a last resort (no mark, no bid/ask, no prior value)

Data integrity tests confirm edge cases 2–4 are rare in the actual dataset, but the fallback chain is defensive.

### Date Alignment

The spread series covers the **intersection** of all leg date ranges. The series starts on the latest `firstObserved` date across all legs and ends on the earliest `lastObserved` date.

Dates within the intersection range where one or more legs are missing data (and the fallback chain cannot resolve a mark) are surfaced in the `gaps` array in the response.

### Spread Price Formula

```
spreadPrice = sum(long leg marks) − sum(short leg marks)
```

The sign of the result indicates debit (positive) or credit (negative). A `debitOrCredit` field is included in the response envelope for UI labeling (see [Debit/Credit Classification](#debitcredit-classification)).

### Spread Greeks

Greeks are linear — the portfolio Greeks are the signed sum of the individual leg Greeks:

```
spreadDelta = sum(long leg deltas) − sum(short leg deltas)
spreadGamma = sum(long leg gammas) − sum(short leg gammas)
spreadTheta = sum(long leg thetas) − sum(short leg thetas)
spreadVega  = sum(long leg vegas)  − sum(short leg vegas)
spreadRho   = sum(long leg rhos)   − sum(short leg rhos)
```

All Greek values are already stored in the JSONL observations (`de`, `g`, `t`, `ve`, `r`). No Black-Scholes computation is needed.

### Response Shape

```typescript
{
  ok: true,
  spreadType: "vertical",
  symbol: "QQQ",
  debitOrCredit: "debit",        // "debit" | "credit" — structural property, computed from leg structure
  startDate: "2024-05-01",       // intersection start (or filtered start)
  endDate: "2024-07-18",         // intersection end (or filtered end)
  gaps: ["2024-06-03"],          // dates in range with unresolvable leg data
  legs: [
    {
      contractID: "QQQ240719C00450000",
      expiration: "2024-07-19",
      strike: 450,
      optionType: "call",
      direction: "long",
      firstObserved: "2024-04-15",
      lastObserved: "2024-07-18",
      series: [                   // leg series: date + mark only
        { date: "2024-04-15", mark: 8.50 },
        { date: "2024-04-16", mark: 8.45 }
      ]
    },
    {
      contractID: "QQQ240719C00455000",
      expiration: "2024-07-19",
      strike: 455,
      optionType: "call",
      direction: "short",
      firstObserved: "2024-05-01",
      lastObserved: "2024-07-18",
      series: [
        { date: "2024-05-01", mark: 3.25 },
        { date: "2024-05-02", mark: 3.20 }
      ]
    }
  ],
  series: [                       // spread series: price + Greeks
    {
      date: "2024-05-01",
      price: 5.25,
      delta: 0.23,
      gamma: -0.0001,
      theta: 0.03,
      vega: -0.01,
      rho: 0.02
    }
  ]
}
```

### Data Types and Precision

All numeric values in the response are **JSON numbers** (not strings):

| Field | Precision |
|---|---|
| `price` | 2 decimal places |
| `delta` | 2 decimal places |
| `gamma` | 4 decimal places |
| `theta` | 2 decimal places |
| `vega` | 2 decimal places |
| `rho` | 2 decimal places |
| `mark` (leg series) | 2 decimal places |

### Error Responses

| Status | Code | Condition |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing/invalid `symbol`, `spreadType`, `legs`; validation failure |
| 400 | `BAD_REQUEST` | Leg contract not found in GCS (with leg index and constructed contract ID) |
| 401 | `FORBIDDEN` | Auth failure |
| 405 | `METHOD_NOT_ALLOWED` | Non-POST request |
| 413 | `RESPONSE_TOO_LARGE` | Serialized response exceeds 10 MiB |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

### What Is NOT Included

- **No underlying price** in the response. The consumer has its own underlying data source with chart padding support.
- **No summary statistics** (max, min, percent change, etc.). The consumer computes these from the raw series.
- **No caching.** Every request recomputes from GCS. Phase 4 adds caching.
- **`debitOrCredit`** is a structural property computed once from the leg structure, included in the response envelope for UI labeling. Rules: vertical calls (long strike < short strike → debit, else credit); vertical puts (long strike > short strike → debit, else credit); straddle/strangle (direction "long" → debit, "short" → credit); iron condor (always credit).
- **No optional flags.** The single endpoint always returns spread series + leg series + Greeks + gaps.

---

## Phase 2: Batch Endpoint

- **URL:** `POST /partnerSpreadTimeSeriesBatch`
- **Timeout:** 120s
- **Memory:** 1GiB
- **Max instances:** 20
- **Max spreads:** 200 (hardcoded ceiling)
- **Request:** `{ spreads: [...], startDate?, endDate? }` — array of single-spread request objects
- **Response:** `{ ok: true, total: N, succeeded: M, failed: K, results: [...] }` where each result has its own `ok` flag, `index` (original position), and either a spread series (price + Greeks, no leg series) or an error with `code`
- **Partial failures:** Individual spreads that fail do not fail the entire request
- **No leg series** in batch results — too much noise for multi-spread comparison
- **Batch-level date override:** `startDate`/`endDate` at the batch level apply to all spreads; per-spread dates are used as fallback
- **Concurrency:** 10 spreads processed in parallel via bounded `Promise.all` chunks

The batch endpoint shares the same pricing engine (`SpreadPricingService`) as the single endpoint. It adds an orchestrator that manages parallel GCS reads and aggregates results.

---

## Phase 3: Strategy Scan (Outline)

- Accepts a strategy template: spread type, DTE target, strike selection rule (e.g., ATM, delta-based), entry frequency (e.g., daily, weekly), exit rule (e.g., hold to expiration)
- Server enumerates all spread instances across the historical dataset
- Each instance is processed as a Cloud Task using the same pricing engine
- Results written to GCS as a single downloadable file
- Returns a job ID immediately; consumer polls or receives a callback

## Phase 4: Caching (Outline)

- Persist computed spread series to GCS under a `spreads/v1/` prefix
- Cache key derived from a hash of the spread request parameters
- Check cache before recomputing; write to cache on miss
- Stale data handled by comparing leg JSONL generation timestamps

---

## Architectural Decisions

### Reuse Existing Infrastructure

- **GCS reads:** `GcsTimeSeriesAdapter.readLines()` — same adapter used by the existing partner contract endpoint
- **Line parsing:** `parseStorageLine()` — same utility that converts JSONL lines to `TimeSeriesStorageRecord`
- **Auth middleware:** `authenticateRequestEither` — same as all partner endpoints
- **Error codes:** `HistoricalOptionsErrorCode` enum — extended with spread-specific codes as needed

### No Firestore Dependency

Phase 1 does not query Firestore. Contract IDs are constructed directly from leg parameters. GCS is the only data source. This keeps the endpoint stateless and fast.

### Directory Structure

```
functions/src/v2/
  spread-pricing/                    ← NEW domain directory
    services/
      occ-id-constructor.utils.ts    — pure: leg params → OCC contract ID
      spread-validator.utils.ts      — pure: spreadType + legs → valid/invalid
      leg-mark-resolver.utils.ts     — pure: mark fallback chain
      spread-pricing.service.ts      — I/O: reads GCS, aligns, computes series
      index.ts                       — barrel exports
  partner/
    spread-time-series-partner.ts    — single-spread HTTP handler
    spread-request.types.ts          — shared request/response types
```

Phase 2 adds:
```
  partner/
    spread-time-series-batch-partner.ts — batch HTTP handler
```
