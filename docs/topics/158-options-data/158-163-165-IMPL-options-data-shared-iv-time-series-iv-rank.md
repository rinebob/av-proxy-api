**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #165  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** IMPL (SHARED)  
**Status:** Approved  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# IMPL (SHARED) — IV rank field contract

## Scope

Extend `shared/options/symbol-metrics.types.ts`; add `iv-rank-latest` contract.
No new files unless the types file grows — keep in place.

## Changes

```ts
// symbol-metrics.types.ts

/** IV-rank window lengths in calendar days. */
export const IV_RANK_WINDOWS = [30, 60, 180, 360] as const;
export type IvRankWindow = (typeof IV_RANK_WINDOWS)[number];

// Extend SYMBOL_METRIC_FIELDS — rank fields flow through partnerIvMetricsV2
// metrics= for free (append-only contract):
export const SYMBOL_METRIC_FIELDS = [
  'iv30', 'iv30Method', 'iv30Contracts',
  'ivRank30','ivRank60','ivRank180','ivRank360',
  'ivPct30','ivPct60','ivPct180','ivPct360',
  'ivN30','ivN60','ivN180','ivN360',   // sample count per window
] as const;

// SymbolMetricDayEntry gains optional ivRank{W}?: number, ivPct{W}?: number,
// ivN{W}?: number — all optional; a day entry may carry iv30 only until the
// rank pass runs.

/** Flat top-level collection for the sortable cross-symbol table. */
export const IV_RANK_LATEST_COLLECTION = 'iv-rank-latest';

/** `iv-rank-latest/{SYMBOL}` — newest known rank per window; rewritten on
 *  every rank pass for the symbol's latest date; deleted on optionsEnabled
 *  false-transition. */
export interface IvRankLatestDoc {
  symbol: string;
  asOfDate: string;            // the day entry these values came from
  ivRank30?: number; /* …all windows… */ ivPct360?: number;
  ivN30?: number;    /* …all windows… */ ivN360?: number;
  updatedAt: TimestampLike;
}
```

## Task

- Task: rank fields + `iv-rank-latest` contract (S1)
