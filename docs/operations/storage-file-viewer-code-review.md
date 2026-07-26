# Code Review: Storage File Viewer Feature

**Review dates:**
- Round 1: 2026-07-24
- Round 2: 2026-07-25
**Fixed point:** `HEAD` (all uncommitted changes)
**Reviewer:** Cascade (3-axis review: Standards, Spec, Thermo-Nuclear)

---

## Change Inventory

### Modified files (tracked)

| File | Lines changed | Summary |
|---|---|---|
| `firestore.rules` | +7 | Added `options-file-index` admin read-only rule |
| `functions/src/index.ts` | +1 | Export `partnerListContractsV2` |
| `functions/src/v2/historical-options-corpus/handlers/storage-file-viewer.http.ts` | -39, +12 | Removed local types (now in `@shared/options`), added symbol validation |
| `functions/src/v2/historical-options-corpus/services/gcs-time-series-adapter.service.ts` | +28 | Added `getMetadata()` method |
| `functions/src/v2/historical-options-corpus/services/index.ts` | +1 | Barrel export for `contract-result.utils` |
| `functions/src/v2/historical-options-corpus/services/storage-file-viewer.service.ts` | -92, +18 | Removed `parseContractResult`/`filterContractsByType` (extracted), null-handling fixes, added metadata read |
| `src/app/app.routes.ts` | +2 | Added `/storage-viewer` route |
| `src/app/core/config/nav-menu-items.ts` | +9 | Added Storage Viewer nav item |
| `src/styles.scss` | +6 | Expiration dropdown panel sizing |
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.ts` | +7 | Fixed autocomplete with `toSignal` |

### New files (untracked)

| File | Lines | Summary |
|---|---|---|
| `shared/options/contract-types.ts` | 116 | Shared types: `ContractResult`, request/response types, Firestore index doc types, collection constants |
| `shared/options/contract-length.utils.ts` | 90 | `classifyContractLength`, `calendarDaysBetween`, `dayOfWeek`, `formatDateWithDow` |
| `shared/options/index.ts` | 5 | Barrel export for `shared/options` |
| `functions/src/v2/historical-options-corpus/services/contract-result.utils.ts` | 50 | `parseContractResult`, `filterContractsByType` (extracted from service) |
| `functions/src/v2/partner/list-contracts-partner.ts` | 280 | Partner-facing `partnerListContractsV2` HTTPS endpoint |
| `src/app/feat/storage-file-viewer/common/storage-viewer-api.ts` | 45 | API service wrapping `storageFileViewer` callable |
| `src/app/feat/storage-file-viewer/common/index.ts` | — | Barrel |
| `src/app/feat/storage-file-viewer/store/storage-viewer.store.ts` | 354 | NgRx Signal Store |
| `src/app/feat/storage-file-viewer/store/index.ts` | — | Barrel |
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.html` | 237 | Template |
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.scss` | — | Styles |
| `src/app/feat/storage-file-viewer/comps/index.ts` | — | Barrel |
| `src/app/feat/storage-file-viewer/index.ts` | — | Feature barrel |

---

# Round 1 Review (2026-07-24)

## Standards

### Hard Violations

1. **~~Duplicated type definitions across 3 locations~~** ✅ **RESOLVED** — `ContractResult`, `ListTimeSeriesResult`, `ListCorpusResult`, `ReadResult`, `BucketName`, and all request types were defined independently in:
   - ~~`functions/src/v2/historical-options-corpus/services/storage-file-viewer.service.ts:17-45`~~
   - ~~`functions/src/v2/historical-options-corpus/handlers/storage-file-viewer.http.ts:7-36`~~
   - ~~`src/app/feat/storage-file-viewer/common/storage-viewer-api.ts:10-77`~~

   **Fix:** Extracted all shared types to `shared/options/contract-types.ts`. All three consumers now import from `@shared/options`.

2. **~~Duplicated `parseContractResult` function~~** ✅ **RESOLVED** — Near-identical implementations existed in:
   - ~~`storage-file-viewer.service.ts:211-224`~~ — returned `strike: strikeNumeric` (no division)
   - ~~`list-contracts-partner.ts:88-101`~~ — returned `strike: strikeNumeric / 1000` (with division)

   **Fix:** Extracted to `functions/src/v2/historical-options-corpus/services/contract-result.utils.ts`. The `/ 1000` bug was removed — `parseContractIDMetadata` already returns strike in dollars.

3. **~~`isTimeSeries()` method called in template~~** ✅ **RESOLVED** — `storage-viewer.component.ts:128-130` defined `isTimeSeries(): boolean` and the template called it at line 29. Project rules: "Never use getters in HTML templates; always use Angular signals."

   **Fix:** Converted to `readonly isTimeSeries = computed(() => this.store.bucket() === 'time-series');`

4. **~~Console.log statements in production code~~** ✅ **RESOLVED** — `storage-viewer.store.ts:291` and `:295` contained `console.log('[StorageViewerStore] list request:', req)` and `console.log('[StorageViewerStore] list result:', result)`.

   **Fix:** Debug `console.log` statements removed.

5. **~~Missing trailing newline~~** ✅ **RESOLVED** — `src/app/core/config/nav-menu-items.ts` — diff showed `\ No newline at end of file`.

   **Fix:** Trailing newline added.

### Judgement Calls (Smell Baseline)

6. **~~Duplicated `filterContractsByType`~~** ✅ **RESOLVED** — Existed in both `storage-file-viewer.service.ts:226-235` and `list-contracts-partner.ts:103-116` with slightly different type comparison logic.

   **Fix:** Extracted to `contract-result.utils.ts` — both consumers now import the same function.

7. **~~Data Clumps~~** ✅ **RESOLVED** — The `symbol + expiration + strike + type` parameter组合 travelled through multiple functions. Now formalized in shared request types in `contract-types.ts`.

8. **~~Feature Envy — Path 4 inline filtering~~** ✅ **RESOLVED** — `storage-file-viewer.service.ts:112-119` did inline type filtering with `id.includes(type === 'C' ? 'C' : 'P')` instead of using `filterContractsByType`.

   **Fix:** Path 4 now uses `filterContractsByType(docData.contractIds, upperSymbol, type)` like every other path.

---

## Spec (Round 1)

**Spec source:** `docs/partner/partner-discovery.md` and `docs/partner/options-data/historical-options-time-series-prd.md`

### Findings

1. **~~`partnerListContractsV2` strike values are wrong~~** ✅ **RESOLVED** — The partner endpoint returned `strikeNumeric / 1000`, but `parseContractIDMetadata` already returns strike in dollars. Partners would have received strikes 1000x too small.

   **Fix:** `/ 1000` removed in extracted `contract-result.utils.ts`.

2. **~~`partnerListContractsV2` type field inconsistency~~** ✅ **RESOLVED** — Partner endpoint returned `type: meta.type === 'call' ? 'C' : 'P'` (single-letter), while admin returned `type: meta.type` (full word). Both now use the shared `parseContractResult` which returns `meta.type` consistently.

3. **~~No input validation on `storageFileViewer` callable~~** ⚠️ **PARTIALLY RESOLVED** — Handler now validates `data.symbol` presence and type. `contractId` and `date` for read actions are not yet validated.

4. **~~Path 4 (symbol only) has no type filtering via helper~~** ✅ **RESOLVED** — Path 4 now uses `filterContractsByType`.

---

## Thermo-Nuclear (Round 1)

### Structural Findings

1. **~~CRITICAL: Strike value inconsistency~~** ✅ **RESOLVED** — Both endpoints now use the shared `parseContractResult` from `contract-result.utils.ts`. Strike is consistently returned in dollars.

2. **~~Code-judo opportunity: Extract shared contract parsing + types~~** ✅ **RESOLVED** — `ContractResult`, request/response types, and `parseContractResult` are now defined once in `shared/options/` and `contract-result.utils.ts`. The strike divergence bug would now be impossible.

3. **~~Path 4 inline filtering is spaghetti growth~~** ✅ **RESOLVED** — Path 4 now uses `filterContractsByType`.

4. **~~`isTimeSeries()` is not a signal~~** ✅ **RESOLVED** — Now `readonly isTimeSeries = computed(...)`.

5. **~~Debug `console.log` statements in store~~** ✅ **RESOLVED** — Removed.

6. **`StorageFileViewerService` instantiated per-request** — `storage-file-viewer.http.ts:61` — `new StorageFileViewerService(db)` creates a new instance on every function invocation. Fine for stateless services. **No change needed.**

7. **~~No barrel export for storage-file-viewer feature~~** ✅ **RESOLVED** — Barrel exports added for `common/`, `store/`, `comps/`, and feature root `index.ts`.

### Contract Matrix (Round 1)

| Concern | Storage Viewer (admin) | Partner List Contracts | Match? |
|---|---|---|---|
| ~~Strike value~~ | ~~`strikeNumeric` (dollars)~~ | ~~`strikeNumeric / 1000` (dollars/1000)~~ | ✅ **FIXED** |
| ~~Type field~~ | ~~`meta.type` ('call'/'put')~~ | ~~`meta.type === 'call' ? 'C' : 'P'`~~ | ✅ **FIXED** |
| ~~Input validation~~ | ~~None~~ | ~~Thorough~~ | ⚠️ **PARTIALLY FIXED** |
| ~~Filter helper (Path 4)~~ | ~~Inline `id.includes()`~~ | ~~`filterContractsByType`~~ | ✅ **FIXED** |
| Auth | Firebase Auth admin check | Service account auth | Different (by design) |

---

# Round 2 Review (2026-07-25)

## Standards

### Hard Violations

1. **Duplicate import in `list-contracts-partner.ts`** — Lines 17 and 19 both import from `'../utils/utils'`:
   ```typescript
   import { authenticateRequestEither, createLogger } from '../utils/utils';
   import { db } from '../utils/utils';
   ```
   Should be a single import: `import { authenticateRequestEither, createLogger, db } from '../utils/utils';`

### Judgement Calls (Smell Baseline)

2. **Duplicated Code** — The Firestore index four-path query dispatch (symbol+expiration, symbol+strike, symbol+both, symbol-only) is implemented twice: once in `storage-file-viewer.service.ts` (Paths 1-4) and once in `list-contracts-partner.ts` (Paths 1-3). The paths are nearly identical, differing only in error handling style (throw `HttpsError` vs `res.json`). Extractable to a shared `queryContractsByFilters()` pure function.

3. **Feature Envy** — `metadataEntries()` in `storage-viewer.component.ts:163-178` knows about GCS metadata field names, ordering, and date formatting. This is presentation logic, acceptable in the component, but if another consumer needs the same formatting, it should move to a utility.

4. **Primitive Obsession** — `toFirstString`, `parseOptionalDate`, `parseOptionalStrike`, `parseOptionalType` in `list-contracts-partner.ts` are bespoke query param parsers. Acceptable for now, but could be extracted as the partner API grows.

---

## Spec (Round 2)

**Spec source:** `docs/operations/storage-file-viewer-design.md` — approved 2026-07-23

### Requirements Missing or Partial

1. **Design: "No search button"** (line 138) — The design specifies live filtering with no search button. The implementation has a **List button** that must be clicked. This is a deliberate UX deviation — the design called for real-time narrowing, the implementation uses a request-response pattern. **Deviation from spec.**

2. **Design: "Symbol toggle (QQQ / TQQQ)"** (line 128) — The design specifies a toggle for symbol selection. The implementation uses a free-text input with debounce. This is actually better for extensibility but deviates from the spec.

3. **Design: Corpus "date prefix matching"** (lines 173-176) — The design specifies prefix matching for corpus dates (e.g., `2024` → all 2024 files, `2024-03` → March 2024). The implementation lists all dates without prefix filtering. **Missing feature.**

4. **Design: Corpus left panel "Metadata: size, generation, last updated"** (line 188) — The corpus list only shows the date string, not GCS object metadata. **Missing feature.**

5. **Design: Component structure** (lines 341-362) — Spec calls for 4 separate components (`file-viewer-layout`, `search-controls`, `file-list`, `file-content`). Implementation is 1 monolithic component (227 lines TS + 237 lines HTML). **Partial implementation** of the frontend phase. Under the 500-line limit but approaching it.

### Behaviour Not Asked For (Scope Creep — all positive)

6. **Direct Contract ID read** — Not in the design doc. Added as a convenience feature. Positive addition.

7. **Metadata panel** (third pane) — Not in the design doc (which shows a two-pane layout). Added as a third panel showing GCS custom metadata. Positive addition.

8. **Pretty-print JSONL** — Listed as future work in the design doc (line 437). Implemented early via `formatContent()`. Positive scope creep.

9. **Contract length display** — Listed as future work (line 440). Implemented via `contractLength()`. Positive scope creep.

10. **Error snackbar** — Not explicitly in the design doc. Good practice.

11. **`partnerListContractsV2` endpoint** — Phase 3 of the design doc. Implemented as part of the same changeset, which is within the approved scope.

### Requirements Implemented but Possibly Wrong

12. **Strike value in `contract-result.utils.ts`** — The old code divided by 1000, the new code doesn't. `parseContractIDMetadata` returns strike in dollars (per its doc comment), so the new code is correct. The old code was buggy. This was fixed in Round 1 remediation. ✅ Verified correct.

---

## Thermo-Nuclear (Round 2)

### Whole-Change Protocol

**Inventory:** 10 modified files + ~13 new files. Total diff: +86/-107 lines (modified) + ~1500 lines across new files.

**Feature path traced:**
- Frontend: route → component → store → API service → Cloud Function → backend service → Firestore/GCS
- Partner: HTTP request → auth → handler → Firestore index → response
- Shared types: `@shared/options` → consumed by both frontend and backend

**Contract matrix (Round 2):**

| Concern | Admin path | Partner path | Match? |
|---|---|---|---|
| Auth | Firebase Auth, admin claim | Service account OIDC | Different (by design) |
| Input validation | `data.symbol` check in handler | Thorough param parsing | ⚠️ Admin is lighter |
| Error envelope | `HttpsError` with code/message | JSON `{ ok, error, code, timestamp }` | Different (by design) |
| Response schema | `ListTimeSeriesResult` / `ReadResult` | `{ ok, symbol, contracts, count }` | Different (by design) |
| Shared types | `ContractResult` from `@shared/options` | `ContractResult` from `@shared/options` | ✅ Shared |
| Index query logic | 4 paths in `storage-file-viewer.service.ts` | 3 paths in `list-contracts-partner.ts` | ⚠️ Duplicated |
| Type filtering | `filterContractsByType()` | `filterContractsByType()` | ✅ Shared |
| Strike value | `strikeNumeric` (dollars) | `strikeNumeric` (dollars) | ✅ Fixed in Round 1 |

### Structural Findings

1. **Code-judo opportunity: Extract shared index query function**
   The four-path Firestore dispatch (expiration-only, strike-only, both, symbol-only) is implemented twice: once in `storage-file-viewer.service.ts` and once in `list-contracts-partner.ts`. Paths 1-3 are nearly identical, differing only in error handling (throw vs `res.json`).

   **Recommended extraction:**
   ```typescript
   // shared/options/query-contracts.ts
   export async function queryContractsByFilters(
     db: Firestore,
     symbol: string,
     expiration?: string | null,
     strike?: number | null,
     type?: 'C' | 'P' | null,
   ): Promise<ContractResult[]>
   ```

   Both handlers call this, then wrap the result in their respective response shapes. This deletes ~60 lines of duplicated logic and makes the index query testable in isolation.

2. **`list-contracts-partner.ts` — duplicate import from `../utils/utils`** — Lines 17 and 19 both import from the same module. Should be merged into one import statement.

3. **`list-contracts-partner.ts` — `HttpsOptions` type manually defined** (lines 29-34) instead of using the type from `firebase-functions/v2/https`. The manual type could drift from the actual options shape.

4. **Component size approaching limit** — 227 lines TS + 237 lines HTML = 464 total. Under the 500-line limit, but the template mixes 4 concerns: search controls, list panel, metadata panel, content panel. The design doc called for 4 components. Adding corpus date prefix filtering, virtual scroll, or file download will push past 500 lines. **Recommendation:** Split into `search-controls`, `file-list`, `metadata-panel`, and `content-panel` components before adding more features.

5. **`storage-file-viewer.service.ts` — `getStorage()` called per-method** (lines 117, 142, 164) — Each method calls `getStorage()` independently. Since the service is instantiated per-request, this is fine, but could be hoisted to constructor for clarity.

6. **Missing: no tests** — Project rules say "We will not be implementing unit testing yet but will in the future." No tests exist for `contract-result.utils.ts`, `filterContractsByType`, or the partner endpoint handler. Acceptable per current rules but noted for future.

7. **`toSignal` in field initializer** — `storage-viewer.component.ts:68` uses `toSignal(this.strikeCtrl.valueChanges, { initialValue: '' })` as a field initializer. This works because field initializers run in injection context. `toSignal` auto-cleans up via `DestroyRef`. ✅ Correct.

8. **`shared/options/index.ts` barrel** — Exports `contract-types` and `contract-length.utils`. Clean, no logic. ✅ Correct.

9. **`contract-length.utils.ts`** — Pure lookup table with 16 buckets, well-organized, exported for reuse. ✅ Correct.

### Approval Bar Assessment

- ✅ No file crosses 1000 lines
- ⚠️ Missed opportunity to extract shared index query logic (finding #1) — strongest structural finding
- ⚠️ Component decomposition deferred from design spec (finding #4) — not a blocker yet
- ✅ No spaghetti growth from special-case branching
- ✅ No hacky/magical abstractions
- ✅ No unnecessary wrappers
- ⚠️ Duplicated logic across admin and partner paths (finding #1)
- ✅ Logic in correct layers
- ✅ No unnecessary sequential orchestration

---

## Summary

### Round 1 (2026-07-24)

| Axis | Findings | Resolved | Worst issue |
|---|---|---|---|
| **Standards** | 8 (5 hard, 3 judgement) | 8/8 ✅ | Duplicated types and parsing logic across 3 locations |
| **Spec** | 4 | 3 ✅ + 1 ⚠️ partial | Partner endpoint returned wrong strike values (1000x too small) |
| **Thermo-Nuclear** | 7 | 6/7 ✅ | Strike inconsistency was a production bug; shared extraction was the code-judo fix |

### Round 2 (2026-07-25)

| Axis | Findings | Worst issue |
|---|---|---|
| **Standards** | 4 (1 hard, 3 judgement) | Duplicate import in `list-contracts-partner.ts` |
| **Spec** | 12 (5 missing, 6 scope creep, 1 verified) | Live filtering replaced with List button; corpus prefix matching missing |
| **Thermo-Nuclear** | 9 (2 structural, 7 minor/OK) | Duplicated index query logic — extractable to shared function |

### Recommended Remediation Priority (Round 2)

1. **Fix duplicate import in `list-contracts-partner.ts`** — Merge lines 17+19 into one import (hard violation)
2. **Extract `queryContractsByFilters()` shared function** — Eliminates ~60 lines of duplicated Firestore dispatch logic (code judo)
3. **Split component into 4 sub-components** — Before adding corpus prefix filtering or other future features
4. **Add corpus date prefix matching** — Spec requirement, currently missing
5. **Add corpus GCS metadata to list results** — Spec requirement, currently missing
6. **Replace manual `HttpsOptions` type** — Use the type from `firebase-functions/v2/https`
7. **Add basic input validation to `storageFileViewer` handler** — Symbol is validated; consider validating `contractId` and `date` presence for read actions
8. **Complete input validation on `storageFileViewer` callable** — Round 1 partial: `contractId` and `date` for read actions still unvalidated
