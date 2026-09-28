**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #186  
**Task:** #186  
**Blueprint Parent:** #184  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# Code Review — Task #186: IV rank/percentile computers

## Scope reviewed

- `functions/src/v2/symbol-metrics/rank/iv-rank.computer.ts`
- `functions/tests/v2/symbol-metrics/iv-rank.computer.test.ts` (10 tests)

## Result

**NO FINDINGS** — single round, converged clean.

Verified:

- UTC `Date.parse` window math — exact calendar days, no DST, leap-correct;
  floor/asOf inclusive (30d boundary test covers it)
- `ivRank`/`ivPct`/`ivN` semantics match PRD — n<2 withholds rank only,
  constant series → 0, ties count toward cur (`iv ≤ cur`)
- Absent-not-undefined fields — `ignoreUndefinedProperties` + mergeFields
  write make stored entries clean regardless
- Malformed inputs graceful (NaN parse → dropped/ivN 0)
- Convention match — recipe-style header comment, pure second-order module
  outside the MetricComputer registry (per plan decision)

Non-blocking: caller must pass the asOf row's own iv30 as `cur` (documented);
values unrounded (33.33…) — spec-unconstrained, consumer-visible.

## Verdict

**PASS** — task → QA.
