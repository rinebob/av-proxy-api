# Design: Interpolated OHLC for Options Time Series

**Status:** Proposed — awaiting review
**Owner:** Savant API
**Audience:** Savant API engineering, RS engineering
**Last updated:** 2026-07-23
**ADR:** [ADR 0001: Interpolated OHLC for Options Time Series](../../adr/0001-interpolated-ohlc-for-options-time-series.md)

---

## 1. Summary

Add interpolated open, high, and low values to each observation in the per-contract options time-series JSONL files. The interpolated values are computed by running the underlying symbol's daily O/H/L prices through the Black-Scholes-Merton model alongside the contract's stored implied volatility, strike, time-to-expiration, a constant risk-free rate, and a per-symbol dividend yield. The existing mark value serves as the close.

This gives consumers OHLC data to render candlestick charts without performing their own interpolation or obtaining underlying equity data.

**All interpolated O/H/L values are theoretical, not observed market quotes.** The API response unambiguously communicates this via `ohlcMethod` and `ohlcDisclaimer` metadata fields.

---

## 2. Motivation

Consumers currently receive only a mark (mid-market price) per observation. To render candlesticks, they would need:
- Underlying daily OHLC data
- A Black-Scholes implementation
- Per-contract metadata (strike, expiration, type)
- Risk-free rate and dividend yield assumptions

This shifts work to every consumer and requires data they may not have. The service is better positioned to compute this once and store it.

---

## 3. Goals

- Compute interpolated O/H/L for every observation where IV and underlying OHLC are available.
- Store interpolated values in the existing JSONL files using compact aliases.
- Add `contractLength` classification to GCS metadata for UI filtering.
- Communicate to consumers that O/H/L values are interpolated, not observed.
- Enrich existing QQQ files via a one-time Cloud Tasks pass.
- Incorporate interpolation inline into the TQQQ build and daily append worker.

## 4. Non-Goals

- Intraday OHLC or real-time interpolation.
- Observed market O/H/L (Alpha Vantage does not provide this for options).
- Per-date Treasury yield rates (deferred — constant rate for v1).
- Per-date dividend yield calculation (deferred — constant per symbol for v1).
- IV adjustment heuristics (e.g., scaling IV with underlying price move).
- Changing the existing `partnerHistoricalOptionsV2` response contract for non-OHLC fields.

---

## 5. Black-Scholes-Merton Formula

### 5.1 Inputs

| Input | Symbol | Source | v1 approach |
|---|---|---|---|
| Underlying price | *S* | `sa-time-series` Firestore (split-adjusted) | Pre-fetch full daily series per symbol |
| Strike | *K* | GCS object metadata | Parsed from `strike` metadata field |
| Time-to-expiration | *T* | Computed from `expiration` − `date` | Calendar days / 365 |
| Risk-free rate | *r* | Config file | Constant 4.0% (0.04) |
| Dividend yield | *q* | Config file | QQQ: 0.5% (0.005), TQQQ: 0% (0.0) |
| Implied volatility | *σ* | Stored `iv` in JSONL observation | Used as-is |
| Option type | — | GCS object metadata | `call` or `put` |

### 5.2 Formula

Standard Black-Scholes-Merton with continuous dividend yield:

```
d1 = [ln(S/K) + (r - q + σ²/2)T] / (σ√T)
d2 = d1 - σ√T

Call = S·e^(-qT)·N(d1) - K·e^(-rT)·N(d2)
Put  = K·e^(-rT)·N(-d2) - S·e^(-qT)·N(-d1)
```

Where `N(x)` is the cumulative standard normal distribution function.

### 5.3 Edge cases

| Case | Handling |
|---|---|
| T ≤ 0 (expiration day or past) | Use intrinsic value: `max(S-K, 0)` for calls, `max(K-S, 0)` for puts |
| σ missing or zero | Set `io = ih = il = mark` (flat candle) |
| Underlying OHLC missing for date | Set `io = ih = il = mark` (flat candle) |
| BS output < 0 | Clamp to 0 |
| Rounding | Round to 2 decimal places, store as string |

