**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #195  
**Task:** #187  
**Blueprint Parent:** #184  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# UAT — Task #187: RankBuildService + iv-rank-latest repository

## Steps + results

| Check | Result |
|---|---|
| Rank pass writes merged day entry — `iv30` preserved, rank fields added | ✅ |
| Window spans the prior year shard when a 360d window crosses it | ✅ |
| `iv-rank-latest` upserts on newest date; older-date recompute does not regress `asOfDate` | ✅ |
| Same-date recompute heals (latest doc rewritten on equal `asOfDate`) | ✅ |
| Idempotent re-runs — identical day entry | ✅ |
| `IvRankLatestRepository.delete` removes the doc (disable-cleanup seam for #188) | ✅ |
| Skip paths — malformed date, missing entry, missing `iv30` | ✅ |
| Full suite regression | ✅ 786/786; tsc clean |

## Verdict

**PASS** — ship-eligible.
