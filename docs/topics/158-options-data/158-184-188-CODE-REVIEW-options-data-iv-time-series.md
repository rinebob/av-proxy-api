**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #188  
**Task:** #188  
**Blueprint Parent:** #184  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# Code Review — Task #188: Rank-pass hook + disable cleanup

## Scope reviewed

- `functions/src/v2/historical-options-corpus/services/corpus-seed.worker.ts` — `rankMetrics` seam, `seed.rank.*` logs
- `functions/src/v2/historical-options-corpus/handlers/corpus-seed.task.ts` — prod wiring
- `functions/src/v2/symbol-flags/functions/set-options-enabled.core.ts` + `.function.ts` — `onDisable` → `iv-rank-latest` delete
- Tests: worker + set-options-enabled suites

## Findings (remediated in-review)

1. **Mid-flight disable race (minor → fixed)** — a seed that passed the entry
   `isOptionsEnabled` gate before a disable could still run the rank pass and
   re-create `iv-rank-latest/{SYM}` after `onDisable` deleted it; a
   re-disable is a no-op so nothing else would ever clean it up. → Added an
   enabled re-check inside `computeSymbolMetrics` before either pass runs
   (`seed.metrics.skip.disabled` log) — the window is now ~ms, not
   task-lifetime. Pinned by a test.
2. **Missing independence pin (minor → fixed)** — rank still running after a
   metrics throw was correct but unasserted. → Added test.

## Verified

- Ordering: metrics then rank inside one seam; independent try/catch — a
  metrics failure leaves previously-stored IV30 rows rankable, so rank
  still running is correct intent
- Dep construction inside the request handler (no module-scope init)
- `onDisable` fires only on true→false; `setOptionsEnabledV2` is the sole
  flag-flip path (saveTrackedSymbol strips the field, optionable probe only
  defaults)
- Log names mirror `seed.metrics.*`; `latestUpdated` surfaced

## Verdict

**PASS** — task → QA.
