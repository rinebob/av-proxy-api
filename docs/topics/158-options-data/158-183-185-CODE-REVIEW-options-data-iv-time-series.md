**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #185  
**Task:** #185  
**Blueprint Parent:** #183  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# Code Review — Task #185: IV rank field contract

## Scope reviewed

- `shared/options/symbol-metrics.types.ts` (rank fields + `IvRankLatestDoc`)
- `functions/tests/shared/options/symbol-metrics.types.test.ts`
- `functions/scripts/verify/options-data-168-symbol-metric-types.ts` + `.md`

## Findings + resolutions

**Round 1**

- **[Blocking] Stale unit test** — `symbol-metrics.types.test.ts` asserted the
  old 3-field whitelist and used `Required<SymbolMetricDayEntry>` against a
  3-field fixture (compile break at 15 fields). Fixed: appended-order
  assertion + full 15-field fixture + `IV_RANK_WINDOWS`/`IvRankLatestDoc`
  checks.
- **[Doc drift] PRD §storage** used short names (`ivr{W}`/`ivp{W}`/`n*`) vs
  shipped `ivRank{W}`/`ivPct{W}`/`ivN{W}` — PRD reconciled to shipped names.

**Round 2**

- **[Doc] verify `.md`** still described the 3-field whitelist and "six PASS
  lines" — updated (9 checks now). UAT #174 left as point-in-time record.

## Verified clean

- Append-only: `iv30*` fields unchanged in name/order; rank fields strictly
  appended → `partnerIvMetricsV2` `metrics=` whitelist carries them free.
- Field names identical across `SYMBOL_METRIC_FIELDS`, `SymbolMetricDayEntry`,
  `IvRankLatestDoc`, IMPL doc, verify script.
- Registry/build service treat fields dynamically — no length assumptions.
- 761/761 tests green; shared package compiles; verify script 9/9 PASS.

## Verdict

**PASS** — task → QA.
