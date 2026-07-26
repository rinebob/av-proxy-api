# Code Review: Expiration Dropdown Enhancement Session

**Date:** 2026-07-25  
**Scope:** Changes from this session only — enriching the Storage File Viewer UI with contract metadata columns, expiration dropdown simplification, layout fixes, shared utility creation, and backfill script scaffolding.

**Files changed (tracked):**
- `functions/src/v2/historical-options-corpus/services/options-index.writer.ts` — imports `ExpirationIndexDoc`, `StrikeIndexDoc`, collection constants from `@shared/options`; re-exports for backward compat
- `src/styles.scss` — added `.exp-select-panel` global style

**Files created (untracked):**
- `shared/options/contract-length.utils.ts` — contract length classifier + calendar days helper
- `shared/options/contract-types.ts` — `ContractResult`, `ExpirationIndexDoc`, `StrikeIndexDoc`, collection constants (single source of truth)
- `shared/options/index.ts` — barrel export
- `functions/scripts/backfill/enrich-expiration-index.ts` — backfill script (on hold)
- `src/app/feat/storage-file-viewer/store/storage-viewer.store.ts` — imports types/constants from `@shared/options`; `expirationMeta` state removed
- `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.ts` — helper methods for columns + DOW; `expirationLabel()` removed
- `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.html` — table-like column layout in list panel
- `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.scss` — wider panel, viewport-height fill, column styling; dead chip CSS removed

---

## Standards

### Documented Standard Violations

1. ~~**Duplicated `ExpirationIndexDoc` interface**~~ — **RESOLVED.** `ExpirationIndexDoc` and `StrikeIndexDoc` now live in `shared/options/contract-types.ts`. Both `options-index.writer.ts` and `storage-viewer.store.ts` import from `@shared/options`.

2. ~~**Duplicated Firestore collection constants**~~ — **RESOLVED.** `OPTIONS_FILE_INDEX_COLLECTION`, `TS_EXPIRATIONS_SUBCOLLECTION`, `TS_STRIKES_SUBCOLLECTION` now live in `shared/options/contract-types.ts`. Store and backfill script import from `@shared/options`.

3. ~~**Backfill script duplicates constants**~~ — **RESOLVED.** Backfill script imports from `@shared/options`.

4. ~~**`expirationLabel()` method is dead code**~~ — **RESOLVED.** Method deleted from component. `expirationMeta` state also removed from store (was its only consumer).

5. ~~**Chip styles are dead code**~~ — **RESOLVED.** `.chip`, `.chip-call`, `.chip-put`, `.chip-exp`, `.chip-strike` classes removed.

6. ~~**Dark mode chip overrides are dead code**~~ — **RESOLVED.** Dark mode `.chip*` overrides removed.

### Baseline Smells (Judgement Calls)

1. **Possible Duplicated Code** — `dayOfWeek()` in `storage-viewer.component.ts:213-217` constructs a `Date` with `T00:00:00.000Z` and calls `toLocaleDateString`. The `calendarDaysBetween()` in `contract-length.utils.ts:57-60` does the same `Date.parse(`${startDate}T00:00:00.000Z`)` pattern. Both parse ISO dates the same way — a shared `parseIsoDate()` helper would eliminate the duplication.

2. **Possible Feature Envy** — `metadataEntries()` in `storage-viewer.component.ts:163-181` reaches into `this.dayOfWeek()` to enrich date values. The DOW-appending logic is a display concern that could live in a small pure utility, but it's minor and the current placement is reasonable for a component method.

3. **Possible Primitive Obsession** — `contract.type` is a `string` but the HTML binds `{{ contract.type }}` as a CSS class (`col-type {{ contract.type }}`). The values "call"/"put" are assumed but not type-safe. This is a pre-existing issue, not introduced by this session.

---

## Spec

No formal spec/PRD was created for this session's work. The user's requests were iterative and verbal:

1. Simplify dropdown to date (Dow) only — **implemented**
2. Add columns to contract list panel: expiration+DOW, contract length, num observations, first trading date+DOW — **implemented** (columns present, data shows `—` until backend populates `firstObserved`/`observationCount`)
3. Make left panel 100% wider — **implemented** (22rem → 44rem)
4. Make right panel collapse to available space — **implemented** (flex: 1 1 auto)
5. Make panels fill to bottom of viewport — **implemented** (calc height + flex)
6. Restore chip styling for strike and type columns — **implemented**
7. Fix header row transparency — **implemented** (opaque background)
8. Add DOW to all 3 date fields in metadata panel — **implemented**
9. Backfill script for Firestore enrichment — **scaffolded, on hold pending data repair**

