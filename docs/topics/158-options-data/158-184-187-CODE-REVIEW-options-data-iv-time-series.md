**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #187  
**Task:** #187  
**Blueprint Parent:** #184  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# Code Review — Task #187: RankBuildService + iv-rank-latest repository

## Scope reviewed

- `functions/src/v2/symbol-metrics/rank-build.service.ts`
- `functions/src/v2/symbol-metrics/services/iv-rank-latest.repository.ts`
- `functions/tests/v2/symbol-metrics/rank-build.service.test.ts` (8 tests)

## Findings

**NO BLOCKING FINDINGS** — one nit, remediated with a comment:

- **Stale rank field linger** — `{...entry, ...fields}` preserves a
  previously-emitted `ivRank{W}` if a recompute withholds it (n regression
  requires a prior entry's iv30 to correct to absent — unlikely, self-heals
  next healthy pass). Documented in-code; not a fix.

## Verified

- Window reach: 360d < 366 → at most 2 year shards, always correct
- Merge write correct against `mergeFields` wholesale-replace semantics
- `latestUpdated` guard (`date >= asOfDate`) — ISO string compare, whole-doc
  replace → no skew
- Deps-injection + skip-shape conventions match MetricBuildService
- Test coverage: skip paths, shard spanning, regress guard, same-date heal,
  idempotency, repo delete

## Verdict

**PASS** — task → QA.
