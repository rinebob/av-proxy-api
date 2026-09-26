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
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Test Plan â€” BE: Symbol IV metrics pipeline (IV30)

## Unit tests â€” `iv30.computer` (pure)

Fixtures: real-shape `response.data` chains (QQQ 2019-01-07 structure; synthetic mini-chains for control).

- Two expirations bracketing 30d â†’ total-variance interpolated IV30, method `interpolated`.
- All expirations one side of 30d â†’ nearest, method `nearest`.
- Strike bracket: OTM put below / call above spot; interpolation across the bracket.
- One-sided bracket â†’ falls back to nearer side.
- Same-day/expired expirations excluded; non-finite/out-of-bounds IVs rejected.
- No usable contracts â†’ `null` (no write).
- Determinism: same fixture â†’ same output.

## Unit tests â€” repository + build service (fake Firestore)

- `computeForDate` writes `days.{date}` into `years/{YYYY}`; re-run merges/idempotent (same values, no dup).
- Null-compute â†’ no write.
- Close lookup wiring (raw-close seam).

## Unit tests â€” seed-worker hook

- Success path: after `writeItem` success â†’ compute called; entry persisted.
- `alreadyExists` path â†’ compute still called (gap healing).
- Compute throws â†’ warn logged, seed result unchanged (no retry/fail).

## Endpoint tests â€” `partnerIvMetricsV2` handler seam

- Auth failures match partner conventions.
- Untracked symbol â†’ 404; `optionsEnabled=false` â†’ `OPTIONS_NOT_ENABLED`.
- `from`/`to` slicing incl. year-boundary crossing; `metrics=` whitelist filter; default returns all fields.
- Empty range â†’ empty array (not error).

## Verification script

`functions/scripts/verify/options-data-{task#}-iv-metrics.ts` â€” read-only-or-mutating per convention: compute real QQQ date from corpus, read back year doc, hit deployed endpoint; assert fields + ordering.

## Edge cases to cover

- Symbol enabled mid-history; disable â†’ no writes.
- Chain with <2 expirations or single strike â†’ nearest/single-side paths.
- Dates present in corpus but missing close bar â†’ entry emits with fallback or null per computer contract.
