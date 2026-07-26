# Storage Viewer Dual-Column Refactor — Code Review

**Date:** 2026-07-26
**Reviewer:** Cascade (AI)
**Fixed Point:** `HEAD` (1d3cb8d)
**Spec:** `docs/operations/storage-viewer-dual-column-refactor.md`

---

## Changed Files Inventory

### Modified (tracked)
- `.gitignore` — minor addition
- `TASK.md` — task entry added
- `docs/operations/storage-file-viewer-design.md` — superseded notice, Phase 2 marked complete
- `functions/src/v2/historical-options-corpus/services/storage-file-viewer.service.ts` — small change
- `functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts` — small change
- `src/app/core/auth/auth.service.ts` — `getIdTokenResult` fix (2 lines)
- `src/app/feat/storage-file-viewer/common/index.ts` — barrel exports updated
- `src/app/feat/storage-file-viewer/comps/index.ts` — barrel exports updated
- `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.html` — replaced with dual-column layout
- `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.scss` — replaced with dual-column styles
- `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.ts` — refactored to thin wrapper
- `src/app/feat/storage-file-viewer/store/index.ts` — barrel exports updated
- `src/app/feat/storage-file-viewer/store/storage-viewer.store.ts` — minor fix (`result.files ?? []`), old store still present

### New (untracked)
- `docs/operations/storage-viewer-dual-column-refactor.md` — spec/design doc
- `src/app/feat/storage-file-viewer/common/content-search.service.ts` — in-content search service
- `src/app/feat/storage-file-viewer/common/viewer-utils.ts` — shared pure functions
- `src/app/feat/storage-file-viewer/comps/corpus-viewer/` — corpus column component (3 files)
- `src/app/feat/storage-file-viewer/comps/time-series-viewer/` — time-series column component (3 files)
- `src/app/feat/storage-file-viewer/store/corpus-viewer.store.ts` — corpus-only signal store
- `src/app/feat/storage-file-viewer/store/time-series-viewer.store.ts` — time-series-only signal store

### Unrelated untracked files (not reviewed)
- `CONTEXT.md`, `docs/backfill/*`, `docs/partner/options-data/*`, `functions/scripts/diagnostics/*`, `src/assets/data/*` — pre-existing untracked files

---

## Standards

### Findings

1. **Old `storage-viewer.store.ts` not deleted** — The spec (`docs/operations/storage-viewer-dual-column-refactor.md`) and the project plan both call for deleting the old monolithic store. The file still exists at `src/app/feat/storage-file-viewer/store/storage-viewer.store.ts` (362 lines). The barrel export at `store/index.ts` no longer exports it, but the file remains. **Hard violation** — spec says "deleted", file is still present.

2. **`highlightContent` uses `[innerHTML]` without `DomSanitizer`** — The project rules don't explicitly require `DomSanitizer` for `[innerHTML]`, but Angular best practice is to sanitize dynamic HTML. The `highlightContent` function does manual HTML escaping (which is correct and safe), but bypasses Angular's built-in XSS protection. **Judgement call** — the manual escaping is sufficient for this use case, but `DomSanitizer.bypassSecurityTrustHtml()` would be more idiomatic.

3. **`::ng-deep` usage in component SCSS** — Both `corpus-viewer.component.scss` and `time-series-viewer.component.scss` use `::ng-deep mark.search-hit`. The project rules don't explicitly ban `::ng-deep`, but it's deprecated in Angular. **Judgement call** — necessary for styling `innerHTML`-injected elements; no practical alternative without global styles.

4. **Hardcoded `lineHeight = 19.2` in `scrollToOccurrence`** — Both `corpus-viewer.component.ts:152` and `time-series-viewer.component.ts:234` hardcode the line height as `19.2` (derived from `0.8rem * 1.5`). If the font size or line-height changes in SCSS, this magic number will silently break scroll positioning. **Judgement call** — fragile coupling between SCSS and TS; could use `getComputedStyle` instead, but acceptable for now.

