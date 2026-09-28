**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #191  
**Task:** #185  
**Blueprint Parent:** #183  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# UAT — Task #185: IV rank field contract

## Steps + results

| Check | Result |
|---|---|
| Shared package compiles (`npm run build:shared` + `npx tsc --noEmit` in functions) | ✅ clean |
| `SYMBOL_METRIC_FIELDS` append-only — iv30 fields first, 12 rank fields appended | ✅ exact-order test green |
| Contract tests — `symbol-metrics.types.test.ts` | ✅ 8/8 |
| Verify script `options-data-168-symbol-metric-types.ts` | ✅ 9/9 PASS |
| `partnerIvMetricsV2` `metrics=` whitelist accepts rank fields | ✅ `ivRank360`, `ivN30` in whitelist set (total 15 fields) |
| `IvRankLatestDoc` + `IV_RANK_LATEST_COLLECTION` | ✅ round-trip + const asserted |
| Full suite regression | ✅ 761/761 |

## Verdict

**PASS** — ship-eligible.
