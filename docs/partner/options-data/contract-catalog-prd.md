# PRD: Contract Catalog — Metadata, Discovery & Filtering

**Status:** As-Built (Phases 1-8 complete, Phase 9 pending)
**Owner:** Savant API
**Audience:** Savant API engineering, RS engineering, partner administrators
**Last updated:** 2026-07-28

> **As-built reference:** See `partner-contract-catalog-v2-as-built.md` for the complete implementation walkthrough with source paths.
> **Code review:** See `docs/operations/contract-catalog-review.md` (rounds 1-2) and `docs/operations/contract-catalog-review-r3.md` (round 3).

---

## 1. Summary

Build a Firestore-backed per-contract metadata catalog that enables consumers to discover, filter, sort, and select option contracts by contract length, observation count, delta, IV, and other attributes. Expose a new partner endpoint (`partnerContractCatalogV2`) that serves this catalog with server-side filtering and pagination, plus a summary mode that returns a length-bucket histogram for filter-button UIs.

The existing `ts-expirations` and `ts-strikes` subcollections continue to power dropdown selection. The new `ts-contracts` subcollection powers the enriched contract list that appears after a user selects an expiration or strike.

## 2. Problem

Consumers currently have no way to browse contracts by metadata. The existing `partnerListContractsV2` endpoint returns bare contract IDs parsed from the OCC string — no observation count, no contract length, no greeks. With 100K+ contracts per symbol, finding all 3-month calls at a specific expiration with delta between 0.40 and 0.50 is impossible without downloading and parsing every time-series file.

A static CSV (`audit-timeseries-coverage.ts` output) exists but is not live, not queryable, and not updated as new data arrives.

## 3. Goals

- Maintain a per-contract metadata doc in Firestore (`ts-contracts/{contractId}`) that is updated daily as the time-series builder processes new corpus files.
- Expose `partnerContractCatalogV2` — a single endpoint that serves both:
  - **Summary mode** (`?summary=true`): returns a length-bucket histogram and totals for the symbol.
  - **Catalog mode** (default): returns paginated, filtered, sorted contract metadata.
- Enable filtering by: `expiration`, `expirationGte/expirationLte` (range), `strike`, `type`, `contractLengthBucket` (multi-value), `deltaGte/deltaLte`, `ivGte/ivLte`, `minObservationCount`.
- Enable sorting by: `expiration`, `strike`, `contractLengthDays`, `observationCount`, `delta`.
- Support both interactive UI browsing and programmatic strategy-builder consumption.
- Keep `ts-expirations` and `ts-strikes` unchanged for dropdown support.
- Backfill all existing contracts in a one-time script run.

## 4. Non-Goals

- Modifying the existing `partnerListContractsV2` endpoint or its query path.
- Removing `contractIds[]` from `ts-expirations` / `ts-strikes` (deferred migration — see §10).
- Storing intraday or real-time metadata. The catalog updates on the daily builder cadence.
- Backtesting, signal generation, or trade outcome calculation.
- Coverage beyond `QQQ` and `TQQQ` in the initial release.
- Storing `bid`, `ask`, or `last` in the `latest` snapshot (trimmed to reduce doc size — see §5.1).

## 5. Data Model

### 5.1 `ts-contracts/{contractId}` Document

Path: `options-file-index/{symbol}/ts-contracts/{contractId}`

```json
{
  "contractId": "QQQ260116C00450000",
  "expiration": "2026-01-16",
  "strike": 450,
  "type": "call",
  "firstObserved": "2025-10-15",
  "firstObservedDow": "Wed",
  "lastObserved": "2026-07-25",
  "lastObservedDow": "Fri",
  "observationCount": 180,
  "expectedObservationCount": 185,
  "contractLengthDays": 93,
  "contractLengthBucket": "3mo",
  "latest": {
    "mark": "84.90",
    "volume": "0",
    "openInterest": "20",
    "iv": "0.0149",
    "delta": "1.00000",
    "gamma": "0.00000",
    "theta": "-0.00460",
    "vega": "0.00000",
    "rho": "0.03065"
  },
  "latestDelta": 1.00000,
  "latestIv": 0.0149,
  "lastUpdated": "2026-07-25T16:00:00Z"
}
```

**Field definitions:**