**Missing/partial:**
- Backend does not yet populate `firstObserved`/`observationCount` on `ContractResult` — the columns will show `—` until this is wired. This was explicitly deferred by the user ("we'll finish that part later").
- Backfill script `observationCount` semantics fixed (now sums per-contract observation counts from CSV), but script remains on hold pending data quality repair.

**Scope creep:** None observed. All changes are directly related to the user's requests.

---

## Thermo-Nuclear

### Structural Findings

1. ~~**`expirationLabel()` is dead code — delete it.**~~ — **RESOLVED.** Method and `expirationMeta` state deleted.

2. ~~**Dead chip CSS — delete it.**~~ — **RESOLVED.** ~50 lines of dead chip CSS and dark mode overrides removed.

3. ~~**`ExpirationIndexDoc` duplicated across two layers.**~~ — **RESOLVED.** Type moved to `shared/options/contract-types.ts`; both layers import from there.

4. ~~**Backfill script `observationCount` semantics mismatch.**~~ — **RESOLVED.** `ExpirationAggregate.contractCount` replaced with `observationCount` — now sums per-contract observation counts from the CSV via `parseInt(row.observationCount)`.

5. ~~**Backfill script CSV parsing is naive.**~~ — **RESOLVED.** Replaced `split(',')` with `parseCsvLine()` — a quoted-field-aware parser handling embedded commas, doubled quotes (`""`), and CRLF line endings.

### Missed Simplifications

1. **`formatDateWithDow()` and `dayOfWeek()` could be consolidated.** `formatDateWithDow` just calls `dayOfWeek` and concatenates. This is fine as-is — two small focused functions. No action needed.

2. **`contractLength()` and `firstTradingDate()` are thin wrappers.** They guard on `contract.firstObserved` then delegate. This is acceptable for component methods that need null-safety for template binding. No action needed.

### File Size

- `storage-viewer.component.ts` is ~245 lines — well under limits (reduced from 263 after deleting `expirationLabel()`).
- `storage-viewer.component.scss` is ~453 lines — under the 500-line guideline (reduced from 517 after deleting dead chip CSS).
- `storage-viewer.store.ts` is ~370 lines — fine (reduced from 386 after removing `expirationMeta` state).
- `enrich-expiration-index.ts` is ~198 lines — fine (grew from 155 after adding `parseCsvLine()`).

### Boundary / Type Contract

1. **`ContractResult.firstObserved` and `observationCount` are optional on the shared type but the backend doesn't populate them yet.** This is intentional (user deferred backend work), but it means the frontend columns will show `—` for all contracts until wired. The optionality is correct for this transitional state.

2. **`ExpirationIndexDoc` in the store uses `data.date` as the key** but Firestore doc IDs are the expiration dates. The store reads `docSnap.data() as ExpirationIndexDoc` and uses `data.date` — if the `date` field is ever missing from the doc, the entry would have an empty key. This is a pre-existing pattern, not introduced by this session.

---

## Summary

| Axis | Findings | Status |
|------|----------|--------|
| **Standards** | 6 (3 hard, 3 judgement) | All 6 resolved |
| **Spec** | 0 violations, 2 deferred items | Deferred: backend wiring + backfill data quality |
| **Thermo-Nuclear** | 5 findings | All 5 resolved |

**Remediation status:**
1. ~~Delete dead `expirationLabel()` method~~ — done
2. ~~Delete dead chip CSS (`.chip*` classes + dark mode overrides)~~ — done
3. ~~Move `ExpirationIndexDoc` to `shared/options/` and import from both store and backend~~ — done
4. ~~Fix backfill `observationCount` semantics~~ — done (sums per-contract observation counts)
5. ~~Replace naive CSV parser~~ — done (quoted-field-aware `parseCsvLine()`)

**Deferred items (user-approved):**
- Backend `listTimeSeries` service does not yet populate `firstObserved`/`observationCount` on `ContractResult`
- Backfill script on hold pending CSV data quality repair

**Verification:** Both frontend (`tsc -p tsconfig.app.json --noEmit`) and backend (`tsc -p functions/tsconfig.json --noEmit`) compile clean.