5. **Barrel exports follow project rules** — `common/index.ts`, `comps/index.ts`, and `store/index.ts` all contain only re-exports, no logic. ✅ Compliant with the "No Accumulation in `index.ts`" rule.

6. **File sizes within limits** — All new files are well under the 500-line limit:
   - `content-search.service.ts`: 143 lines ✅
   - `viewer-utils.ts`: 93 lines ✅
   - `corpus-viewer.store.ts`: 166 lines ✅
   - `time-series-viewer.store.ts`: 321 lines ✅
   - `corpus-viewer.component.ts`: 157 lines ✅
   - `time-series-viewer.component.ts`: 239 lines ✅
   - `storage-viewer.component.ts`: 74 lines ✅

7. **Single responsibility per file** — Each new file owns exactly one concern. Stores are split by domain, components by column, utils are pure. ✅ Compliant with the module design rules.

8. **No cross-concern imports** — Components import from `common/` (utils + service) and `store/` only. No component imports from another component. ✅ Compliant.

9. **JSDoc comments present** — All exported functions and classes have JSDoc. ✅ Compliant.

10. **`@if`/`@for` new control flow syntax** — All templates use `@if`, `@for`, `@else` instead of `*ngIf`/`*ngFor`. ✅ Compliant.

11. **`inject()` function used** — All components use `inject()` for DI, not constructor injection. ✅ Compliant.

12. **Standalone components** — All new components are standalone. ✅ Compliant.

13. **Separate template and style files** — No inline templates or styles. ✅ Compliant.

14. **Flexbox for layouts** — All layouts use flexbox. ✅ Compliant.

15. **Sass for styling** — All style files are `.scss`. ✅ Compliant.

16. **Dark mode themes** — Both component SCSS files include `@media (prefers-color-scheme: dark)` blocks. ✅ Compliant.

### Standards Summary
- **Hard violations:** 1 (old store not deleted)
- **Judgement calls:** 3 (innerHTML without sanitizer, ::ng-deep, hardcoded lineHeight)
- **Worst issue:** Old `storage-viewer.store.ts` still present despite spec calling for deletion

---

## Spec

### Findings

1. **Dual-column layout** — ✅ Implemented. `storage-viewer.component.html` renders two columns side by side with `app-corpus-viewer` and `app-time-series-viewer`.

2. **Find bar at top** — ✅ Implemented. Find bar is inside the `<header>` with a single search input and two navigation groups (Corpus + TS).

3. **Corpus column: form + file list + content viewer** — ✅ Implemented. `corpus-viewer.component.html` has form row (symbol + date filter + List), then viewer-row with list-panel and content-panel side by side.

4. **Time-series column: form + contract list + metadata + content viewer** — ✅ Implemented. `time-series-viewer.component.html` has form row, then left-panel (contract list above metadata strip) and content-panel.

5. **Contract list above metadata viewer** — ✅ Implemented. In `time-series-viewer.component.html`, the `.list-panel` comes before `.metadata-panel` inside `.left-panel`.

6. **In-content search** — ✅ Implemented. `ContentSearchService` manages search term, occurrences, and navigation. Both components register content via effects and scroll to matches.

7. **Search highlighting** — ⚠️ The spec says "No text highlighting in v1 — scroll-to-match only. Highlighting can be added in a follow-up." Highlighting was implemented anyway via `highlightContent()` and `[innerHTML]`. This is **scope creep** relative to the spec, though the user explicitly requested it in a follow-up.

8. **Responsive stacking below 80rem** — ✅ Implemented. `storage-viewer.component.scss` has `@media (max-width: 80rem)` that changes `flex-direction` to column.

9. **Old store deleted** — ❌ Not done. `storage-viewer.store.ts` still exists. Spec implementation steps say "Delete `storage-viewer.store.ts`".

10. **`CorpusViewerStore` state** — ✅ Matches spec exactly: `symbol`, `listResult`, `dates`, `corpusFiles`, `readResult`, `loadingList`, `loadingRead`, `error`.

11. **`TimeSeriesViewerStore` state** — ✅ Matches spec exactly: all 16 fields including Firestore index state and cross-filtering.

