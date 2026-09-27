**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #175  
**Task:** #169  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# UAT — Task #169: IV30 metric computer + registry

## User-reviewable surface

**The verify-script output is the human-judgment check.** Running
`options-data-169-iv30-computer.ts` prints `entry: {iv30, iv30Method, iv30Contracts}`
for a real symbol/date — a reviewer can sanity-check whether the IV is
plausible (QQQ Jan-2024 ≈ 16% — a calm post-2023 period). Try other symbols
or dates where corpus objects exist (pivot dates from the swing docs). Unit
suite output is secondary evidence.

## Scope

Pure computation: IV30 (constant-maturity ATM IV at 30d) from a corpus chain
snapshot + the split-adjusted close; `MetricComputer` contract + `METRIC_REGISTRY`
orchestration. ACs from Task #169:

- AC1 — correct IV30: OTM-side bracketing, total-variance interp, nearest fallback
- AC2 — registry merges entries, null when all computers decline
- AC3 — verify script passes on real prod chain

## Prerequisites

- `cd functions`; Application Default Credentials; `$env:OPTIONS_CORPUS_BUCKET="av-hist-options-corpus-bucket"`.

## Scenarios

### 1. Unit suite — recipe correctness

- `cd functions; npx jest tests/v2/symbol-metrics/`
- Expected: 22 computer + 3 registry tests green — interpolation golden value
  (0.4134), nearest fallbacks both directions, OTM-side selection, bounds
  rejection, NaN/expired/malformed exclusion, exact-tenor, close==strike
  averaging, null-on-empty, determinism.
- **Result:** PASS — 25/25.

### 2. Real prod chain — plausibility

- `$env:OPTIONS_CORPUS_BUCKET="av-hist-options-corpus-bucket"`
- `npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-169-iv30-computer.ts QQQ 2024-01-05`
- Expected: `entry: {"iv30":0.161...,"iv30Method":"interpolated","iv30Contracts":498}` — plausible for QQQ early-Jan-2024.
- **Result:** PASS — `iv30=0.1612`, `interpolated`, 498 contracts.

### 3. Registry orchestration

- Covered by `registry.test.ts`: fields ⊆ `SYMBOL_METRIC_FIELDS`; merge into one
  entry; null when all decline.
- **Result:** PASS.

### 4. Full regression

- `cd functions; npx jest` → all suites green; `npx tsc --noEmit` clean.
- **Result:** PASS — 74 suites / 704 tests.

## Negative / boundary

- Covered in unit tests: empty chain, null close, all-expired, all-malformed
  IVs, whitespace strike, one-sided brackets, exact-tenor label. No
  user-facing error paths exist (pure function).

## Traceability

| AC | Scenario |
|---|---|
| AC1 (recipe correctness) | 1, 2 |
| AC2 (registry orchestration) | 1, 3 |
| AC3 (real prod verify) | 2 |

## Regression/smoke checklist

- [x] Full jest suite green (704)
- [x] `tsc --noEmit` clean
- [x] Verify script still registered; run-all registration unchanged (it's
      excluded — needs ADC + bucket; documented in README row)