### 5.4 Validation

Compute `BS(underlying_close, K, T, r, q, σ, type)` and compare to the observed `mark`. If they are close (within a few cents), the implementation is correct. This is a built-in sanity check available on every observation.

---

## 6. Storage Schema Changes

### 6.1 New JSONL aliases

| Alias | API field | Source | Present when |
|---|---|---|---|
| `io` | `open` | BSM(underlying_open, ...) | IV and underlying OHLC available, or fallback to mark |
| `ih` | `high` | BSM(underlying_high, ...) | IV and underlying OHLC available, or fallback to mark |
| `il` | `low` | BSM(underlying_low, ...) | IV and underlying OHLC available, or fallback to mark |

Field order in JSONL: `d`, `io`, `ih`, `il`, `l`, `m`, `b`, `bs`, `a`, `as`, `v`, `oi`, `iv`, `de`, `g`, `t`, `ve`, `r`

### 6.2 New GCS metadata fields

| Field | Value | Present when |
|---|---|---|
| `ohlcMethod` | `"interpolated"` | File has been enriched |
| `ohlcDisclaimer` | `"Open, high, and low values are Black-Scholes interpolated from underlying OHLC and contract IV, not observed market quotes."` | File has been enriched |
| `contractLength` | Bucket label (e.g., `"3mo"`) | Always (computed on first creation or enrichment) |

### 6.3 Schema version

Remains `v1`. All new fields are additive and optional. Existing consumers are unaffected.

### 6.4 Storage line example (after enrichment)

```json
{"d":"2024-07-01","io":"11.85","ih":"12.60","il":"11.72","l":"12.30","m":"12.25","b":"12.10","bs":"10","a":"12.40","as":"10","v":"155","oi":"1002","iv":"0.24","de":"0.51","g":"0.02","t":"-0.04","ve":"0.11","r":"0.03"}
```

---

## 7. Contract Length Classification

### 7.1 Computation

Computed once when a file is first created (or during enrichment for existing files):
1. Read `firstObserved` (first date in the JSONL) and `expiration` from metadata.
2. Compute calendar-month difference: `monthDiff = (expYear - obsYear) * 12 + (expMonth - obsMonth)`.
3. For short durations (≤ 14 days), use raw DTE.
4. Map to bucket.

### 7.2 Buckets

| Bucket | Condition |
|---|---|
| `1d` | DTE ≤ 1 |
| `1w` | 2 ≤ DTE ≤ 7 |
| `2w` | 8 ≤ DTE ≤ 14 |
| `1mo` | monthDiff == 0 or 1 (same or next calendar month) |
| `2mo` | monthDiff == 2 |
| `3mo` | monthDiff == 3 |
| `6mo` | 4 ≤ monthDiff ≤ 6 |
| `1yr` | 7 ≤ monthDiff ≤ 12 |
| `2yr` | 13 ≤ monthDiff ≤ 24 |
| `3yr` | 25 ≤ monthDiff ≤ 36 |
| `3yr+` | monthDiff ≥ 37 |

Where DTE = calendar days from `firstObserved` to `expiration`.

### 7.3 Storage

Stored in GCS object metadata as `contractLength`. Returned in the API response envelope.

---

## 8. API Response Changes

### 8.1 Response envelope additions

```json
{
  "ok": true,
  "symbol": "QQQ",
  "contractID": "QQQ260829C00250000",
  "expiration": "2026-08-29",
  "type": "call",
  "strike": "250",
  "contractLength": "2yr",
  "ohlcMethod": "interpolated",
  "ohlcDisclaimer": "Open, high, and low values are Black-Scholes interpolated from underlying OHLC and contract IV, not observed market quotes.",
  "startDate": "2024-07-01",
  "endDate": "2026-08-29",
  "series": [...]
}
```

- `contractLength`: Always present (computed for every file).
- `ohlcMethod` and `ohlcDisclaimer`: Only present when the file has been enriched with interpolated OHLC.

### 8.2 Per-observation additions