12. **`ContentSearchService` architecture** — ✅ Matches spec: `Occurrence` interface, signals for search term and occurrences, `setSearchTerm()`, `registerContent()`, `next()`, `prev()`.

13. **`viewer-utils.ts`** — ✅ Extracted `formatStrike`, `formatBytes`, `formatContent` from the original component. `highlightContent` and `escapeHtml` are additions beyond the spec.

14. **`auth.service.ts` fix** — Not in the spec. This was a runtime warning fix done during implementation. Justified — the `getIdTokenResult` standalone function was called after an `await`, which broke the injection context.

15. **`storage-file-viewer.service.ts` change** — Not in the spec. The `result.files ?? []` nullish coalescing fix is a defensive coding improvement. Minor scope creep but justified.

16. **`time-series-builder.service.ts` change** — Not in the spec. Unrelated to the dual-column refactor. Should be reviewed separately.

### Spec Summary
- **Missing requirements:** 1 (old store not deleted)
- **Scope creep:** 3 (highlighting beyond spec, auth.service.ts fix, backend service changes)
- **Worst issue:** Old store not deleted per spec

---

## Thermo-Nuclear

### Contract Matrix

| Aspect | Implementation |
|---|---|
| **Input validation** | Stores validate `symbol` before API calls. FormControls use `nonNullable: true`. |
| **Authorization** | No auth checks in new components (relies on existing route guards). |
| **Persistence** | No direct Firestore writes from new code. `TimeSeriesViewerStore` reads Firestore index (read-only). |
| **Provider calls** | `StorageViewerApiService` wraps Firebase Callable Function (unchanged). |
| **Response schema** | `ReadResult` type used correctly. `result.files ?? []` defensive fix in old store. |
| **Shared enums/constants** | `BucketName`, `ContractResult`, `CorpusFileEntry` imported from `@shared/options`. |
| **Observability** | `console.error` in store catch blocks. No structured logging. |
| **Tests** | None. Project rules say "we will not be implementing unit testing yet." |
| **Documentation** | Spec doc created. JSDoc on all exports. |

### Findings

1. **Duplicated code: `scrollToOccurrence` and `formattedContent`/`highlightedContent` pattern** — Both `CorpusViewerComponent` and `TimeSeriesViewerComponent` have identical `scrollToOccurrence` methods (same magic number `19.2`, same logic). They also have identical `formattedContent` and `highlightedContent` computed signals. This is duplicated code that should be extracted — either into a shared base class, a composable, or a directive. The `ContentSearchService` already abstracts the search state; the scroll-to-occurrence logic could be a method on it or a separate utility.

   **Severity:** Medium — 2 instances of ~10 lines duplicated. Not critical but violates DRY.

2. **Duplicated SCSS: list-panel, content-panel, item-row, dark mode blocks** — The `corpus-viewer.component.scss` (262 lines) and `time-series-viewer.component.scss` (428 lines) share ~80% identical styles for `.list-panel`, `.item-list`, `.list-column-header`, `.item-row`, `.col`, `.content-panel`, `.content-pre`, `.empty-state`, and dark mode overrides. This is a significant amount of duplicated CSS. A shared `_viewer-mixins.scss` file could eliminate the majority of this duplication.

   **Severity:** Medium — ~200 lines of duplicated SCSS. Maintainability concern: a style fix in one file must be manually replicated in the other.

3. **`ContentSearchService` duplicates bucket logic** — The service has parallel `_corpusOccurrences`/`_tsOccurrences`, `_corpusCurrentIndex`/`_tsCurrentIndex` signals, and parallel `corpusCurrent`/`tsCurrent`, `corpusTotal`/`tsTotal`, `corpusCurrentOccurrence`/`tsCurrentOccurrence` computed signals. The `setBucketOccurrences`, `step`, and `computeOccurrences` methods all branch on `bucket === 'corpus'`. This could be a generic `Map<SearchBucket, BucketState>` or a small `BucketSearchState` class, eliminating the parallel duplication.

   **Severity:** Low-Medium — the service is only 143 lines and the duplication is manageable, but it's a smell that will grow if a third bucket is ever added.

