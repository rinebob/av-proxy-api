**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #162  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Area:** SHARED  
**Type:** Test Plan  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Test Plan â€” SHARED: symbol-metrics contract types

## Compile-time

- `npm run build:shared` clean; types importable from `functions` via `@shared` barrel.
- `SYMBOL_METRIC_FIELDS` includes `iv30`, `iv30Method`, `iv30Contracts`.

## Behavior

- Field registry round-trip: every field a computer emits is in the whitelist (cross-check against `MetricComputer.fields` â€” a shared-side constant consumed by the BE registry).
- Wire shape: `IvMetricsRow` serializes a `days` map slice without transform loss.

## Seams

- The BE endpoint test-suite asserts the response conforms to the shared types â€” single seam at the partner response envelope.
