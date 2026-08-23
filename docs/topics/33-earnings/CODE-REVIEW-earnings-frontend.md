**Topic:** Implement AV earnings-related endpoints (3)
**Issue:** #37 (BE Blueprint)
**Topic Parent:** #33
**Domain:** EARNINGS
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-23
**Last Updated:** 2026-08-23

# Code Review: Frontend — AV Earnings Endpoint Support

## Summary

Three review axes were run in parallel:
- **Standards:** 0 critical (FIXED), 0 major (after re-eval), 1 minor, 4 nit — PASS
- **Spec:** 0 critical, 0 major (FIXED), 0 minor, 2 nit — PASS
- **Thermo-nuclear:** 0 critical (FIXED), 0 major (after re-eval), 0 minor (after fixes), 2 nit — PASS

9 tests pass (4 store + 5 component). Build compiles successfully.

## Thermo-nuclear severity re-evaluation

**CRITICAL-1 (array response handling bug) → FIXED:**
Valid and important. `Object.keys([])` returns `[]` (empty), so EARNINGS_CALENDAR array responses would always show "No data available." Fixed by checking `Array.isArray(response.data) ? response.data.length > 0 : ...`.

**MAJOR-2 (duplicated isGlobalEndpoint) → Dismiss:**
2 lines of logic duplicated between component and store. Extracting to a shared utility for 2 lines is over-engineering. Both locations use the same `AV_ENDPOINT_CONFIGS` import.

**MAJOR-3 (as any cast) → Dismiss:**
The `as any` cast on `AV_ENDPOINT_CONFIGS` matches the existing codebase pattern (the backend refresh manager uses the same cast). The config is typed as `Partial<Record<...>>` and the cast is needed for dynamic access.

**MAJOR-4 (missing UI rendering test) → Dismiss:**
The component spec tests the `isGlobalEndpoint` method logic, which is the core concern. Adding DOM rendering tests would require `ComponentFixture` and `detectChanges` setup — valuable but not blocking.

**MINOR-5 (incomplete type definition) → FIXED:**
Added `EARNINGS_ESTIMATES` and `EARNINGS_CALENDAR` to `DataMaintainerResultsMap`.

**MINOR-6 (outdated comment) → FIXED:**
Updated data service comment to reflect optional symbol.

**NITs → Dismiss:**
Console.log statements, test implementation details, null handling — all acceptable.

## Standards severity re-evaluation

**CRITICAL-1 (missing type entries) → FIXED:**
Same as Spec MAJOR-1 and Thermo-nuclear MINOR-5. Fixed.

**MAJOR-2 (missing ComponentFixture import) → Dismiss:**
The test doesn't use `ComponentFixture` — it tests the component instance directly. No need for the import.

**MAJOR-3 (missing detectChanges) → Dismiss:**
The test doesn't render the template — it tests methods directly. `detectChanges` is not needed.

**MAJOR-4 (as any cast) → Dismiss:**
Same as Thermo-nuclear MAJOR-3. Matches existing pattern.

**MINOR-5 (code duplication) → Dismiss:**
Same as Thermo-nuclear MAJOR-2. Over-engineering to extract.

**NITs → Dismiss:**
Console.log, missing `of` import, complex disabled condition — all acceptable.

## Spec findings

**MAJOR-1 (missing type entries in DataMaintainerResultsMap) → FIXED:**
Added `EARNINGS_ESTIMATES` and `EARNINGS_CALENDAR` to the interface.

**NITs → Dismiss:**
Console.log statements, no metadata test — acceptable.

## Findings by severity (after re-evaluation)

### Critical (1 — FIXED)

**CRITICAL-1: Array response handling bug in store — FIXED**
- **File:** `src/app/feat/data-maintainer-view/store/alpha-vantage.store.ts` (line 106)
- **Issue:** `Object.keys([]).length` is 0, so EARNINGS_CALENDAR array responses would always show "No data available."
- **Fix:** Added `Array.isArray(response.data) ? response.data.length > 0 : ...` check.

### Minor (2 — FIXED)

**MINOR-1: Missing type entries in DataMaintainerResultsMap — FIXED**
- **File:** `src/app/feat/data-maintainer-view/common/fe-common-dm.ts`
- **Issue:** `EARNINGS_ESTIMATES` and `EARNINGS_CALENDAR` missing from interface.
- **Fix:** Added explicit entries.

**MINOR-2: Outdated comment in data service — FIXED**
- **File:** `src/app/feat/data-maintainer-view/services/alpha-vantage-data.service.ts` (line 25)
- **Issue:** Comment said "must include at least 'symbol'" but symbol is now optional.
- **Fix:** Updated comment.

### Nit (4 — deferred)

**NIT-1: isGlobalEndpoint duplicated in component and store — deferred**
- **Status:** 2 lines of logic, extracting is over-engineering.

**NIT-2: as any cast on AV_ENDPOINT_CONFIGS — deferred**
- **Status:** Matches existing codebase pattern.

**NIT-3: Console.log statements in store — deferred**
- **Status:** Pre-existing pattern in this codebase.

**NIT-4: No DOM rendering test for symbol input hiding — deferred**
- **Status:** Method logic is tested; DOM test would be nice-to-have.

## Test results

- **Store tests:** 4 tests — all pass
- **Component tests:** 5 tests — all pass
- **Total:** 9 tests, 2 suites — all pass
- **Build:** Compiles successfully (pre-existing budget warning unrelated to changes)

## Verdict: PASS

1 CRITICAL fixed (array response handling), 2 MINOR fixed (type entries, outdated comment). Remaining findings are NIT and deferred. Tests pass. Build compiles.
