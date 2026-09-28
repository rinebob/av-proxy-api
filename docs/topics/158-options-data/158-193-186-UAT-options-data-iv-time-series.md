**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #193  
**Task:** #186  
**Blueprint Parent:** #184  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# UAT — Task #186: IV rank/percentile computers

## Steps + results

| Check | Result |
|---|---|
| Pure-function unit suite — `iv-rank.computer.test.ts` | ✅ 10/10 |
| Window math — calendar days, inclusive floor/asOf, leap-correct (360d boundary caught a fixture bug — computer was right) | ✅ |
| `ivRank` withheld at n<2; constant series → 0; `ivPct` counts `iv ≤ cur`; `ivN` always emitted | ✅ all asserted |
| Malformed dates dropped, no throw | ✅ |
| `computeRankFields` emits a valid `SymbolMetricDayEntry` subset (whitelisted fields only) | ✅ |
| Full suite regression | ✅ 778/778 |
| tsc clean for module | ✅ |

## Verdict

**PASS** — ship-eligible.