```json
{
  "date": "2024-07-01",
  "open": "11.85",
  "high": "12.60",
  "low": "11.72",
  "last": "12.30",
  "mark": "12.25",
  "bid": "12.10",
  "bid_size": "10",
  "ask": "12.40",
  "ask_size": "10",
  "volume": "155",
  "open_interest": "1002",
  "implied_volatility": "0.24",
  "delta": "0.51",
  "gamma": "0.02",
  "theta": "-0.04",
  "vega": "0.11",
  "rho": "0.03"
}
```

- `open`, `high`, `low`: Present when interpolated (or fallback to mark). Absent only if the file has not been enriched.

---

## 9. Implementation Plan

### 9.1 File structure

All new modules in `functions/src/v2/historical-options-corpus/services/`:

| File | Concern | Type |
|---|---|---|
| `black-scholes.utils.ts` | BSM pricing formula + normal CDF | Pure utility (no I/O) |
| `underlying-ohlc.service.ts` | Fetch split-adjusted daily bars from `sa-time-series` Firestore | Service (Firestore I/O) |
| `ohlc-interpolator.service.ts` | Given observation + underlying OHLC + config → `io`/`ih`/`il` | Service (orchestration) |
| `ohlc-interpolation.config.ts` | Risk-free rate, dividend yields, rounding config | Config constants |
| `contract-length.utils.ts` | Calendar-month bucket classification | Pure utility (no I/O) |
| `ohlc-enrichment-worker.service.ts` | Cloud Task handler: read JSONL, enrich, rewrite | Service (GCS I/O) |

Barrel exports updated in `services/index.ts`.

### 9.2 Implementation order

#### Phase 1: Shared modules

1. `black-scholes.utils.ts` — BSM formula with dividend yield, normal CDF, intrinsic value fallback, non-negative clamp.
2. `contract-length.utils.ts` — Calendar-month bucket classifier.
3. `ohlc-interpolation.config.ts` — Constants: `riskFreeRate: 0.04`, `dividendYields: { QQQ: 0.005, TQQQ: 0 }`, `roundingDecimals: 2`.
4. `underlying-ohlc.service.ts` — Query `sa-time-series` year-sharded docs, build `Map<string, {o, h, l}>` keyed by `d` (YYYY-MM-DD).
5. `ohlc-interpolator.service.ts` — Ties BS + OHLC + contract metadata together. Returns `{io, ih, il}` or `{io: mark, ih: mark, il: mark}` for fallback cases.
6. Update `time-series-contract.utils.ts` — Add `io`/`ih`/`il` to `TimeSeriesStorageRecord`, `TimeSeriesApiObservation`, alias tables, and `storageFieldOrder`.

#### Phase 2: Enrichment pass (existing QQQ files)

1. `ohlc-enrichment-worker.service.ts` — Cloud Task handler:
   - Receive `{ symbol, contractID, underlyingSeries }` payload.
   - Read JSONL file from GCS.
   - Read GCS object metadata for `strike`, `expiration`, `type`.
   - For each line: parse, look up underlying OHLC by date, compute `io`/`ih`/`il`.
   - Compute `contractLength` from `firstObserved` + `expiration`.
   - Rewrite file with `ifGenerationMatch` precondition.
   - Update GCS metadata: add `ohlcMethod`, `ohlcDisclaimer`, `contractLength`.
2. Admin HTTP function `triggerOptionsOhlcEnrichment`:
   - Parameters: `symbol`, `execute` (plan vs enqueue), optional `expirationFilter` for pilot.
   - Lists all JSONL files under `time-series/v1/{SYMBOL}/` prefix.
   - Pre-fetches full underlying daily series from Firestore.
   - Enqueues one Cloud Task per file with the underlying series in the payload (~95KB, well within limits).
3. Cloud Tasks queue: `OPTIONS_OHLC_ENRICHMENT_TASK_QUEUE`.
4. Pilot: Run on two expiration dates (one monthly, one weekly). Inventory `contractLength` bucket coverage. Verify:
   - `io`/`ih`/`il` values are sensible (BS(close) ≈ mark).
   - `contractLength` buckets are correct.
   - No negative values.
   - Missing IV/underlying cases produce flat candles (io=ih=il=mark).
   - File sizes haven't grown unexpectedly.
