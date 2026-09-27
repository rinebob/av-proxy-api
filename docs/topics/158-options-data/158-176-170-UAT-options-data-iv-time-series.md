**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #176  
**Task:** #170  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# UAT — Task #170: symbol-metrics repository + computeForDate

## User-reviewable surface

Run `options-data-170-compute-for-date.ts` on any seeded pivot date — it
**writes a real `symbol-metrics/{SYM}/years/{YYYY}` doc** (the feature's own
output, idempotent). Inspect it in Firestore console: `days.{date}` holds
`{iv30, iv30Method, iv30Contracts}`; re-running overwrites that date only.

## Scope

Persistence + orchestration seam: year-shard repository merge writes and the
`MetricBuildService.computeForDate` pipeline (corpus → close → registry →
write). ACs from Task #170:

- AC1 — year-shard merge write dedupes by date key; sibling dates survive
- AC2 — close from `CompactBar.c` (split-adjusted); interim/missing bars skip
- AC3 — null compute / absent corpus → no write
- AC4 — `{symbol, date, written, fields}` return; faked seams unit-tested

## Prerequisites

`cd functions`; ADC credentials (verify script only — writes prod doc).

## Scenarios

### 1. Unit suite — repo + service + reader

- `npx jest tests/v2/symbol-metrics/ tests/v2/swing-set/services/daily-adjusted-reader.test.ts`
- Expected: 8 repository + 6 service + 4 readDate + existing tests green —
  merge/sibling preservation, stale-field replace, malformed-date throw,
  all skip paths emit zero writes.
- **Result:** PASS — all green (fake implements `mergeFields` dot-paths).

### 2. Real prod round trip

- `npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-170-compute-for-date.ts QQQ 2024-01-05`
- Expected: `written:true, fields:[iv30,iv30Method,iv30Contracts]`;
  read-back `iv30≈0.161`; idempotent recompute.
- **Result:** PASS — ran twice (pre/post mergeFields change), both clean.

### 3. Skip paths (unit)

- NOT_FOUND corpus → `written:false`, zero sets; missing close → same;
  empty chain → same; malformed date → same.
- **Result:** PASS.

### 4. Full regression

- `npx jest` (76 suites / 724 tests) + `npx tsc --noEmit`.
- **Result:** PASS.

## Negative / boundary

- Malformed date rejected before doc-key derivation (service skips, repo throws).
- Interim `barStatus` bar → close null → skip; absent `barStatus` (legacy)
  tolerated per reader semantics.
- `mergeFields` guarantees a recomputed entry replaces its old fields — no
  stale fields can linger.

## Traceability

| AC | Scenario |
|---|---|
| AC1 (dedupe/merge) | 1, 2 |
| AC2 (close source) | 1, 3 |
| AC3 (skip paths) | 3 |
| AC4 (seams + shape) | 1, 4 |

## Regression/smoke checklist

- [x] Full jest suite green (724)
- [x] `tsc --noEmit` clean
- [x] Prod round trip executed twice (before + after mergeFields change)
- [x] Shared fake upgrade regression-clean across 278 fake-consumer tests