4. **`highlightContent` regex on large content** — The function runs a global regex replace on the entire formatted content string on every keystroke (via the `highlightedContent` computed signal). For very large JSONL files (the viewer is designed for options time-series data), this could cause UI jank. The `computeOccurrences` method in `ContentSearchService` also scans the full content line-by-line on every search term change. Both operations are O(n*m) where n is content length and m is term length.

   **Severity:** Low — practical content sizes are likely under 1MB. But worth noting for future large files.

5. **Old `storage-viewer.store.ts` is dead code** — 362 lines of dead code still in the repo. It's no longer exported from the barrel, but it's still importable directly. This is a structural regression — the refactor's purpose was to replace this file, not leave it alongside the new stores.

   **Severity:** Medium — dead code that should be deleted. Confusing for future developers who find two store implementations.

6. **`storage-viewer.component.ts` is appropriately thin** — At 74 lines, the layout wrapper is clean and focused. It delegates all state to the sub-components and only owns the find bar UI. ✅ Good decomposition.

7. **Store decomposition is clean** — `CorpusViewerStore` (166 lines) and `TimeSeriesViewerStore` (321 lines) are well-separated. The time-series store is larger but justified by the Firestore index loading and cross-filtering logic. No file approaches the 500-line limit. ✅ Good.

8. **`withProps` observables are unused** — Both stores define `symbol$`, `listResult$`, `readResult$`, `loadingList$`, `loadingRead$`, `error$` (and `loadingIndex$` for TS) via `withProps` + `toObservable`. These observables are not consumed by any component (the components use the signal versions directly). This is speculative generality — adding RxJS observable projections that no one reads.

   **Severity:** Low — ~10 lines of unused props per store. But it's exactly the "Speculative Generality" smell: abstraction added for needs the spec doesn't have.

9. **`escapeHtml` is a private function, not exported** — The `escapeHtml` function in `viewer-utils.ts` is private (not exported). This is correct — it's an implementation detail of `highlightContent`. ✅ Good boundary.

10. **`highlightContent` correctly escapes before wrapping** — The function escapes HTML entities first, then applies the regex to wrap matches in `<mark>` tags. The search term is also escaped before being used in the regex. This is the correct order to prevent XSS. ✅ Good.

### Thermo-Nuclear Summary
- **Structural regressions:** 1 (dead `storage-viewer.store.ts` — 362 lines of dead code)
- **Duplicated code:** 2 (TS `scrollToOccurrence`/`highlightedContent` pattern, SCSS list/content panel styles)
- **Speculative generality:** 1 (unused `withProps` observables in both stores)
- **Performance concern:** 1 (regex on full content per keystroke)
- **Worst issue:** ~200 lines of duplicated SCSS between the two viewer components — a maintainability problem that will cause drift.

---

## Summary

| Axis | Findings | Worst Issue |
|---|---|---|
| **Standards** | 1 hard, 3 judgement | Old `storage-viewer.store.ts` not deleted |
| **Spec** | 1 missing, 3 scope creep | Old store not deleted per spec |
| **Thermo-Nuclear** | 4 findings | ~200 lines duplicated SCSS between viewer components |

### Recommended Remediation (in priority order)

1. **Delete `storage-viewer.store.ts`** — Dead code, spec calls for deletion. No imports reference it via barrel.
2. **Extract shared SCSS mixins** — Create `_viewer-mixins.scss` with the common list-panel, content-panel, item-row, and dark mode styles. Both components `@use` it.
3. **Extract `scrollToOccurrence` to shared utility** — Move to `viewer-utils.ts` or `ContentSearchService` to eliminate TS duplication.
4. **Remove unused `withProps` observables** — Both stores have ~6-7 unused `toObservable` props that are speculative generality.
5. **Consider `DomSanitizer`** — Wrap `highlightContent` output in `DomSanitizer.bypassSecurityTrustHtml()` for Angular idiom compliance (low priority — manual escaping is safe).

---

**Review complete. No changes have been made. Awaiting user approval before implementing any remediation.**
