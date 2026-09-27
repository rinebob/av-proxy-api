**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #177  
**Task:** #171  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# UAT — Task #171: seed-worker metric compute hook

## User-reviewable surface

No direct user-facing surface — this wires `computeForDate` into
`seedCorpusItem` so metrics flow automatically wherever corpus objects are
confirmed present. Observable after deploy via:

- `seed.metrics.written` / `seed.metrics.skipped` / `seed.metrics.error`
  log events in the `processHistoricalOptionsCorpusSeedTask` logs
- New `symbol-metrics/{SYM}/years/{YYYY}` docs growing as seeds run

## Scope

ACs from Task #171:

- AC1 — fresh write → metrics computed + day entry persisted
- AC2 — alreadyExists hit → metrics still computed (chain read back via
  `gcs.readItem` — the worker short-circuits before fetch on that path)
- AC3 — compute failure → warn logged, seed result unchanged
- AC4 — unit tests cover all three paths
- Sole production trigger: nightly seeds, pivot backfill, ad-hoc
  densification all flow through `seedCorpusItem`

## Scenarios

### 1. Worker unit suite — all confirmed-present paths

- `npx jest tests/v2/historical-options-corpus/corpus-seed.worker.test.ts`
- Expected: metrics fire on stored, gcs-hit, and already-recorded;
  `onSeedSuccess` re-fires on already-recorded; throwing metrics dep →
  `seed.metrics.error` + unchanged result; options-disabled → no compute.
- **Result:** PASS — 16 tests green.

### 2. Wiring typecheck

- `npx tsc --noEmit` — `corpus-seed.task.ts` constructs real
  `MetricBuildService` (GcsCorpusAdapter + DailyAdjustedReader +
  SymbolMetricsRepository); structural seam satisfied without casts.
- **Result:** PASS.

### 3. Full regression

- `npx jest` — 76 suites / 734 tests.
- **Result:** PASS.

### 4. Prod surface

- The deployed `processHistoricalOptionsCorpusSeedTask` predates this hook —
  metrics flow only after the next seed-task deploy. Deferred-verification
  item: run a seed task on a seeded date, observe `seed.metrics.written`
  log + `days.{date}` entry in Firestore.
- **Result:** DEFERRED to post-deploy (tracked below).

## Negative / boundary

- Metrics throw → `seed.metrics.error` logged, `status:'stored'` returned —
  the seed never retries/fails over a metric error.
- Malformed date → `computeForDate` deterministic skip → `seed.metrics.skipped`.
- Stale metadata (doc success, object deleted) → `readItem` NOT_FOUND →
  graceful skip.
- Lease-held ts-build enqueue (user's concurrent change): independent —
  metrics compute runs regardless.

## Traceability

| AC | Scenario |
|---|---|
| AC1 (fresh write) | 1 |
| AC2 (alreadyExists/gap healing) | 1 |
| AC3 (warn-not-fail) | 1 |
| AC4 (tests) | 1–3 |
| Sole trigger | wiring verified in `corpus-seed.task.ts` |

## Regression/smoke checklist

- [x] Worker suite green (16)
- [x] Full jest suite green (734)
- [x] `tsc --noEmit` clean
- [ ] Post-deploy prod observation (seed.metrics.* log events)
