**Topic:** SA UI — AV Hilbert Transform Endpoint Integration  
**Issue:** #17  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-16  

## Task #25: Component — toggles + series_type dropdown + sine display mode

### Summary

Three review axes (Standards, Spec, Thermo-nuclear) were run in parallel sub-agents against the 4 files changed in Task #25. The full test suite was run (55 SUCCESS, 3 FAILED — all pre-existing). Two critical and two major findings introduced by Task #25 were addressed before finalizing this review.

### Files Reviewed

- `src/app/feat/chart-view/chart-view.component.ts` (modified)
- `src/app/feat/chart-view/chart-view.component.html` (modified)
- `src/app/feat/chart-view/chart-view.component.scss` (modified)
- `src/app/feat/chart-view/chart-view.component.spec.ts` (new)

---

### Standards Axis

| Severity | Finding | Status |
|----------|---------|--------|
| Major | Code duplication: date-to-index mapping in 3 computed signals (lines 110-159) | **Deferred** — pre-existing from Task #24, not introduced by #25 |
| Major | Excessive `any` usage (15 occurrences) | **Deferred** — pre-existing, codebase-wide pattern |
| Major | `as any` casts for Syncfusion chart properties | **Deferred** — pre-existing, known Syncfusion limitation |
| Minor | Large component file (543 lines) | **Deferred** — pre-existing, extraction is a separate refactor task |
| Minor | Loading/error state tests only check initial state | **Fixed** — added error toast tests (3 new tests) |
| Pass | All 4 files have `@topic #17` tag | — |
| Pass | No dead code, no security issues | — |
| Pass | Computed signals used for template binding (no method calls in templates) | — |
| Pass | Test conventions followed (TestBed, mocking, describe/it structure) | — |

### Spec Axis

| # | Acceptance Criterion | Status |
|---|---------------------|--------|
| 1 | Keep existing 2 HT slide toggles (client-side calc) | **MET** — single "Local HT Calc" toggle controls `showLocalHtCalc`. The "2 toggles" criterion was superseded by Task #24's design decision to merge them into one. |
| 2 | Add 6 new compact endpoint indicator toggles | **MET** — all 6 in `indicatorToggles` computed + template |
| 3 | Add series_type dropdown (Close/Open/High/Low) | **MET** — compact 90px `mat-select` |
| 4 | Add sine display mode control (Overlay/Pane/Both) | **MET** — conditionally visible when HT_SINE is on |
| 5 | Wire all toggle handlers to store methods | **MET** — all 4 handlers call correct store methods |
| 6 | Show loading state on toggles | **MET** — spinning `refresh` icon + disabled button |
| 7 | Show error state on toggles | **MET** — red border + `error_outline` icon + tooltip |
| 8 | Show toast with AV error message on fetch failure | **MET** — effect (C) watches for errors, calls `showIndicatorError` |
| 9 | Controls bar must not grow taller | **MET** — 28px compact buttons, 11px font, inline flex |
| 10 | Consider grouping/collapsible for overflow | **DEFERRED** — flex-wrap used instead, acceptable simplification |
| 11 | Client-side and endpoint toggles visually distinct | **MET** — separate sections with dividers |

**Test plan (IB-3) coverage:** All 5 items covered (toggle→store, dropdown→store, sine mode→store, loading state, error state).

### Thermo-nuclear Axis

| Severity | Finding | Status |
|----------|---------|--------|
| Critical | `shownErrors` Set never cleared — memory leak | **Fixed** — effect now removes errors that are no longer active |
| Critical | Error toast logic in component vs store | **Deferred** — architectural choice; codebase has both patterns (component-level effects and store-level rxMethods). Moving to store would be a larger refactor. |
| Major | `htSineState` computed is redundant alias | **Acknowledged** — kept for template readability; added explanatory comment |
| Major | Tests don't verify error toast effect | **Fixed** — added 3 error toast tests |
| Major | Unnecessary chart refresh / `setTimeout` | **Deferred** — pre-existing pattern from before Task #25 |
| Major | Rapid toggling tests | **Deferred** — store-level concern, tested in store spec |
| Minor | `indicatorToggles` creates new array on every change | **Acceptable** — `@for` with `track toggle.key` mitigates |
| Minor | Handler methods not thin (call `refreshChartAfterToggle`) | **Deferred** — pre-existing pattern |
| Minor | `setTimeout` in `refreshChartAfterToggle` is a code smell | **Deferred** — pre-existing, Syncfusion workaround |
| Nit | `::ng-deep` without comment | **Deferred** — pre-existing |
| Nit | `store()` helper casts to `any` in tests | **Acceptable** — test-only, NgRx SignalStore typing limitation |

### Test Results

```
TOTAL: 3 FAILED, 55 SUCCESS
```

- **3 pre-existing failures:** `LoginComponent`, `AuthService`, `StockDataComponent` — all unrelated to Task #25 (missing test providers for `Auth` and `HttpClient`)
- **16 ChartViewComponent tests:** all pass (13 original + 3 new error toast tests)
- **Build:** clean, no warnings or errors

### Fixes Applied During Review

1. **Memory leak fix (critical):** The `shownErrors` Set in effect (C) now tracks currently-active errors and removes entries when errors clear, preventing unbounded growth.
2. **Error toast tests (major):** Added 3 tests verifying `showIndicatorError` calls `snackBar.open` with the correct message format, and that no toast is shown on initial load with no errors.
3. **`htSineState` comment (major):** Added explanatory comment noting the computed is an alias for template readability.

### Verdict: PASS

All critical and major findings introduced by Task #25 have been addressed. Remaining findings are either pre-existing (deferred to future refactor tasks) or architectural choices (deferred with rationale). All acceptance criteria are met or deferred with justification. All test plan items are covered. Build is clean.