5. Full run: Enqueue all ~300k-500k QQQ files.

#### Phase 3: Builder + append modifications

1. Modify `TimeSeriesBuilderService.buildSymbol()`:
   - Pre-fetch underlying OHLC at start of build.
   - For each observation, call `ohlc-interpolator.service.ts` to compute `io`/`ih`/`il`.
   - Compute `contractLength` when creating a new file (from first observation date + expiration).
   - Write `ohlcMethod`, `ohlcDisclaimer`, `contractLength` to GCS metadata.
2. Modify daily append worker:
   - Fetch one date's underlying OHLC from Firestore.
   - Compute `io`/`ih`/`il` for the new observation.
   - Append with interpolated fields.
   - `contractLength` already set in metadata from file creation — no change.

### 9.3 Idempotency

The enrichment pass is idempotent: reprocessing an already-enriched file produces identical output (same inputs → same BS output). If reprocessing becomes wasteful, a Firestore ledger can track enriched contract IDs.

### 9.4 Pilot verification checklist

- [ ] BS(close, K, T, r, q, σ, type) ≈ mark for sampled observations (within a few cents)
- [ ] `io` ≤ `ih` and `il` ≤ `ih` for all observations (high is the highest)
- [ ] No negative interpolated values
- [ ] Missing IV → `io = ih = il = mark`
- [ ] Missing underlying → `io = ih = il = mark`
- [ ] Expiration day → intrinsic value (not BS formula)
- [ ] `contractLength` buckets correct for sampled contracts
- [ ] All `contractLength` buckets represented in pilot sample
- [ ] GCS metadata includes `ohlcMethod`, `ohlcDisclaimer`, `contractLength`
- [ ] API response includes new fields when enriched
- [ ] API response omits `ohlcMethod`/`ohlcDisclaimer` for non-enriched files
- [ ] File size growth is within expected bounds (~20-30 bytes per line)

---

## 10. Configuration

### 10.1 `ohlc-interpolation.config.ts`

```typescript
export const OHLC_INTERPOLATION_CONFIG = {
  riskFreeRate: 0.04,
  dividendYields: {
    QQQ: 0.005,
    TQQQ: 0.0,
  },
  roundingDecimals: 2,
} as const;
```

### 10.2 Future configuration (TODO)

- Per-date Treasury yield rates from Alpha Vantage `TREASURY_YIELD` endpoint.
- Per-date dividend yield computed from historical dividend data.
- Configurable per-symbol overrides.

---

## 11. TODO / Deferred Items

| Item | Description | Priority |
|---|---|---|
| Treasury Yield integration | Replace constant 4.0% rate with per-date Treasury yields matched to contract DTE. Alpha Vantage docs: https://www.alphavantage.co/documentation/#treasury-yield | Future |
| Per-date dividend yield | Compute actual trailing dividend yield from historical dividend data per observation date. | Future |
| Firestore enrichment ledger | Track which contract IDs have been enriched to avoid wasteful reprocessing on resume. | If needed |
| TQQQ backfill | Run Phase 1a (raw corpus) and Phase 1b (time-series build with inline interpolation) for TQQQ. | After QQQ enrichment |

---

## 12. Risks and Controls

| Risk | Control |
|---|---|
| Interpolated values mistaken for observed market quotes | `ohlcMethod` + `ohlcDisclaimer` in metadata and API response; inviolable requirement |
| BS implementation error | Validate BS(close) ≈ mark on every observation; pilot before full run |
| Missing underlying OHLC for some dates | Fallback to mark (flat candle); log warning |
| Enrichment pass timeout or partial failure | Cloud Tasks with retry; idempotent reprocessing |
| File size growth | ~20-30 bytes per line; monitor during pilot |
| Contract length misclassification | Calendar-month logic handles variable month lengths; verify during pilot |
| Constant rate/dividend yield inaccuracy | Small impact on BS price for visualization; configurable; upgrade path documented |
