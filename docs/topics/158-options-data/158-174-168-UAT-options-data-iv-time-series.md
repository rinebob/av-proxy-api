**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #174  
**Task:** #168  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# UAT — Task #168: shared symbol-metrics contract types

## User-reviewable surface

**None beyond the commands below.** This task delivers compile-time contract types — there is no UI, endpoint, or data to inspect. User review would mean re-running the scenarios (all local, ~1 min). Not user-testable in the interactive sense; QA resolved on automated evidence.

## Scope

Contract layer for symbol-level IV metrics: `SymbolMetricDayEntry`, `SymbolMetricsYearDoc`, `IvMetricsRow`, `TimestampLike`, `SYMBOL_METRIC_FIELDS` whitelist, and `symbol-metrics/{SYM}/years/{YYYY}` path constants, exported from `@shared/options`. Acceptance criteria from Task #168:

- AC1 — types exported via `@shared` barrel; `build:shared` clean
- AC2 — `SYMBOL_METRIC_FIELDS` lists every emitted field (`iv30`, `iv30Method`, `iv30Contracts`)
- AC3 — `IvMetricsRow` matches the documented `partnerIvMetricsV2` row shape (date + open metric fields)

## Prerequisites

- Repo at `C:\aa\projects\av-proxy-api`; Node + npm installed.
- No credentials needed — all checks are local/read-only.

## Scenarios

### 1. Shared package compiles and syncs into functions

- **Start:** clean checkout state for `shared/`.
- **Steps:** `cd functions; npm run copy-shared`
- **Expected:** `tsc -p tsconfig.json` (shared build) exits 0; `functions/lib/shared/options/symbol-metrics.types.{js,d.ts}` exist afterward.
- **Evidence:** command output.
- **Result:** PASS — build clean, artifacts copied.

### 2. Unit suite green

- **Steps:** `cd functions; npx jest tests/shared/options/symbol-metrics.types.test.ts`
- **Expected:** 6 tests pass — field whitelist contents, whitelist↔entry correspondence, path constants, JSON round-trip, sparse-entry semantics, wire row shape.
- **Result:** PASS — 6/6.

### 3. Verification script exercises the compiled contract

- **Steps:** `cd functions; npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-168-symbol-metric-types.ts`
- **Expected:** six `PASS` lines + `=== All verification checks passed ===`, exit 0.
- **Result:** PASS — all six checks.

### 4. Regression — full jest suite unaffected

- **Steps:** `cd functions; npx jest`
- **Expected:** entire suite green (new shared exports are additive).
- **Result:** PASS — 72 suites / 681 tests.

### 5. run-all registration

- **Steps:** open `functions/scripts/verify/run-all.ts`; confirm `'options-data-168-symbol-metric-types.ts'` is in the scripts array; README.md verify table has a #168 row without a "not in run-all" annotation.
- **Result:** PASS — registered after `options-data-123-swing-set-types.ts`; README row present.

## Negative / boundary

- Sparse-entry semantics covered by unit test: absent fields stay absent (no null coercion) — AC-level, verified in scenario 2.
- No error paths exist (pure types/constants) — nothing else applicable.

## Traceability

| AC | Scenario |
|---|---|
| AC1 (barrel export, clean build) | 1 |
| AC2 (whitelist = emitted fields) | 2, 3 |
| AC3 (IvMetricsRow wire shape) | 2, 3 |

## Regression/smoke checklist

- [x] Full jest suite green (scenario 4)
- [x] `run-all.ts` includes the new script (scenario 5)
- [x] No existing `@shared/options` exports collide (verified during code review — thermo-nuclear axis traced all consumers)
