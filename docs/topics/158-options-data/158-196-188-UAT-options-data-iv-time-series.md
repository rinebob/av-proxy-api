**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #196  
**Task:** #188  
**Blueprint Parent:** #184  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# UAT — Task #188: Seed-worker rank-pass hook + disable cleanup

## Steps + results

| Check | Result |
|---|---|
| Rank pass runs after metrics pass on confirmed-present paths (`order == [metrics, rank]` asserted) | ✅ |
| Rank pass warn-swallowed — seed result unaffected, `seed.rank.error` logged | ✅ |
| Rank still runs when metrics threw (independent passes — stale rows are rankable) | ✅ |
| Mid-flight disable — enabled re-check inside the seam skips both passes (`seed.metrics.skip.disabled`) | ✅ |
| `onDisable` deletes `iv-rank-latest` on true→false only; no-op re-disable doesn't re-fire | ✅ |
| Disable failure warns but the flag write succeeds | ✅ |
| Full suite regression | ✅ 793/793; tsc clean |

## Verdict

**PASS** — ship-eligible.
