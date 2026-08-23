**Topic:** Implement AV earnings-related endpoints (3)
**Issue:** #36 (SHARED Blueprint)
**Topic Parent:** #33
**Domain:** EARNINGS
**Type:** Code Review
**Status:** Approved
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

# Code Review: Task #38 — SavantApiEndpoint enum + TypeScript response types

## Summary

Three review axes were run: Standards, Spec, and Thermo-nuclear. All 7 acceptance criteria are MET. The test suite passes (43 tests, 7 suites, no regressions). One MAJOR finding was identified and fixed during review. Remaining findings are MINOR or NIT.

## Findings by severity

### Critical (0)

None.

### Major (1 — FIXED)

**MAJOR-1: Default export in barrel file missing new modules**
- **Files:** `shared/alpha-vantage/index.ts` (lines 20-45)
- **Axes:** Standards, Thermo-nuclear
- **Issue:** The barrel file's default export object spread 10 existing modules but omitted the 4 new modules (`av-earnings-types`, `av-earnings-estimates-types`, `av-earnings-calendar-types`, `savant-api-endpoints`). The named exports were correct, but the default export was inconsistent.
- **Fix:** Added imports and spread entries for all 4 new modules in the default export object. Also noted that `av-time-series.types` and `av-bulk-import.types` were already missing from the default export before this task — left as-is (pre-existing, out of scope).
- **Status:** FIXED. Rebuilt shared package, re-ran tests — all 43 pass.

### Minor (5 — deferred)

**MINOR-1: Missing negative type tests for AvReportTime**
- **File:** `functions/tests/v2/alpha-vantage/av-earnings-types.test.ts`
- **Issue:** No `@ts-expect-error` test verifying invalid `reportTime` values are rejected at compile time.
- **Status:** Deferred — TypeScript's union type enforcement is compile-time intrinsic. Adding `@ts-expect-error` tests is a nice-to-have but not blocking.

**MINOR-2: Missing negative type tests for AvEstimateHorizon**
- **File:** `functions/tests/v2/alpha-vantage/av-earnings-estimates-types.test.ts`
- **Issue:** No `@ts-expect-error` test verifying invalid `horizon` values are rejected.
- **Status:** Deferred — same reasoning as MINOR-1.

**MINOR-3: Missing tests for required field validation**
- **Files:** All three type test files
- **Issue:** No `@ts-expect-error` tests verifying that omitting required fields is a type error.
- **Status:** Deferred — TypeScript enforces required fields at compile time. These tests would document the constraint but don't add runtime protection.

**MINOR-4: Verification script lacks negative cases**
- **File:** `functions/scripts/verify/earnings-38-sa-endpoint-types.ts`
- **Issue:** Script only tests positive cases (valid shapes compile and runtime values match).
- **Status:** Deferred — the script is intentionally positive-only. Negative type testing is the unit test suite's job (via `@ts-expect-error`), not the verification script's.

**MINOR-5: CSV empty string handling scope unclear**
- **File:** `shared/alpha-vantage/av-earnings-calendar-types.ts`
- **Issue:** Comment didn't explain why only `estimate` and `timeOfTheDay` can be empty.
- **Status:** FIXED — comment updated to clarify that these fields are empty when AV has no data, while other fields are always populated.

### Nit (3 — 2 FIXED, 1 deferred)

**NIT-1: Misleading usage comment in verification script**
- **File:** `functions/scripts/verify/earnings-38-sa-endpoint-types.ts` (line 8)
- **Issue:** Comment said `npx ts-node scripts/verify/...` but actual command requires `-r tsconfig-paths/register -P scripts/tsconfig.json` flags.
- **Status:** FIXED — comment updated to match the documented command.

**NIT-2: Test description could be more specific**
- **File:** `functions/tests/v2/alpha-vantage/savant-api-endpoints.test.ts` (line 15)
- **Issue:** `it('has exactly 4 values', ...)` → `it('has exactly 4 enum members', ...)`.
- **Status:** FIXED.

**NIT-3: File naming inconsistency**
- **File:** `shared/alpha-vantage/savant-api-endpoints.ts`
- **Issue:** Type files follow `av-{endpoint}-types.ts` pattern, but this file is `savant-api-endpoints.ts`.
- **Status:** Deferred — the file contains the Savant API endpoint enum (consumer-facing identity layer), not an AV response type. The `savant-` prefix distinguishes it from `av-` prefixed AV response types. This is an intentional naming choice, not an oversight.

## Test results

- **Full test suite:** 43 tests, 7 suites — all pass
- **Task #38 tests:** 19 tests, 4 suites — all pass
- **Verification script:** `earnings-38-sa-endpoint-types.ts` — all 17 checks pass
- **No regressions** in existing tests

## Verdict: PASS

All acceptance criteria are MET. The one MAJOR finding (barrel default export) has been fixed. No critical findings. Remaining findings are MINOR/NIT and deferred with documented reasoning. Tests pass. Verification script passes.