| Field | Type | Source | Description |
|---|---|---|---|
| `contractId` | string | contract ID | OCC-format contract identifier |
| `expiration` | string (ISO date) | parsed from contract ID | Expiration date |
| `strike` | number | parsed from contract ID | Strike price in dollars |
| `type` | `"call"` \| `"put"` | parsed from contract ID | Option type |
| `firstObserved` | string (ISO date) | GCS metadata / builder | First trading date with data for this contract |
| `firstObservedDow` | string | computed | Day of week for `firstObserved` (e.g. `Wed`) |
| `lastObserved` | string (ISO date) | GCS metadata / builder | Most recent trading date with data |
| `lastObservedDow` | string | computed | Day of week for `lastObserved` (e.g. `Fri`) |
| `observationCount` | number | GCS metadata / builder | Total number of daily observations |
| `expectedObservationCount` | number | `TradingCalendarService` | Trading days from `firstObserved` to `expiration` (inclusive). Approximation — `firstObserved` is our proxy for market listing date. |
| `contractLengthDays` | number | computed | `calendarDaysBetween(firstObserved, expiration)` |
| `contractLengthBucket` | string | computed | `classifyContractLength(contractLengthDays)` — e.g., `3mo`, `1yr` |
| `latest` | object | last observation record | Snapshot of most recent observation's greeks and liquidity fields |
| `latest.mark` | string | last record `m` | Mark price |
| `latest.volume` | string | last record `v` | Daily volume |
| `latest.openInterest` | string | last record `oi` | Open interest |
| `latest.iv` | string | last record `iv` | Implied volatility |
| `latest.delta` | string | last record `de` | Delta |
| `latest.gamma` | string | last record `g` | Gamma |
| `latest.theta` | string | last record `t` | Theta |
| `latest.vega` | string | last record `ve` | Vega |
| `latest.rho` | string | last record `r` | Rho |
| `latestDelta` | number | computed from `latest.delta` | Numeric delta for Firestore range queries. Absent when `latest` is absent. |
| `latestIv` | number | computed from `latest.iv` | Numeric IV for Firestore range queries. Absent when `latest` is absent. |
| `lastUpdated` | string (ISO timestamp) | write time | When this doc was last written |

**Why `latest` values are strings:** The time-series JSONL stores all values as strings for compactness. The catalog preserves this — consumers parse to float as needed. This avoids precision loss and keeps the catalog consistent with the storage format.

**Why `latestDelta` and `latestIv` exist as numeric top-level fields:** Firestore range filters on string fields use lexicographic comparison, which produces incorrect results for numeric values with different decimal places (e.g. `0.0149` > `0.100` lexicographically). The numeric fields enable correct Firestore range queries for `deltaGte`/`deltaLte` and `ivGte`/`ivLte` filters and `sortBy=delta` sorting. They are derived from the same source as `latest.delta` and `latest.iv`.

**Why `bid`, `ask`, `last` are excluded from `latest`:** These are quote detail fields not needed for contract selection. Mark, volume, open interest, IV, and greeks are the attributes consumers use to choose contracts. Trimming reduces doc size and write payload.

### 5.2 Symbol Summary Document

Path: `options-file-index/{symbol}` (existing doc, enhanced)

```json
{
  "symbol": "QQQ",
  "totalContracts": 184523,
  "expirationCount": 412,
  "lengthBuckets": [
    { "label": "1d", "count": 8, "sortOrder": 0 },
    { "label": "3d", "count": 15, "sortOrder": 1 },
    { "label": "5d", "count": 22, "sortOrder": 2 },
    { "label": "7d", "count": 30, "sortOrder": 3 },
    { "label": "14d", "count": 45, "sortOrder": 4 },
    { "label": "21d", "count": 18, "sortOrder": 5 },
    { "label": "1mo", "count": 120, "sortOrder": 6 },
    { "label": "1.5mo", "count": 35, "sortOrder": 7 },
    { "label": "2mo", "count": 60, "sortOrder": 8 },
    { "label": "3mo", "count": 380, "sortOrder": 9 },
    { "label": "4mo", "count": 95, "sortOrder": 10 },
    { "label": "6mo", "count": 210, "sortOrder": 11 },
    { "label": "9mo", "count": 48, "sortOrder": 12 },
    { "label": "1yr", "count": 95, "sortOrder": 13 },
    { "label": "2yr", "count": 40, "sortOrder": 14 },
    { "label": "3yr", "count": 12, "sortOrder": 15 }
  ],
  "lastUpdated": "2026-07-25T16:00:00Z"
}
```

The `lengthBuckets` histogram counts contracts per bucket label. Powers the filter-button row in the UI — only buckets with count > 0 are rendered as clickable buttons.

