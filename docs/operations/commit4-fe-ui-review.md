# Code Review: Commit 4 — FE-FEAT-STORAGE-VIEWER

**Review date:** 2026-07-24
**Commit message:** `FE-FEAT-STORAGE-VIEWER: add Angular storage file viewer UI`
**Design doc ref:** `docs/operations/storage-file-viewer-design.md` Phase 2

---

## Files in commit

| File | Status | Summary |
|---|---|---|
| `src/app/feat/storage-file-viewer/common/index.ts` | New | Barrel export |
| `src/app/feat/storage-file-viewer/common/storage-viewer-api.ts` | New | API service wrapping `storageFileViewer` callable |
| `src/app/feat/storage-file-viewer/comps/index.ts` | New | Barrel export |
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.html` | New | Template — three-pane layout |
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.scss` | New | Styles — flexbox, light/dark mode |
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.ts` | New | Component — symbol input, dropdowns, list/read |
| `src/app/feat/storage-file-viewer/index.ts` | New | Feature barrel export |
| `src/app/feat/storage-file-viewer/store/index.ts` | New | Barrel export |
| `src/app/feat/storage-file-viewer/store/storage-viewer.store.ts` | New | NgRx Signal Store — state, cross-filter, list/read |
| `src/app/app.routes.ts` | Modified | Added `/storage-viewer` route |
| `src/app/core/config/nav-menu-items.ts` | Modified | Added Storage Viewer nav item |

---

## Standards

### Hard Violations

1. **Duplicated types and constants in store** — `storage-viewer.store.ts:21-23` duplicates `OPTIONS_FILE_INDEX_COLLECTION`, `TS_EXPIRATIONS_SUBCOLLECTION`, `TS_STRIKES_SUBCOLLECTION` from `options-index.writer.ts:7-13`. Lines 25-37 duplicate `ExpirationIndexDoc` and `StrikeIndexDoc`. These should be in `shared/options/contract-types.ts` and imported by both frontend and backend. (Same finding as Commit 2 Standards #2-3 — the shared extraction was incomplete.)

2. **Unused imports in component** — `storage-viewer.component.ts:3` imports `FormsModule` but the template doesn't use `[(ngModel)]` or any template-driven form directive. Only `ReactiveFormsModule` is needed for `FormControl`. `storage-viewer.component.ts:13` imports `MatToolbarModule` but the template contains no `<mat-toolbar>` element. Both are dead imports.

### Judgement Calls

3. **`MatSnackBar` in constructor effect** — `storage-viewer.component.ts:71-78` uses an `effect()` to show snackbar errors. This works but `effect` runs on every change detection cycle where the signal changes. If the same error is set twice (e.g., two failed loads), the effect won't re-fire because the value didn't change. Consider using `toObservable` + `distinctUntilChanged` for more robust error handling. Minor.

4. **Store file length** — 367 lines, under 500. ✓ But approaching the 400-line pre-check threshold. If more methods are added, consider splitting.

5. **SCSS uses `::ng-deep`** — `storage-viewer.component.scss:292` uses `::ng-deep .strike-autocomplete-panel`. This is deprecated in Angular but currently the only way to style overlay elements. Acceptable.

6. **Dark mode via `@media (prefers-color-scheme: dark)`** — `storage-viewer.component.scss:297`. This is system-level dark mode, not app-level theme switching. If the app has a theme toggle, this won't respond to it. The project rules say "Always create light and dark mode themes" — this approach works but is limited to OS-level preference.

---

## Spec

1. **Three-pane layout** — Controls across top, file list left, content viewer right. Matches design doc. ✓

2. **Bucket toggle** — Time Series / Corpus via `mat-button-toggle-group`. ✓

3. **Symbol input** — Debounced 500ms, uppercased, triggers `setSymbol` + `loadIndex`. ✓

4. **Expiration dropdown** — `<mat-select>` populated from `store.filteredExpirations()`, disabled when `filtersDisabled()`, "All" option with `null` value. ✓

5. **Strike dropdown** — `<mat-autocomplete>` with text filtering, populated from `filteredStrikes()` computed signal, "All" option with empty string value. ✓

6. **Cross-filtering** — `setExpiration` narrows strikes via `expirationToStrikes` map, `setStrike` narrows expirations via `strikeToExpirations` map. Both reset to full list when "All" selected. ✓

7. **Type filter** — Call/Put/All via `<mat-select>`. ✓

8. **List button** — Disabled when no symbol or loading. ✓

9. **File list** — Shows contract ID + metadata chips (expiration, strike, type). Corpus mode shows dates. ✓

10. **Content viewer** — Pretty-prints JSONL, shows path + byte count, close button. ✓

11. **Route** — `/storage-viewer` with `authGuard`. ✓

12. **Nav item** — "Storage Viewer" with `folder_open` icon, admin role required. ✓

13. **Barrel exports** — All subdirectories have `index.ts` with only re-exports. ✓

14. **`isTimeSeries` is a `computed` signal** — Fixed from code review finding. ✓

15. **No `console.log` debug artifacts** — Only `console.error` in error handlers. ✓

16. **Standalone component with `inject()`** — ✓

17. **New control flow (`@if`, `@for`)** — ✓

18. **Separate template and styles files** — ✓

19. **`OnPush` change detection** — ✓

20. **Flexbox layouts** — ✓

21. **Sass with `rem`/`em` units** — ✓ (1px borders are acceptable per rules)

22. **Trailing newline in `nav-menu-items.ts`** — Fixed (was missing, code review finding #5). ✓

---

## Thermo-Nuclear

1. **Store reads Firestore directly from the browser** — `loadIndex()` at `storage-viewer.store.ts:199-206` uses `@angular/fire/firestore` `getDocs` to read the `options-file-index` collection. This is secured by the Firestore rules (admin read-only), so it's safe. But it means the frontend has a direct Firestore dependency for index data, while list/read operations go through the Cloud Function. This dual-path (direct Firestore for index, Cloud Function for list/read) is an architectural choice that works but couples the frontend to the Firestore schema. If the index schema changes, both the backend service and the frontend store need updating.

2. **No loading guard on `loadIndex`** — If the user types rapidly (even with 500ms debounce), multiple `loadIndex` calls could fire in parallel. `switchMap` in the `rxMethod` cancels the previous observable, so only the latest call's result persists. This is correct behavior. ✓

3. **`formatContent` parses arbitrary JSON in the browser** — `storage-viewer.component.ts:132-148` parses JSONL content from GCS. If a file is malformed, it falls back to raw display. No XSS risk since it's rendered in `<pre>` with interpolation (Angular auto-escapes). ✓

4. **Store `onInit` calls `loadIndex()` for default symbol 'QQQ'** — `storage-viewer.store.ts:362-364`. This fires on store initialization, before the component's `ngOnInit`. If the user is not authenticated, the Firestore read will fail and the error will be shown via snackbar. This is acceptable for an admin-guarded route. ✓

5. **`setBucket` doesn't clear filter state** — `storage-viewer.store.ts:110-118` clears list/contracts/dates/readResult/error but preserves `expiration`, `strike`, `optionType`, and the cross-filter maps. When switching from time-series to corpus and back, old filters persist. This is arguably intentional (user doesn't lose their filter selections) but could be confusing if the filters are stale relative to a different bucket's data. Since corpus mode doesn't use these filters, it's harmless.

---

## Verdict: Approve with findings

The UI implementation is solid, follows all Angular project rules (signals, inject, new control flow, standalone, separate files, OnPush), and matches the design doc. The main issues are the incomplete shared type extraction (Standards #1, same as Commit 2) and unused imports (Standards #2).

### Recommended follow-ups (not blocking)
- Remove unused `FormsModule` and `MatToolbarModule` imports from the component
- Move `ExpirationIndexDoc`, `StrikeIndexDoc`, and collection constants to `shared/options/contract-types.ts`
- Consider app-level theme toggle support instead of only `prefers-color-scheme`
