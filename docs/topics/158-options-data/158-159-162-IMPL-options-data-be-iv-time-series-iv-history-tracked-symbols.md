**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #162  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Area:** BE  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Implementation Plan — BE: Symbol IV metrics pipeline (IV30)

## Goal

Compute a constant-maturity ATM implied volatility (IV30) per `(optionsEnabled symbol, corpus date)` from the stored chain snapshot, persist it to year-sharded `symbol-metrics` Firestore docs, and serve it via `partnerIvMetricsV2`. Zero new scheduled functions — compute rides on the corpus seed task.

## Approach

### 1. Metric computers + registry

New module `functions/src/v2/symbol-metrics/`:

```ts
// A computer evaluates one day's chain + context → fields for the day entry.
export interface MetricComputer {
  readonly fields: string[];                        // e.g. ['iv30','iv30Method']
  compute(input: MetricInput): MetricDayEntry | null; // null = no data
}
export interface MetricInput {
  chain: RawOptionContract[];    // response.data rows
  underlyingClose: number | null;
  date: string;                  // YYYY-MM-DD
}
export const METRIC_REGISTRY: MetricComputer[] = [iv30Computer];
```

`iv30.computer` (pure, unit-tested):
- Group chain by `expiration`; drop `expiration <= date`.
- Per expiration: parse `implied_volatility` decimals (reject non-finite or outside `[0.005, 5.0]`); find the two strikes bracketing `underlyingClose`; take the OTM side at each strike (put below, call above); linear-interpolate IV across the bracket; single-side fallback allowed.
- DTE in calendar days; expirations bracketing 30 days interpolate in **total variance** `w = σ²·T`; result `σ = sqrt(w_interp / T_target)`.
- No bracketing pair → nearest expiration, `method: 'nearest'`; bracketed → `'interpolated'`. Wide-bracket/thin chains still emit; quality carried on the entry (`iv30Method`; future `iv30Q`).

### 2. Underlying close source — RESOLVED

Use `CompactBar.c` — the stored **split-adjusted close** from `symbol-data/{SYM}/sa-time-series/av-daily-adjusted/years/{YYYY}` (exposed as `DailyAdjustedBar.close` by `DailyAdjustedReader`). This is the right bracketing price: historical option strikes are split-adjusted the same way. Do **not** use `ac`/`adjustedClose` — dividend adjustment drifts from traded price over long history and would skew the ATM bracket. `barStatus !== 1` bars are skipped (interim).

### 3. Repository + build service

- `SymbolMetricsRepository` — reads/writes `symbol-metrics/{SYMBOL}/years/{YYYY}` docs; `days` map keyed `YYYY-MM-DD`; writes merge `days.{date}` (idempotent, dedupe-by-key). 4-segment path = valid doc path.
- `MetricBuildService.computeForDate(symbol, date)` — reads the stored corpus object via `GcsCorpusAdapter`, loads underlying close, runs registry, writes the entry. Returns `{symbol, date, written: boolean, fields}`.

### 4. Trigger — inside the corpus seed worker (no new function)

In `seedCorpusItem` (`corpus-seed.worker.ts`), after the object is **confirmed present** — fresh write *or* `alreadyExists` hit — call `MetricBuildService.computeForDate`. Wrap in try/catch → warn-not-fail: metric failure never fails/retries the seed. Covers nightly, pivot backfill, and ad-hoc densification uniformly; re-seeding a date recomputes its metrics, which is also the manual repair path.

Note: the `alreadyExists` early-return path must still compute — that path is the gap-healer for dates whose chain exists but metric failed. It needs a `gcs.readItem` of the stored object (small, KBs–MBs).

### 5. Partner endpoint — `partnerIvMetricsV2`

- `functions/src/v2/partner/iv-metrics-partner.ts`, same auth (service-account/Firebase dual) + envelope conventions as `partnerHistoricalOptionsV2`.
- `GET ?symbol=&from=&to=&metrics=` — reads the year doc(s) spanning the range, slices `days`, returns ascending rows `{date, ...fields}`. `metrics` is a whitelist filter; default = all computed fields.
- Errors: untracked → `404`; `optionsEnabled=false` → `OPTIONS_NOT_ENABLED` — matching existing partner error codes.

### 6. No admin endpoint

Densification/recompute reuses existing machinery (pilot `dateSource: 'pivots'`/`'calendar'` execute runs, seed fanout). Nothing new to operate.

## Module layout

```
functions/src/v2/symbol-metrics/
├── metrics/iv30.computer.ts      # pure IV30 recipe
├── metrics/registry.ts           # METRIC_REGISTRY
├── services/metric-build.service.ts
├── services/symbol-metrics.repository.ts
└── types.ts                      # MetricDayEntry, year-doc shape, MetricInput
functions/src/v2/partner/iv-metrics-partner.ts
functions/src/v2/historical-options-corpus/services/corpus-seed.worker.ts  # +compute hook
```

## Risks

| Risk | Mitigation |
|---|---|
| Close source is adjusted-only | Verify at impl; fallback chain PCP derivation |
| Metric compute failure orphans a date silently | Warn-not-fail + compute-on-hit self-heals on re-seed; sweep does not recreate it — accepted, documented |
| `days.{date}` merge writes vs concurrent seeds | Single writer per `(sym,date)`; merges are field-scoped |
| Garbage IVs in chains | IV bounds filter + OTM-side selection + quality field |

## Open questions

- Exact quality-flag field set beyond `iv30Method` (blueprint default: `n` contracts used, bracket expirations) — finalize in first task.

## Acceptance criteria

- [ ] IV30 computer: correct per-fixture outputs incl. bracketing, fallback, bounds.
- [ ] Seed worker computes metrics on write **and** on already-exists hit; failures warn-not-fail.
- [ ] `symbol-metrics/{SYM}/years/{YYYY}` entries written/merged idempotently.
- [ ] `partnerIvMetricsV2` serves range/point reads with partner auth + error codes.
- [ ] Verify script: prod round-trip on a real symbol/date.
