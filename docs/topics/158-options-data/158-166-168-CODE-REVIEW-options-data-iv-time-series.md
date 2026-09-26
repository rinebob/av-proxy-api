**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #166  
**Task:** #168  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Code Review — Task #168: shared symbol-metrics contract types

## Scope

- `shared/options/symbol-metrics.types.ts` (new) — contract types + constants
- `shared/options/index.ts` — barrel export
- `functions/tests/shared/options/symbol-metrics.types.test.ts` (new)
- `functions/scripts/verify/options-data-168-symbol-metric-types.ts` + `.md` + README row + run-all registration

## Standards

No hard violations. One judgement-call finding: verify script was initially excluded from `run-all.ts` while its direct peer (#123, same stage, no credentials) is included — **fixed**: registered in `run-all.ts` and README annotation removed.

## Spec

- `IvMetricsRow` lacked the documented open wire shape (`[k: string]: unknown` in IMPL) — **fixed**: index signature restored on top of `SymbolMetricDayEntry`.
- `updatedAt` diverged from the documented required field — **fixed**: required, concretely typed.
- Whitelist↔entry correspondence was only exercised in the verify script — **fixed**: `Required<SymbolMetricDayEntry>` keys ⊆ `SYMBOL_METRIC_FIELDS` now asserted in the unit test.

## Thermo-nuclear

- **Major (fixed):** `updatedAt?: unknown` was a boundary cop-out — introduced `TimestampLike` (`{seconds, nanoseconds}`, matching `SwingSetDoc.generatedAt`) and made the field required.
- **Minor (accepted):** endpoint-name note — `getSymbolMetricsV2` already exists as an unrelated internal function; `partnerIvMetricsV2` is deliberately distinct. No change.
- **Nits (fixed):** `days` map key format documented in JSDoc; timestamp fixture aligned to `TimestampLike`.
- **Deferred:** response-envelope type arrives with Task #172 (endpoint) — by design.

## Test results

- `npx jest tests/shared/options/symbol-metrics.types.test.ts` — 6/6 green.
- Full suite: 72 suites / 681 tests green.
- Verify script `options-data-168-symbol-metric-types.ts` — all checks pass.

## Verdict

**PASS** — all findings fixed or documented as accepted/deferred.
