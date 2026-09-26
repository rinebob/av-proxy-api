**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #162  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Area:** SHARED  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Implementation Plan — SHARED: symbol-metrics contract types

## Goal

Define the wire + storage contract for symbol-level IV metrics in `shared/` so `partnerIvMetricsV2` (BE) and ST consume identical shapes — matching the convention of `@shared/alpha-vantage` partner contracts.

## Approach

### 1. Types (new `shared/symbol-metrics/` or under `shared/alpha-vantage` — match existing partner-type placement)

```ts
export interface SymbolMetricDayEntry {
  iv30?: number;                          // constant-maturity ATM IV, decimal
  iv30Method?: 'interpolated' | 'nearest';
  iv30Contracts?: number;                 // contracts used (quality signal)
  // reserved: iv60, iv90, mfiv30, ivRank{W}, ivPct{W}, …
}

export interface SymbolMetricsYearDoc {    // symbol-metrics/{SYM}/years/{YYYY}
  symbol: string;
  year: number;
  days: Record<string, SymbolMetricDayEntry>;
  updatedAt: unknown;                      // Firestore Timestamp
}

export interface IvMetricsRow { date: string; [k: string]: unknown }
// GET /partnerIvMetricsV2?symbol=&from=&to=&metrics=
// → { ok: true, symbol, source: 'sa', data: IvMetricsRow[], processingTimeMs }
// errors: 404 untracked | OPTIONS_NOT_ENABLED | same auth failures as partner*V2
```

### 2. Field-name registry

`SYMBOL_METRIC_FIELDS` constant — the `metrics=` whitelist for the endpoint. New metrics append fields; the endpoint never hardcodes.

## Acceptance criteria

- [ ] Types compile into `functions` via `@shared` barrel; `npm run build:shared` clean.
- [ ] `SYMBOL_METRIC_FIELDS` drives the endpoint whitelist.
