**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #261  
**Task:** #189  
**Blueprint Parent:** #184  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

# UAT — Task #189: partnerIvRankV2 screener endpoint

## Steps + results

| Check | Result |
|---|---|
| Handler seam — sort whitelist strict (unknown → 400), dir asc/desc, missing-sort-value sinks either direction | ✅ |
| `minN` maps to the sort field's `ivN{W}` window (`ivPct60`→`ivN60`); `ivN360` fallback when sort unset; non-integer/negative → 400 | ✅ |
| Auth parity with `partnerIvMetricsV2` — 405 method, 403 non-service-account, 500 audience-unconfigured ordering | ✅ |
| `updatedAt` serialized ISO-8601 on the wire (no `{_seconds}` leak); null-safe | ✅ |
| Empty table → `{ok:true, count:0, rows:[]}` | ✅ |
| Full suite regression | ✅ 1194/1194; tsc clean |
| `index.ts` export `partnerIvRankV2` | ✅ |

## Deploy prerequisites (for ship)

- `EXPECTED_GOOGLE_AUDIENCE` — append BOTH URL forms
  (`cloudfunctions.net/partnerIvRankV2` + run.app URL); new secret
  version requires a function redeploy to re-pin (per #225's recorded
  gotcha in the ops runbook)
- `partner-endpoint-inventory.md` row + partner docs at ship

## Verdict

**PASS** — ship-eligible.
