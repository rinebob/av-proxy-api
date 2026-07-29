# Implementation Plan: Spread Time Series

## Status

**Phase 1 & 2 complete** — 2026-07-28

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Single-spread endpoint | Complete |
| 2 | Batch endpoint | Complete |
| 3 | Strategy scan (async) | Not started |
| 4 | Caching | Not started |

---

## Phase 1: Single-Spread Endpoint

### File Structure

```
functions/src/v2/
  spread-pricing/
    services/
      occ-id-constructor.utils.ts    — pure: leg params → OCC contract ID
      spread-validator.utils.ts      — pure: spreadType + legs → valid/invalid
      leg-mark-resolver.utils.ts     — pure: mark fallback chain (mark → bid/ask mid → carry-forward → skip)
      spread-pricing.service.ts      — I/O: reads GCS, aligns dates, computes spread series + Greeks
      index.ts                       — barrel re-exports
  partner/
    spread-request.types.ts          — request/response TypeScript interfaces
    spread-time-series-partner.ts    — POST handler, auth, validation, delegates to pricing service
```

### Task 1.1: Shared Types (`spread-request.types.ts`)

Define all request and response interfaces:

- `SpreadRequest` — top-level request shape
- `SpreadLegRequest` — per-leg input (`expiration`, `strike`, `optionType`, `direction`)
- `SpreadType` — union: `"vertical" | "straddle" | "strangle" | "iron_condor"`
- `LegDirection` — union: `"long" | "short"`
- `SpreadResponse` — top-level response shape (includes `debitOrCredit: "debit" | "credit"`)
- `DebitOrCredit` — union: `"debit" | "credit"`
- `SpreadLegResponse` — per-leg metadata + leg series
- `SpreadObservation` — `{ date, price, delta, gamma, theta, vega, rho }`
- `LegObservation` — `{ date, mark }`
- `SpreadError` — error response shape

### Task 1.2: OCC ID Constructor (`occ-id-constructor.utils.ts`)

Pure function that builds an OCC contract ID from leg parameters:

```typescript
buildContractID(symbol: string, expiration: string, optionType: "call" | "put", strike: number): string
```

Format: `{SYMBOL}{YYMMDD}{C|P}{STRIKE×1000 padded to 8 digits}`

This is the inverse of the existing `parseContractIDMetadata` in `contract-metadata.utils.ts`. No I/O.

### Task 1.3: Spread Validator (`spread-validator.utils.ts`)

Pure function that validates legs against spread type rules:

```typescript
validateSpread(request: SpreadRequest): { valid: true } | { valid: false; error: string }
```

Rules:
- **vertical:** 2 legs, same `optionType`, same `expiration`, different `strike`, one `long` + one `short`
- **straddle:** 2 legs, same `strike`, same `expiration`, one `call` + one `put`, same `direction`
- **strangle:** 2 legs, different `strike`, same `expiration`, one `call` + one `put`, same `direction`
- **iron_condor:** 4 legs, same `expiration`, two `call` + two `put`, two `long` + two `short`, all different `strike`

Also validates: `symbol` is in allowed set, `expiration` is valid ISO date, `strike` is a positive number.

### Task 1.4: Leg Mark Resolver (`leg-mark-resolver.utils.ts`)

Pure function that resolves the mark for a single observation using the fallback chain:

```typescript
resolveMark(
  record: TimeSeriesStorageRecord,
  lastKnownMark: number | null
): { mark: number; updated: boolean } | { mark: null; updated: false }
```

Logic:
1. If `record.m` is present and parseable → return `Number(record.m)`
2. If `record.b` and `record.a` are present → return `(Number(record.b) + Number(record.a)) / 2`
3. If `lastKnownMark` is not null → return `lastKnownMark`
4. Return `null` (skip this day)

### Task 1.5: Spread Pricing Service (`spread-pricing.service.ts`)

The core engine. Takes a validated `SpreadRequest`, reads leg JSONL files from GCS, and computes the spread time series.

```typescript
class SpreadPricingService {
  constructor(private readonly gcs: GcsTimeSeriesAdapter) {}

  async computeSpread(request: SpreadRequest): Promise<SpreadResult>
}
```

Flow:
1. For each leg, construct the OCC contract ID using `buildContractID`
2. Read the JSONL file via `gcs.readLines(symbol, contractID)`
3. If file not found → return error with leg index and contract ID
4. Parse all lines via `parseStorageLine` → `TimeSeriesStorageRecord[]`
5. For each leg, build a `Map<string, TimeSeriesStorageRecord>` keyed by date
6. Compute the intersection of all leg date sets
7. For each date in the intersection (sorted ascending):
   - For each leg, resolve the mark using `resolveMark` with carry-forward state
   - If any leg returns `null` mark → add date to `gaps` array, skip
   - Compute spread price: `sum(long marks) − sum(short marks)`
   - Compute spread Greeks: signed sum of leg Greeks
   - Round: price/delta/theta/vega/rho to 2 decimals, gamma to 4 decimals
   - Build `SpreadObservation`
