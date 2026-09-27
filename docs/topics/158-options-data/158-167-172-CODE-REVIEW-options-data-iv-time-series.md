**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #172  
**Task:** #172  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# Code Review — Task #172: partnerIvMetricsV2 endpoint

## Scope reviewed

- `functions/src/v2/partner/iv-metrics-partner.ts` (new)
- `functions/src/v2/partner/historical-options-request.utils.ts` (enum + SYMBOL_PATTERN export)
- `functions/src/index.ts` (registration)
- `functions/tests/v2/partner/iv-metrics-partner.test.ts` (10 tests)

## Findings (three axes) + resolutions

- **[Hard — standards] `as never` test fixtures** — replaced with a real
  `TimestampLike` stub (`{seconds:0, nanoseconds:0}`).
- **[Judgement] Module-scope repo construction** — moved to lazy construction
  inside the `readYear` dep closure, matching sibling handlers.
- **[Judgement] Duplicated `SYMBOL_PATTERN`** — now exported from
  `historical-options-request.utils.ts` and reused.
- **[Judgement] Missing warn-logs on rejections** — `ivMetrics.*` warn events
  added for method_not_allowed, invalid_request (both 400 paths), auth
  rejects, symbol_not_tracked, options_not_enabled, response_too_large.
- **[Low — thermo] No `MAX_RESPONSE_BYTES`/413 guard** — added for sibling
  parity.
- **[Low — thermo] Unvalidated `days` entries** — null/non-object entries are
  skipped (covered by a deliberate corrupt fixture in the test).
- Spec axis: all ACs verified — ascending cross-year rows, lenient metrics
  whitelist, 404/403 gates, empty-range `[]`. Duplicate metric names collapse
  in row output (cosmetic, acceptable).

## Round 2 (convergence)

One minor: auth-reject and span/metrics 400 paths still silent — warn-logs
added. Otherwise clean.

## Test results

- 10 handler-seam tests green (405/400/404/403/500, boundary, filters,
  corrupt entry, empty range, auth reject).
- Full suite: 77 suites / 748 tests; `tsc --noEmit` clean.

## Verdict

**PASS** — task → QA.
