**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #162  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Area:** BE  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Test Plan — BE: Symbol IV metrics pipeline (IV30)

## Unit tests — `iv30.computer` (pure)

Fixtures: real-shape `response.data` chains (QQQ 2019-01-07 structure; synthetic mini-chains for control).

- Two expirations bracketing 30d → total-variance interpolated IV30, method `interpolated`.
- All expirations one side of 30d → nearest, method `nearest`.
- Strike bracket: OTM put below / call above spot; interpolation across the bracket.
- One-sided bracket → falls back to nearer side.
- Same-day/expired expirations excluded; non-finite/out-of-bounds IVs rejected.
- No usable contracts → `null` (no write).
- Determinism: same fixture → same output.

## Unit tests — repository + build service (fake Firestore)

- `computeForDate` writes `days.{date}` into `years/{YYYY}`; re-run merges/idempotent (same values, no dup).
- Null-compute → no write.
- Close lookup wiring (raw-close seam).

## Unit tests — seed-worker hook

- Success path: after `writeItem` success → compute called; entry persisted.
- `alreadyExists` path → compute still called (gap healing).
- Compute throws → warn logged, seed result unchanged (no retry/fail).

## Endpoint tests — `partnerIvMetricsV2` handler seam

- Auth failures match partner conventions.
- Untracked symbol → 404; `optionsEnabled=false` → `OPTIONS_NOT_ENABLED`.
- `from`/`to` slicing incl. year-boundary crossing; `metrics=` whitelist filter; default returns all fields.
- Empty range → empty array (not error).

## Verification script

`functions/scripts/verify/options-data-{task#}-iv-metrics.ts` — read-only-or-mutating per convention: compute real QQQ date from corpus, read back year doc, hit deployed endpoint; assert fields + ordering.

## Edge cases to cover

- Symbol enabled mid-history; disable → no writes.
- Chain with <2 expirations or single strike → nearest/single-side paths.
- Dates present in corpus but missing close bar → entry emits with fallback or null per computer contract.