8. Apply optional `startDate`/`endDate` filter
9. Build leg metadata (contract ID, firstObserved, lastObserved, leg series with date + mark)
10. Return `SpreadResult` with series, legs, gaps, startDate, endDate

### Task 1.6: HTTP Handler (`spread-time-series-partner.ts`)

POST handler following the existing partner endpoint pattern:

- Define secrets (`ALLOWED_SERVICE_ACCOUNT_EMAILS`, `EXPECTED_GOOGLE_AUDIENCE`)
- Define function options (256MiB, 30s, max 20 instances)
- Parse and validate JSON body → `SpreadRequest`
- Authenticate via `authenticateRequestEither`
- Validate spread structure via `validateSpread`
- Delegate to `SpreadPricingService.computeSpread`
- Return `SpreadResponse` or error
- Check response size against 10 MiB limit
- Log request/response metadata

### Task 1.7: Register in `index.ts`

Add the new function to the v2 index exports.

### Task 1.8: Tests

Create `functions/tests/v2/spread-pricing/` and `functions/tests/v2/partner/` test files:

**`occ-id-constructor.test.ts`:**
- Expected use: QQQ call strike 450 → `QQQ240719C00450000`
- Edge case: fractional strike (450.5 → `00450500`)
- Edge case: TQQQ put strike 100 → `TQQQ240719P00100000`

**`spread-validator.test.ts`:**
- Expected use: valid vertical, straddle, strangle, iron condor
- Edge case: same strike on vertical → invalid
- Failure case: 3 legs on vertical → invalid
- Failure case: mismatched expirations on iron condor → invalid

**`leg-mark-resolver.test.ts`:**
- Expected use: mark present → returns mark
- Edge case: mark missing, bid/ask present → returns midpoint
- Edge case: mark missing, no bid/ask, lastKnownMark present → returns carry-forward
- Failure case: all missing → returns null

**`spread-pricing.service.test.ts`:**
- Expected use: 2-leg vertical, full overlap → correct spread prices
- Edge case: legs with different start dates → intersection only
- Edge case: gap day in one leg → date in gaps array
- Failure case: leg contract not found in GCS → error with contract ID

**`spread-time-series-partner.test.ts`:**
- Expected use: valid POST → 200 with spread series
- Edge case: startDate/endDate filter applied
- Failure case: missing symbol → 400
- Failure case: invalid spreadType → 400
- Failure case: auth failure → 401
- Failure case: non-POST method → 405

### Task 1.9: Post-Deployment

Follow the `.devin/workflows/deploy-partner-endpoint.md` workflow:
1. Update `EXPECTED_GOOGLE_AUDIENCE` secret with the new function URL
2. Grant `roles/run.invoker` on the new Cloud Run service (lowercase name)
3. Set `OPTIONS_TIME_SERIES_BUCKET` env var via `gcloud run services update`
4. No Firestore indexes needed (Phase 1 does not query Firestore)
5. Redeploy the function to mount the updated secret
6. Verify with `Invoke-RestMethod` (POST endpoint)

---

## Phase 2: Batch Endpoint

### File Structure

```
functions/src/v2/
  partner/
    spread-time-series-batch-partner.ts  — batch POST handler + orchestrator
```

### Tasks

1. ✅ Add `SpreadBatchRequest` / `SpreadBatchResponse` / `SpreadBatchItem` types to `spread-request.types.ts`
2. ✅ Implement batch handler with:
   - Max 200 spreads validation (hardcoded ceiling)
   - Parallel GCS reads with bounded concurrency (10 spreads per chunk via `Promise.all`)
   - Per-spread `ok`/`error` results with `index` field for ordering
   - Top-level summary: `total`, `succeeded`, `failed`
   - No leg series in batch results
   - Batch-level `startDate`/`endDate` override (per-spread dates as fallback)
   - 1GiB memory, 120s timeout, max 20 instances
3. ✅ Register in `index.ts`
4. ✅ Tests (12 tests): 405, 400 (missing body, empty spreads, max size, date validation), 403, 200, partial failures, leg not found, batch date override, 500, index ordering
5. ✅ Post-deployment workflow (secret, IAM, env var, redeploy, verify)

---

## Phase 3: Strategy Scan

### Outline

1. Strategy template types (spread type, DTE, strike selection, entry frequency, exit rule)
2. Enumeration service (pure: template + trading calendar → list of `SpreadRequest` objects)
3. Cloud Tasks queue with `SpreadPricingService` as the worker
4. GCS output writer (aggregate results into a single downloadable file)
5. Job status tracking (Firestore job doc with progress)
6. Async endpoint: POST template → return job ID; GET job status → return download URL when complete

---

## Phase 4: Caching

### Outline

1. Cache key: hash of `SpreadRequest` (stable serialization)
2. GCS path: `spreads/v1/{HASH}.json`
3. Cache check before compute; write on miss
4. Staleness: compare leg JSONL `generation` timestamps against cache creation time
5. Optional: TTL-based eviction