**Breaking change (v2):** `lengthBuckets` was previously a `Record<string, number>` (object keyed by label). It is now a `LengthBucketEntry[]` array, pre-sorted shortest-to-longest by `sortOrder`. This enables consumers to render the histogram in canonical order without client-side sorting. The `sortOrder` field provides the chronological position for consumers that need to re-sort or reference a bucket's position independently of array index.

### 5.3 Unchanged Subcollections

**`ts-expirations/{date}`** — no schema changes. Continues to provide `strikes[]`, `types[]`, `contractIds[]` for dropdown population.

**`ts-strikes/{strike}`** — no schema changes. Continues to provide `expirations[]`, `types[]`, `contractIds[]` for strike-based dropdown population.

## 6. Consumer API

### 6.1 Endpoint

| Property | Value |
|---|---|
| Function | `partnerContractCatalogV2` |
| Method | `GET` |
| Caller | Allowlisted server-side partner service account |
| Auth | Existing dual-auth middleware (`ALLOWED_SERVICE_ACCOUNT_EMAILS` / `EXPECTED_GOOGLE_AUDIENCE`) |
| Memory | `256MiB` |
| Max instances | `20` |
| Timeout | `30s` |

### 6.2 Request Parameters

| Param | Required | Type | Description |
|---|---|---|---|
| `symbol` | yes | string | `QQQ` or `TQQQ` (uppercased) |
| `summary` | no | boolean | If `true`, returns symbol summary (histogram + totals). Ignores all other params. |
| `expiration` | no | string (`YYYY-MM-DD`) | Filter by exact expiration date. Mutually exclusive with `expirationGte`/`expirationLte`. |
| `expirationGte` | no | string (`YYYY-MM-DD`) | Lower bound (inclusive) for expiration date range filtering. Mutually exclusive with `expiration`. |
| `expirationLte` | no | string (`YYYY-MM-DD`) | Upper bound (inclusive) for expiration date range filtering. Mutually exclusive with `expiration`. |
| `contractLengthBucket` | no | string (comma-separated) | Filter by one or more length buckets: `1d`, `3d`, `5d`, `7d`, `14d`, `21d`, `1mo`, `1.5mo`, `2mo`, `3mo`, `4mo`, `6mo`, `9mo`, `1yr`, `2yr`, `3yr`. Multiple values are comma-separated (e.g. `contractLengthBucket=3mo,6mo,1yr`). Uses Firestore `in` operator (max 30 values). |
| `type` | no | string (`C` or `P`) | Filter by option type |
| `strike` | no | number | Filter by exact strike |
| `strikeGte` | no | number | Strike >= value (range filter — see §6.5) |
| `strikeLte` | no | number | Strike <= value (range filter — see §6.5) |
| `deltaGte` | no | number | Latest delta >= value (range filter — see §6.5) |
| `deltaLte` | no | number | Latest delta <= value (range filter — see §6.5) |
| `ivGte` | no | number | Latest IV >= value (range filter — see §6.5) |
| `ivLte` | no | number | Latest IV <= value (range filter — see §6.5) |
| `minObservationCount` | no | number | Minimum observation count |
| `sortBy` | no | string | `expiration` (default), `strike`, `contractLengthDays`, `observationCount`, `delta` |
| `sortOrder` | no | string | `asc` (default) or `desc` |
| `pageSize` | no | number | Default 200, max 500 |
| `pageToken` | no | string | Opaque cursor from previous response |

**Future params (not in initial release):** `gammaGte/gammaLte`, `thetaGte/thetaLte`, `vegaGte/vegaLte` — same range-filter pattern as delta/IV. Rho is excluded; it is not useful for contract selection.

### 6.3 Summary Response

Request: `GET ?symbol=QQQ&summary=true`

```json
{
  "ok": true,
  "symbol": "QQQ",
  "totalContracts": 184523,
  "expirationCount": 412,
  "lengthBuckets": [
    { "label": "1d", "count": 8, "sortOrder": 0 },
    { "label": "3d", "count": 15, "sortOrder": 1 },
    { "label": "5d", "count": 22, "sortOrder": 2 },
    { "label": "7d", "count": 30, "sortOrder": 3 },
    { "label": "14d", "count": 45, "sortOrder": 4 },
    { "label": "21d", "count": 18, "sortOrder": 5 },
    { "label": "1mo", "count": 120, "sortOrder": 6 },
    { "label": "1.5mo", "count": 35, "sortOrder": 7 },
    { "label": "2mo", "count": 60, "sortOrder": 8 },
    { "label": "3mo", "count": 380, "sortOrder": 9 },
    { "label": "4mo", "count": 95, "sortOrder": 10 },
    { "label": "6mo", "count": 210, "sortOrder": 11 },
    { "label": "9mo", "count": 48, "sortOrder": 12 },
    { "label": "1yr", "count": 95, "sortOrder": 13 },
    { "label": "2yr", "count": 40, "sortOrder": 14 },
    { "label": "3yr", "count": 12, "sortOrder": 15 }
  ],
  "lastUpdated": "2026-07-25T16:00:00Z"
}
```

