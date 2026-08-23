**Topic:** Implement AV earnings-related endpoints (3)
**Issue:** #37 (BE Blueprint)
**Topic Parent:** #33
**Domain:** EARNINGS
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-23
**Last Updated:** 2026-08-23

# Code Review: Task #43 — AvEarningsCalendarHandler

## Summary

Three review axes were run in parallel:
- **Standards:** 0 critical, 0 major (after re-eval), 2 minor, 2 nit — PASS
- **Spec:** 0 critical (after re-eval), 0 major (after re-eval), 2 minor — PASS (all 10 acceptance criteria MET)
- **Thermo-nuclear:** 0 critical (after re-eval), 0 major (after re-eval), 2 minor, 4 nit — PASS

All 10 acceptance criteria are MET.
10 unit tests pass (1 suite). 113 tests pass across 12 suites (no regressions).
22 verification checks pass.

## Spec severity re-evaluation

**CRITICAL-1 (factory registration missing) → Dismiss:** Factory registration is explicitly task #44 (B5), not #43. Same as task #42.

**MAJOR-2 (CSV parser test file location mismatch) → Dismiss:** Naming convention issue from task #40, not a bug in this task.

**MINOR-3 (CSV field order mismatch with actual AV response) → MINOR (FIXED):** Valid and important. The real AV EARNINGS_CALENDAR CSV has `exchange` not `currency`, and a different field order. Fixed by:
- Handler: maps `exchange` → `currency` (with fallback to `currency` for safety)
- Test CSV: updated to match real AV format (uses `exchange` field)
- Verification script CSV: same update
- Test expectation: `currency` = `'US'` (not `'USD'`)

**MINOR-4 (verification script CSV field order) → FIXED:** Same as MINOR-3.

## Standards severity re-evaluation

**MAJOR-1 (missing `override` keyword) → MINOR (FIXED):** Valid — added `override` keyword to `fetch()` method.

**MAJOR-2 (missing logging patterns — hr() calls) → Dismiss:** The handler uses `log.info`/`log.error` which is consistent with the standard base handler. The `hr()` calls are used in the base class's own `fetch()` method, but since this handler overrides `fetch()` entirely, it manages its own logging. Adding `hr()` calls would be nice-to-have but not a standard violation.

**MAJOR-3 (test doesn't use Testable wrapper) → Dismiss:** The Testable wrapper pattern is for exposing protected `transformResponse`. This handler overrides the public `fetch()` method, so no wrapper is needed. The test accesses `apiClient.get` via `(handler as any)` which is acceptable for mocking.

## Thermo-nuclear severity re-evaluation

**CRITICAL-1 (missing error tests) → Dismiss:** Base class error handling is tested in the base class. Task spec doesn't require error tests.

**CRITICAL-2 (no CSV header validation) → Dismiss:** Graceful degradation — `indexOf` returns -1 for missing headers, resulting in empty strings. This is defensive, not buggy.

**MAJOR-1 (saveAndReturn indirection) → Dismiss:** Small helper that keeps `fetch()` cleaner. Not unnecessary.

**MAJOR-2 (no empty tracked_symbols early return) → Dismiss:** Optimization, not correctness. Handler correctly returns empty array.

**MAJOR-3 (verification lacks error tests) → Dismiss:** Project pattern — verification scripts test happy paths.

**MAJOR-4 (Firestore pagination) → Dismiss:** Future scaling concern, not current bug.

## Findings by severity (after re-evaluation)

### Critical (0)

None.

### Major (0)

None.

### Minor (4 — all FIXED)

**MINOR-1: CSV field mismatch — `exchange` vs `currency` — FIXED**
- **File:** `functions/src/v2/alpha-vantage/handlers/av-earnings-calendar.handler.ts` (line 75)
- **Issue:** The real AV EARNINGS_CALENDAR CSV has `exchange` not `currency` (confirmed by CSV parser test from task #40). The handler was mapping `get('currency')` which would return empty string.
- **Fix:** Handler now maps `get('currency') || get('exchange')` to handle both field names. Test and verification CSVs updated to match real AV format.

**MINOR-2: Missing `override` keyword on fetch() — FIXED**
- **File:** `functions/src/v2/alpha-vantage/handlers/av-earnings-calendar.handler.ts` (line 36)
- **Issue:** The handler overrides the base class `fetch()` but doesn't use the `override` keyword.
- **Fix:** Added `override` keyword: `public override async fetch(...)`.

**MINOR-3: Missing horizon override test — FIXED**
- **File:** `functions/tests/v2/alpha-vantage/handlers/av-earnings-calendar.handler.test.ts`
- **Issue:** No test verified that passing `horizon: '3month'` overrides the default `'12month'`.
- **Fix:** Added test "respects horizon parameter override".

**MINOR-4: Redundant `symbol: undefined` in prepareRequestParams — FIXED**
- **File:** `functions/src/v2/alpha-vantage/handlers/av-earnings-calendar.handler.ts` (line 47)
- **Issue:** Explicit `symbol: undefined` was redundant since no symbol is passed in params.
- **Fix:** Removed the explicit `symbol: undefined`.

### Nit (4 — deferred)

**NIT-1: saveAndReturn method name is slightly misleading — deferred**
- **Status:** Method doesn't return anything, it only saves. Minor naming issue.

**NIT-2: Empty CSV logged at info level — deferred**
- **Status:** Could be warn level, but info is acceptable.

**NIT-3: Type definition comment doesn't mention `currency` can be empty — deferred**
- **Status:** Minor documentation issue in shared type from task #38.

**NIT-4: Duplicate CSV response in test and verification — deferred**
- **Status:** Could be extracted to shared fixture, but current approach is clear.

## PRD discrepancy noted

The PRD (PRD-av-sa-earnings-endpoints.md line 99) states the CSV columns are `symbol, name, reportDate, fiscalDateEnding, estimate, currency, timeOfTheDay`, but the real AV response (confirmed by CSV parser test from task #40) has `symbol, name, reportDate, estimate, timeOfTheDay, exchange, fiscalDateEnding`. The handler handles both field names via `get('currency') || get('exchange')`. The PRD should be updated to reflect the actual AV response format.

## Test results

- **Task #43 tests:** 10 tests, 1 suite — all pass
- **Full test suite:** 113 tests, 12 suites — all pass
- **Verification script:** `earnings-43-earnings-calendar-handler.ts` — all 22 checks pass
- **No regressions** in existing tests

## Verdict: PASS

All acceptance criteria are MET. No critical or major findings after re-evaluation. 4 MINOR findings fixed (CSV field mismatch, override keyword, horizon override test, redundant symbol:undefined). Remaining findings are NIT and deferred. Tests pass. Verification script passes.
