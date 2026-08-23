**Topic:** Implement AV earnings-related endpoints (3)
**Issue:** #36 (SHARED Blueprint)
**Topic Parent:** #33
**Domain:** EARNINGS
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

# Code Review: Task #39 — Config changes for earnings endpoints

## Summary

Three review axes were run:
- Standards
- Spec
- Thermo-nuclear

All 6 acceptance criteria are MET.
The test suite passes (59 tests, 8 suites, no regressions).
Two MAJOR findings were identified and fixed during review.
One design issue was caught and corrected during user review.
Remaining findings are NIT.

## Findings by severity

### Critical (0)

None.

### Major (2 — FIXED)

**MAJOR-1: EARNINGS_CALENDAR horizon parameter lacks enum validation**
- **File:** `shared/alpha-vantage/av-endpoint-configs.ts` (lines 267-272)
- **Axes:** Standards, Thermo-nuclear
- **Issue:** The horizon parameter had no `enum` constraint to restrict values to valid AV options ('3month', '6month', '12month').
- **Fix:** Added `enum: ['3month', '6month', '12month']` to the horizon parameter definition.
- Updated test to assert enum values.
- Updated verification script to check enum constraint.
- **Status:** FIXED.

**MAJOR-2: EARNINGS_CALENDAR symbolUsage was NOT_SUPPORTED — config lying about AV's API contract**
- **File:** `shared/alpha-vantage/av-endpoint-configs.ts` (lines 254-274)
- **Axes:** User review
- **Issue:** Initial implementation set `symbolUsage: NOT_SUPPORTED` and removed the symbol parameter entirely. This was loose — AV's EARNINGS_CALENDAR API does support an optional symbol parameter. `NOT_SUPPORTED` was being used to mean "we choose not to use it" rather than "the endpoint doesn't accept it." The config should describe AV's API contract truthfully; the "fetch globally, filter to tracked symbols" decision belongs in the handler (task #43) and refresh manager (task #44).
- **Fix:** Reverted `symbolUsage` to `OPTIONAL`.
- Restored `symbol` parameter with `required: false`.
- Kept global `firestorePath` (`market-data/av-earnings-calendar`, no `{symbol}`) — this is our storage decision.
- Added comment noting the refresh manager (task #44) must detect the absence of `{symbol}` in the path and fetch once globally rather than once per tracked symbol.
- **Status:** FIXED. Config now truthfully describes AV's API contract. The global-fetch behavior is deferred to task #44.

### Minor (0)

None.

### Nit (2 — deferred)

**NIT-1: Type assertion could use EndpointParameter type (test)**
- **File:** `functions/tests/v2/alpha-vantage/av-earnings-config.test.ts` (line 69)
- **Status:** Deferred — inline type assertion is sufficient for the test's needs.

**NIT-2: Type assertion could use EndpointParameter type (verification script)**
- **File:** `functions/scripts/verify/earnings-39-config-changes.ts` (line 72)
- **Status:** Deferred — same reasoning.

## Test results

- **Full test suite:** 59 tests, 8 suites — all pass
- **Task #39 tests:** 17 tests, 1 suite — all pass
- **Verification script:** `earnings-39-config-changes.ts` — all 21 checks pass
- **No regressions** in existing tests

## Verdict: PASS

All acceptance criteria are MET.
Two MAJOR findings fixed (enum validation, symbolUsage truthfulness).
Remaining findings are NIT and deferred.
Tests pass.
Verification script passes.

## Note for task #44

The refresh manager must detect that EARNINGS_CALENDAR's `firestorePath` has no `{symbol}` placeholder and fetch the global doc once, not once per tracked symbol. The config's `symbolUsage: OPTIONAL` truthfully describes AV's API — the global-fetch behavior is a refresh manager concern, not a config concern.