### 6.4 Catalog Response

Request: `GET ?symbol=QQQ&expiration=2026-01-16&sortBy=strike&pageSize=200`

```json
{
  "ok": true,
  "symbol": "QQQ",
  "contracts": [
    {
      "contractId": "QQQ260116C00350000",
      "expiration": "2026-01-16",
      "strike": 350,
      "type": "call",
      "firstObserved": "2025-10-15",
      "lastObserved": "2026-07-25",
      "observationCount": 180,
      "expectedObservationCount": 185,
      "contractLengthDays": 93,
      "contractLengthBucket": "3mo",
      "latest": {
        "mark": "84.90",
        "volume": "0",
        "openInterest": "20",
        "iv": "0.0149",
        "delta": "1.00000",
        "gamma": "0.00000",
        "theta": "-0.00460",
        "vega": "0.00000",
        "rho": "0.03065"
      }
    }
  ],
  "count": 200,
  "nextPageToken": "eyJ...opaque-cursor..."
}
```

When there are no more results, `nextPageToken` is omitted.

### 6.5 Firestore Query Constraints

Firestore supports at most **one range field** per query. Equality filters (`expiration`, `contractLengthBucket`, `type`, `strike`) can combine freely. `contractLengthBucket` accepts comma-separated values and uses Firestore's `in` operator (equality, not range). Range filters (`expirationGte/Lte`, `strikeGte/Lte`, `deltaGte/Lte`, `ivGte/Lte`, `minObservationCount`) conflict with each other.

`expiration` can be used as either an equality filter (exact match) or a range filter (`expirationGte`/`expirationLte`), but not both in the same request.

**Allowed combinations:**

| Filters | Query Shape |
|---|---|
| `expiration` + `type` + sort by `strike` | 2 equality + orderBy |
| `expiration` + `contractLengthBucket` + sort by `strike` | 2 equality + orderBy |
| `contractLengthBucket` + `type` + sort by `expiration` | 2 equality + orderBy |
| `expiration` + `deltaGte` + `deltaLte` | 1 equality + 1 range (same field) |
| `strike` + `deltaGte` + `deltaLte` | 1 equality + 1 range (same field) |
| `expirationGte` + `expirationLte` + `type` + sort by `strike` | 1 equality + 1 range (expiration) |
| `expirationGte` + `expirationLte` + `contractLengthBucket` + sort by `expiration` | 1 equality + 1 range (expiration) |

**Not allowed:**

| Filters | Why |
|---|---|
| `expiration` + `expirationGte` | Mutually exclusive (exact match vs range) |
| `strikeGte` + `deltaGte` | Two different range fields |
| `ivGte` + `deltaGte` | Two different range fields |
| `expirationGte` + `strikeGte` | Two different range fields |

**Handling:** The endpoint validates the combination and returns `400` with a clear error message when an unsupported combination is requested. The error message lists which filters conflict. Consumers adjust by using equality filters where possible and doing client-side filtering for the remainder.

For `deltaGte` + `deltaLte` (same field, two bounds), Firestore treats this as a single range on `latest.delta` — supported.

For `sortBy=delta`, the query orders by `latest.delta`. This requires a composite index on the filter fields + `latest.delta`. Only supported when the filter combination allows it (i.e., no conflicting range field).

### 6.6 Request Validation

- `symbol` is trimmed, uppercased, and must be in `ALLOWED_SYMBOLS` (`QQQ`, `TQQQ`).
- `expiration`, if supplied, must match `YYYY-MM-DD` and be a valid calendar date.
- `expirationGte`/`expirationLte`, if supplied, must match `YYYY-MM-DD` and be valid calendar dates.
- `expiration` (exact) and `expirationGte`/`expirationLte` (range) are mutually exclusive.
- `expirationGte` must be <= `expirationLte` when both are supplied.
- `type`, if supplied, must be `C` or `P`.
- `strike`, if supplied, must be a non-negative finite number.
- `contractLengthBucket`, if supplied, must be one or more comma-separated bucket labels from the defined set. Multiple values use Firestore's `in` operator (max 30 values).
- Range params (`strikeGte`, `strikeLte`, `deltaGte`, `deltaLte`, `ivGte`, `ivLte`) must be finite numbers.
- `deltaGte` must be <= `deltaLte` when both are supplied (same for other range pairs).
- At most one range field dimension (expiration, strike, delta, iv, observationCount) may be used per request. If two different range dimensions are supplied, return `400` with a descriptive error.
- `sortBy` must be one of: `expiration`, `strike`, `contractLengthDays`, `observationCount`, `delta`.
- `sortOrder` must be `asc` or `desc`.
- `pageSize` must be between 1 and 500.
- Unknown parameters are ignored.

## 7. Write Path — Daily Maintenance

### 7.1 Per-Contract Docs (Builder Inline)

The time-series builder's `writeMerged()` method (`time-series-builder.service.ts:257-312`) already:

1. Merges existing JSONL lines with new records.
2. Sorts by date.
3. Writes GCS custom metadata (`firstObserved`, `lastObserved`, `observationCount`, etc.).
4. Calls `OptionsIndexWriter.upsertContract()` to update `ts-expirations` and `ts-strikes`.

We extend step 4 to also upsert a `ts-contracts/{contractId}` doc. The builder has all data in scope:

- `sorted[0].d` → `firstObserved`
- `sorted[sorted.length - 1]` → `lastObserved`, `latest.*` (mark, volume, openInterest, iv, delta, gamma, theta, vega, rho)
- `sorted.length` → `observationCount`
- `accumulator.expiration` → `expiration`
- `accumulator.strike` → `strike`
- `accumulator.type` → `type`
- `calendarDaysBetween(firstObserved, expiration)` → `contractLengthDays`
- `classifyContractLength(contractLengthDays)` → `contractLengthBucket`
- `TradingCalendarService.getTradingDates(firstObserved, expiration).length` → `expectedObservationCount`

One additional Firestore `set()` call per contract per flush. Estimated ~5K-10K writes/day for both symbols combined (only contracts appearing in the day's corpus file are written). At Firestore pricing (~$0.18/100K writes), negligible cost.

### 7.2 Symbol Summary (Scheduled Daily Job)

After the builder completes, a scheduled Cloud Function runs an aggregation pass per symbol:

1. Query all `ts-contracts` docs for the symbol (subcollection read).
2. Aggregate: count by `contractLengthBucket`, count total contracts, count distinct expirations.
3. Write the symbol summary doc with the histogram and totals.

This is a batch operation — one scan, one doc write. Runs once per day per symbol. Triggered by a Pub/Sub message from the builder on completion, or a fixed Cloud Scheduler job (e.g., 2 AM UTC after builder window).

### 7.3 Expired Contracts

When a contract expires, it stops appearing in daily corpus files. The builder never touches it again. Its `ts-contracts` doc remains frozen with the last known values. This is correct — the doc represents the complete lifecycle of that contract. Consumers browsing historical contracts see the final state.

### 7.4 Write Ordering

The `ts-contracts` doc write occurs **after** the GCS write succeeds in `writeMerged()`. If the GCS write fails, no catalog doc is written — the catalog never references data that doesn't exist in GCS. If the catalog doc write fails after GCS succeeds, the next builder flush will overwrite it with correct data — eventually consistent.

## 8. Backfill

One-time script: `functions/scripts/backfill/backfill-contract-catalog.ts`

Adapted from `audit-timeseries-coverage.ts` which already lists all `.jsonl` files and reads GCS metadata.

### 8.1 Steps

1. List all `.jsonl` files in the time-series bucket for each symbol (paginated GCS listing).
2. For each file, read GCS custom metadata (`firstObserved`, `lastObserved`, `observationCount`).
3. Parse contract ID for `expiration`, `strike`, `type`.
4. Compute `contractLengthDays`, `contractLengthBucket`, `expectedObservationCount`.
5. Write `ts-contracts/{contractId}` doc **without** `latest` object (see §8.2).
6. After all contracts written, run the aggregation pass to build symbol summary docs.

### 8.2 `latest` Object During Backfill

The backfill reads GCS metadata only — it does not download file content. The `latest.*` fields (greeks, mark, volume, open interest) come from the last observation record inside the JSONL file, which requires a file download.

**Decision: Skip `latest` during backfill.** The `latest` object is omitted from backfilled docs. It will be populated on the next builder flush for active contracts. For expired contracts, `latest` remains absent — consumers handle this gracefully (the field is optional in the response).

Rationale: Downloading 300K files to extract one line each is expensive and slow. The critical catalog fields (`contractLengthBucket`, `observationCount`, `firstObserved`, `expiration`, `strike`, `type`) all come from GCS metadata or contract ID parsing. The `latest` snapshot is a nice-to-have for contract selection, not a prerequisite for the catalog to be useful.

### 8.3 Performance

With concurrency 50 and ~300K files, the backfill reads GCS metadata at ~50 files/second → ~100 minutes. Firestore writes at the same concurrency → similar throughput. Total backfill time: ~2-3 hours. Run once.

## 9. Firestore Indexes

Composite indexes defined in `firestore.indexes.json`:

| Query Pattern | Index Fields |
|---|---|
| Expiration + sort by strike | `expiration` ASC + `strike` ASC + `__name__` ASC |
| Expiration + type + sort by strike | `expiration` ASC + `type` ASC + `strike` ASC + `__name__` ASC |
| Expiration + length bucket + sort by strike | `expiration` ASC + `contractLengthBucket` ASC + `strike` ASC + `__name__` ASC |
| Length bucket + sort by expiration | `contractLengthBucket` ASC + `expiration` ASC + `__name__` ASC |
| Length bucket + type + sort by strike | `contractLengthBucket` ASC + `type` ASC + `strike` ASC + `__name__` ASC |
| Strike + sort by expiration | `strike` ASC + `expiration` ASC + `__name__` ASC |
| Expiration + delta range + sort by delta | `expiration` ASC + `latest.delta` ASC + `__name__` ASC |
| Length bucket + sort by contractLengthDays | `contractLengthBucket` ASC + `contractLengthDays` ASC + `__name__` ASC |

Each index needs both ASC and DESC variants for `sortOrder` support. The `__name__` field is appended by Firestore for cursor pagination.

**Index count management:** Firestore allows ~200 composite indexes per database. The above list is ~16 indexes (8 patterns × 2 sort directions). Well within limits. Less common query patterns fall back to client-side filtering.

## 10. Migration Path for `contractIds[]` Deprecation

The `contractIds[]` array in `ts-expirations` and `ts-strikes` becomes redundant once the catalog endpoint is available. Migration is phased:

1. **Phase 1 (this PRD):** Build `ts-contracts`, catalog endpoint, backfill. Both `contractIds[]` and `ts-contracts` exist in parallel. Existing consumers still read `contractIds[]` via `partnerListContractsV2`.
2. **Phase 2 (future):** Migrate admin storage viewer and partner consumers to use the catalog endpoint. `contractIds[]` is no longer read by anyone.
3. **Phase 3 (future):** Stop writing `contractIds[]` in `OptionsIndexWriter.upsertContract()`. New contracts don't get the array. Old docs retain stale arrays.
4. **Phase 4 (future, optional):** Run a cleanup script to remove `contractIds` field from all existing docs.

No rush on phases 2-4. The parallel state is fine indefinitely.

## 11. Consumer UI Flow

### 11.1 Interactive Browsing

1. **Load page** → call `partnerContractCatalogV2?symbol=QQQ&summary=true` → get length histogram → render filter buttons (only buckets with count > 0).
2. **Load dropdowns** → existing calls to `partnerListContractsV2` or direct `ts-expirations` reads → populate expiration dropdown with `"2026-01-16 (Fri)"` labels.
3. **Select expiration** → call `partnerContractCatalogV2?symbol=QQQ&expiration=2026-01-16&sortBy=strike` → display contract table with columns: strike, type, length bucket, observation count, coverage ratio, latest delta, latest IV.
4. **Filter by length** → user clicks "3mo" button → call `partnerContractCatalogV2?symbol=QQQ&expiration=2026-01-16&contractLengthBucket=3mo&sortBy=strike`.
5. **Filter by delta** → user sets delta range 0.40–0.50 → call `partnerContractCatalogV2?symbol=QQQ&expiration=2026-01-16&contractLengthBucket=3mo&deltaGte=0.40&deltaLte=0.50&sortBy=strike`.
6. **Select contract** → user clicks a row → call existing `partnerHistoricalOptionsContractV2` to fetch the actual time-series data (unchanged).

### 11.2 Strategy Builder (Programmatic)

1. Strategy logic calls `partnerContractCatalogV2?symbol=QQQ&contractLengthBucket=3mo&type=C&deltaGte=0.40&deltaLte=0.50&expiration=2026-01-16` → gets matching contract ID(s).
2. Calls `partnerHistoricalOptionsContractV2` to fetch the series.
3. No UI needed — pure API consumption.

### 11.3 Strike-Only Browsing

1. User selects strike 450 without selecting an expiration.
2. Call `partnerContractCatalogV2?symbol=QQQ&strike=450&sortBy=expiration` → returns all contracts at strike 450 across all expirations, paginated.
3. Table shows expiration, type, length bucket, observations, delta — user picks the contract they want.

## 12. Edge Cases

- **Contract with zero observations:** GCS file exists but is empty. `firstObserved` and `lastObserved` are empty strings. `observationCount` is 0. `contractLengthDays` is null. `contractLengthBucket` is `"—"`. The doc still exists. Consumers filter with `minObservationCount=1` to exclude these.
- **Contract ID can't be parsed:** `parseContractIDMetadata()` returns null for malformed IDs. These contracts don't get a `ts-contracts` doc. They may still appear in `ts-expirations.contractIds[]` (legacy path). The catalog endpoint simply won't have them.
- **GCS metadata missing:** Old files that predate the metadata-writing code won't have `firstObserved`, `lastObserved`, `observationCount`. The backfill script leaves those fields empty, same as the audit CSV does today. `contractLengthDays` and `contractLengthBucket` will be null/`"—"` for these contracts.
- **`expectedObservationCount` accuracy:** Approximation. We count trading days from `firstObserved` to `expiration` (inclusive). We don't know the actual market listing date — `firstObserved` is when we first saw data, which could be later than the actual listing. The ratio `observationCount / expectedObservationCount` gives a coverage estimate, not a guarantee.
- **`latest` absent on backfilled expired contracts:** Consumers must handle `latest` being undefined. The API response omits the `latest` field entirely when the doc doesn't have one (not `null`, just absent).

## 13. What Does NOT Change

- `ts-expirations` and `ts-strikes` structure and write path.
- `partnerListContractsV2` endpoint and handler.
- `partnerHistoricalOptionsContractV2` endpoint (fetches actual time-series data).
- GCS file format, JSONL schema, custom metadata fields.
- The builder's core logic — we're adding one more write call at the end of `writeMerged()`.
- `contract-length.utils.ts` — already has `classifyContractLength()` and `calendarDaysBetween()`.
- `TradingCalendarService` — already has `getTradingDates()` for `expectedObservationCount` computation.

## 14. File Structure

Following the project's module design rules (single concern per file, barrel exports, no cross-concern imports).

### 14.1 Shared Types

- **`shared/options/contract-catalog.types.ts`** — `ContractCatalogEntry`, `ContractCatalogResponse`, `ContractSummaryResponse`, `LatestSnapshot` interfaces; `TS_CONTRACTS_SUBCOLLECTION` constant.
- **`shared/options/contract-types.ts`** — add `TS_CONTRACTS_SUBCOLLECTION` constant (or re-export from catalog types).
- **`shared/options/index.ts`** — re-export new types.

### 14.2 Backend Services

- **`functions/src/v2/historical-options-corpus/services/contract-catalog.writer.ts`** — writes `ts-contracts` docs. Single concern: catalog doc writes. Imports utils only (`contract-length.utils`, `contract-metadata.utils`).
- **`functions/src/v2/historical-options-corpus/services/contract-catalog-query.service.ts`** — queries `ts-contracts` with filters, sort, pagination. Single concern: catalog queries. Imports shared types only.
- **`functions/src/v2/historical-options-corpus/services/contract-summary-aggregator.service.ts`** — aggregates `ts-contracts` into symbol summary doc. Single concern: summary aggregation. Imports catalog query service + utils.
- **`functions/src/v2/historical-options-corpus/services/index.ts`** — barrel exports updated for new services.

### 14.3 Endpoint

- **`functions/src/v2/partner/partner-contract-catalog-partner.ts`** — HTTP handler for `partnerContractCatalogV2`. Imports catalog query service + shared types.

### 14.4 Backfill Script

- **`functions/scripts/backfill/backfill-contract-catalog.ts`** — one-time backfill script. Adapted from `audit-timeseries-coverage.ts`.

### 14.5 Updates to Existing Files

- **`functions/src/v2/historical-options-corpus/services/options-index.writer.ts`** — extend `upsertContract()` to also write `ts-contracts` doc via `ContractCatalogWriter`.
- **`firestore.indexes.json`** — add composite indexes for `ts-contracts` queries.
- **`functions/src/index.ts`** — register new endpoint.

### 14.6 Dependency Direction

```
contract-length.utils.ts (pure, no dependencies)
contract-metadata.utils.ts (pure, no dependencies)
contract-catalog.types.ts (pure types, no dependencies)
  ↓
contract-catalog.writer.ts (imports utils + types)
contract-catalog-query.service.ts (imports types only)
contract-summary-aggregator.service.ts (imports query service + types)
  ↓
options-index.writer.ts (imports catalog writer for upsert)
  ↓
time-series-builder.service.ts (imports options-index.writer — existing)
  ↓
partner-contract-catalog-partner.ts (imports query service + types)
```

No cross-concern imports. No writer imports another writer. Barrel exports for the services directory.

## 15. Implementation Plan

### Phase 1: Shared Types & Constants ✅

1. Create `shared/options/contract-catalog.types.ts` with interfaces and `TS_CONTRACTS_SUBCOLLECTION` constant.
2. Update `shared/options/index.ts` barrel export.
3. Update `shared/options/contract-types.ts` if needed for the subcollection constant.

### Phase 2: Catalog Writer ✅

1. Create `contract-catalog.writer.ts` — accepts parsed contract data + latest observation, computes `contractLengthDays`, `contractLengthBucket`, `expectedObservationCount`, writes `ts-contracts` doc.
2. Unit tests: deferred per project rules.

### Phase 3: Catalog Query Service ✅

1. Create `contract-catalog-query.service.ts` — builds Firestore queries from filter params, handles pagination cursors, sort direction.
2. Implement summary read (single doc read from `options-file-index/{symbol}`).
3. Unit tests: deferred per project rules.

### Phase 4: Summary Aggregator ✅

1. Create `contract-summary-aggregator.service.ts` — scans `ts-contracts` subcollection, aggregates by length bucket, writes summary doc.
2. Unit tests: deferred per project rules.

### Phase 5: Builder Integration ✅

1. Extended `time-series-builder.service.ts` to call `ContractCatalogWriter.upsertContractCatalog()` after GCS write succeeds (separate try/catch block).
2. Integration test: deferred per project rules.

### Phase 6: Endpoint ✅

1. Create `partner-contract-catalog-partner.ts` — HTTP handler with param validation, auth, summary/catalog mode switch, error responses.
2. Register in `functions/src/index.ts`.
3. Unit tests: deferred per project rules.
4. Request parsing utilities extracted to `partner-request.utils.ts` (shared with future endpoints).

### Phase 7: Firestore Indexes ✅

1. Add composite indexes to `firestore.indexes.json` (14 indexes defined).
2. Deploy indexes via `firebase deploy --only firestore:indexes`.
3. 3 additional indexes auto-created by Firestore from failed queries during deployment (17 total in Firestore).
4. Indexes on 370K+ docs took ~15 minutes to build. Queries return 500 until index state is READY.

### Phase 8: Backfill ✅

1. Create `backfill-contract-catalog.ts` script.
2. Run for QQQ, then TQQQ.
3. Run summary aggregator to populate symbol summary docs.
4. Verify doc counts match GCS file counts.

### Phase 9: Scheduled Summary Refresh ⏳ (Pending)

1. Create scheduled Cloud Function (or Pub/Sub-triggered) that runs the summary aggregator after the daily builder window.
2. Deploy and verify.

**Note:** Summary docs are currently updated by the backfill script and the builder. The scheduled job is not yet implemented.

### Phase 10: Firestore Rules ✅ (No Changes Needed)

1. `firestore.rules` rule 9 already restricts `options-file-index` to admin read-only.
2. The endpoint uses Admin SDK which bypasses rules. No changes needed.

## 16. Testing

> **Status:** Deferred per project rules ("We will not be implementing unit testing yet but will in the future").

### 16.1 Unit Tests (Jest) — Pending

- `contract-catalog.writer.test.ts` — doc shape, field computation, edge cases.
- `contract-catalog-query.service.test.ts` — query construction, filter combinations, pagination, range conflicts.
- `contract-summary-aggregator.service.test.ts` — histogram computation, counts.
- `partner-contract-catalog-partner.test.ts` — param validation, auth, response shape, error cases.

### 16.2 Integration Tests

- Builder integration: verify `ts-contracts` doc written after `writeMerged()` with correct fields.
- Backfill script: run on small sample, verify docs match GCS metadata.

### 16.3 Manual Verification

- After backfill: compare `ts-contracts` doc count to GCS file count per symbol.
- After first daily builder run: verify active contract docs updated with new `lastObserved`, `observationCount`, `latest.*`.
- Query the endpoint with various filter combinations and verify results.
