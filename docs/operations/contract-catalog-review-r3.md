# Contract Catalog — Round 3 Code Review

**Status:** Remediation complete for S1, T1/P2, and P6. Remaining findings (S2, S3, S4, P5, T2, T3, T5, T6) are not addressed — see individual finding annotations below. See `docs/partner/options-data/partner-contract-catalog-v2-as-built.md` for the as-built reference.
**Date:** 2026-07-27
**Reviewer:** Cascade
**Fixed point:** `8ffcfe6` (HEAD → prod)
**Scope:** All changed and untracked files in the contract catalog feature
**Spec:** `docs/partner/options-data/contract-catalog-prd.md`

## Changed Files

| File | Status | Lines |
|---|---|---|
| `shared/options/contract-catalog.types.ts` | new | 170 |
| `shared/options/contract-length.utils.ts` | modified | 94 |
| `shared/options/index.ts` | modified | 6 |
| `functions/.../contract-catalog.writer.ts` | new | 152 |
| `functions/.../contract-catalog-query.service.ts` | new | 231 |
| `functions/.../contract-summary-aggregator.service.ts` | new | 83 |
| `functions/.../services/index.ts` | modified | 20 |
| `functions/.../time-series-builder.service.ts` | modified | 359 |
| `functions/.../partner-contract-catalog-partner.ts` | new | 363 |
| `functions/.../partner-request.utils.ts` | new | 64 |
| `functions/scripts/backfill/backfill-contract-catalog.ts` | new | 434 |
| `firestore.indexes.json` | modified | 254 |
| `functions/src/index.ts` | modified | 46 |

---

## Standards Axis

### S1 — `ContractCatalogEntry` duplicates `ContractCatalogDoc` field-by-field (judgement call) — ✅ Addressed

`ContractCatalogEntry` is now `Omit<ContractCatalogDoc, 'lastUpdated'>`. New fields on `ContractCatalogDoc` are automatically included in the API response type.

**Severity:** Low  
**File:** `shared/options/contract-catalog.types.ts:108-122`

### S2 — Partner handler validation block is repetitive (judgement call) — Not addressed

Lines 200-280 of `partner-contract-catalog-partner.ts` follow the same pattern for each param: `if (x === null && req.query.x !== undefined) { res.status(400)... }`. Six nearly identical blocks. Could be extracted into a helper, but the explicitness is arguably readable.

**Severity:** Low  
**File:** `functions/src/v2/partner/partner-contract-catalog-partner.ts:200-280`

### S3 — `contractLengthDays` doc comment says "Calendar days" but JSDoc on `calendarDaysBetween` says "inclusive" (nit) — Not addressed

The `ContractCatalogDoc.contractLengthDays` JSDoc says "Calendar days from `firstObserved` to `expiration`" without specifying inclusive. The `calendarDaysBetween` function comment clarifies inclusive. Minor inconsistency in terminology.

**Severity:** Nit  
**File:** `shared/options/contract-catalog.types.ts:71` vs `shared/options/contract-length.utils.ts:78`

### S4 — Backfill script `existingIds` declared outside loop but only used inside loop (nit) — Not addressed

`let existingIds` is declared before the `for (const symbol of symbols)` loop but is only set and used inside the loop body. Could be scoped inside the loop. Not a bug — just broader scope than needed.

**Severity:** Nit  
**File:** `functions/scripts/backfill/backfill-contract-catalog.ts:333`

### S5 — Module design rules compliance: PASS

- All new writer/service files follow `{domain}-{concern}.writer.ts` / `{domain}-{concern}.service.ts` naming.
- `index.ts` barrel contains only re-exports, zero logic.
- No cross-concern imports between writers.
- No file exceeds 500 lines. Largest is `partner-contract-catalog-partner.ts` at 363 lines.
- Dependency direction follows the PRD's documented DAG.

---

## Spec Axis

### P1 — `expectedObservationCount` treats `minObservationCount` as a range dimension (correct, but PRD §6.5 doesn't list it as one)

The `validateFilterCombination` method in `contract-catalog-query.service.ts` counts `minObservationCount` as a range dimension. The PRD §6.5 lists `strikeGte/Lte`, `deltaGte/Lte`, `ivGte/Lte` as range filters but does not explicitly list `minObservationCount`. However, Firestore treats `>=` as a range filter, so including it is **correct** — it would conflict with other range filters. This is a spec gap, not an implementation bug.

**Severity:** None (implementation is correct, PRD could be clearer)  
**File:** `functions/.../contract-catalog-query.service.ts:195-197`

### P2 — `latest.delta` and `latest.iv` range filters cast numbers to strings (correct per spec)

The query service does `String(filters.deltaGte)` when building the Firestore range filter on `latest.delta`. This is correct because `LatestSnapshot` fields are stored as strings (PRD §5.1: "Why `latest` values are strings"). However, string comparison on numeric strings can produce wrong results for negative numbers (e.g., delta of `-0.50` vs `-1.00` — string comparison would say `-0.50` < `-1.00`). For delta, values are typically `-1.00` to `1.00`, so `-0.50` > `-1.00` lexicographically is actually correct here because `-0` > `-1` in ASCII. But for IV, values like `0.0149` vs `0.100` would compare wrong lexicographically (`0.0149` > `0.100` as strings). This is a **potential bug** if IV range filtering is used with values of different decimal places.

**Severity:** Medium — IV range filters may return incorrect results due to string comparison  
**File:** `functions/.../contract-catalog-query.service.ts:130-135`

### P3 — PRD §8.2 says backfill skips `latest, but backfill script doesn't pass `latestRecord` (correct)

The backfill script calls `catalogWriter.upsertContractCatalog()` without `latestRecord`, so `latest` will be `undefined` in the doc. This matches PRD §8.2: "Skip `latest` during backfill."

**Severity:** None (correct)  
**File:** `functions/scripts/backfill/backfill-contract-catalog.ts:239-246`

### P4 — PRD §7.1 says builder extends step 4 to also upsert catalog doc, but implementation adds a separate `if` block (acceptable)

The builder calls `catalogWriter.upsertContractCatalog()` in a separate `if` block after the index writer call, with its own try/catch. This is slightly different from the PRD's "extend step 4" wording but functionally equivalent and arguably better — a catalog write failure doesn't affect the index write.

**Severity:** None (acceptable deviation)  
**File:** `functions/.../time-series-builder.service.ts:316-330`

### P5 — PRD §6.6 says `pageSize` must be between 1 and 500, but validation allows 0 (minor) — Not addressed

`parseOptionalNonNegativeNumber` allows 0. The query service clamps with `Math.max(filters.pageSize ?? DEFAULT_PAGE_SIZE, 1)`, so a 0 input becomes 1. But the error message says "Expected a non-negative number" rather than "Expected a number between 1 and 500". The PRD says pageSize must be between 1 and 500 — a 0 should probably be a 400 error, not silently clamped to 1.

**Severity:** Low  
**File:** `functions/.../partner-contract-catalog-partner.ts:196` and `functions/.../contract-catalog-query.service.ts:89`

### P6 — `firstObservedDow` and `lastObservedDow` fields not in PRD (scope addition) — ✅ Addressed

PRD §5.1 field table and example doc updated to include `firstObservedDow`, `lastObservedDow`, `latestDelta`, and `latestIv`.

**Severity:** Low (doc gap, not a code issue)  
**File:** `shared/options/contract-catalog.types.ts:58-63`

### P7 — Firestore indexes: PRD §9 lists 8 patterns × 2 directions = 16 indexes. Implementation has 18 indexes (correct)

The implementation adds two extra DESC variants for `expiration + type + strike` and `expiration + contractLengthBucket + strike` that the PRD's table doesn't explicitly list but are implied by "Each index needs both ASC and DESC variants." Count is within the ~200 limit.

**Severity:** None  
**File:** `firestore.indexes.json:70-231`

---

## Thermo-Nuclear Axis

### T1 — IV range filter string comparison bug (structural, not cosmetic) — ✅ Addressed

Added numeric `latestDelta` and `latestIv` top-level fields to `ContractCatalogDoc`. The writer populates them from `record.de` and `record.iv`. The query service uses `latestDelta` and `latestIv` for range filters and `sortBy=delta` sorting instead of the string fields `latest.delta` and `latest.iv`. Firestore indexes updated from `latest.delta` to `latestDelta`.

**Note:** Existing docs in Firestore do not have `latestDelta`/`latestIv` fields until they are rewritten by the builder or a backfill. A backfill or builder run is needed to populate the new fields on existing docs.

**Severity:** High — range filters on IV (and potentially delta) return incorrect results  
**File:** `functions/.../contract-catalog-query.service.ts:124-135`

### T2 — Summary aggregator loads entire subcollection into memory (scaling concern) — Not addressed

`ContractSummaryAggregator.aggregateAndWriteSummary()` does `colRef.get()` — a single fetch of all `ts-contracts` docs for a symbol. With 370K docs at ~200 bytes each (just the fields needed), this is ~74MB of data transferred and held in memory. For QQQ this works, but it's on the edge. A `select()` query (field mask on `contractLengthBucket` and `expiration` only) would reduce payload significantly.

**Recommendation:** Use `colRef.select('contractLengthBucket', 'expiration').get()` to minimize transferred data.

**Severity:** Medium — works now but won't scale if more symbols are added  
**File:** `functions/.../contract-summary-aggregator.service.ts:41`

### T3 — Backfill script: no progress logging during GCS listing phase — Not addressed

The GCS listing phase (`listContractPage` in a while loop) can take several minutes for 370K files. There's no log line between "Listing files with prefix..." and the first batch progress. Adding a periodic log (e.g., every 10K files listed) would help monitor progress.

**Severity:** Low (UX, not correctness)  
**File:** `functions/scripts/backfill/backfill-contract-catalog.ts:368-391`

### T4 — Cursor pagination uses doc ID as cursor, but sort field may not be unique

The query service uses `lastDoc.id` (contract ID) as the `nextPageToken` and does `startAfter(cursorDoc)`. This works correctly because Firestore's `orderBy` implicitly appends `__name__` as a tiebreaker. The cursor fetch (`decodeCursor`) does a full `get()` of the doc by ID, which is an extra read per page. This is acceptable — the alternative (opaque base64 cursor with sort field values) is more complex for minimal gain.

**Severity:** None (correct, acceptable design)  
**File:** `functions/.../contract-catalog-query.service.ts:144-162`

### T5 — Backfill script `repairGcsMetadata` downloads entire file to extract one line — Not addressed

For files with many observations (e.g., 1000+ daily records), the repair function downloads the entire JSONL file just to get `firstObserved`, `lastObserved`, and `observationCount`. This is expensive but only runs once per file with missing metadata. The pilot run showed 0 repairs needed, so this is likely a non-issue in practice.

**Severity:** Low (only impacts files with missing GCS metadata, which appear to be zero)  
**File:** `functions/scripts/backfill/backfill-contract-catalog.ts:141-194`

### T6 — No unit tests (PRD §16.1 calls for them) — Not addressed (deferred per project rules)

The PRD explicitly calls for Jest unit tests for all new services. None were created. The project rules state: "We will not be implementing unit testing yet but will in the future." This is a known gap — flagging for completeness.

**Severity:** Low (deferred per project rules, but PRD should be updated)  
**File:** N/A

---

## Summary

| Axis | Findings | Worst Issue |
|---|---|---|
| **Standards** | 5 (2 low, 2 nit, 1 pass) | S1: Manual interface duplication |
| **Spec** | 7 (1 medium, 3 low, 3 none) | P2: IV range filter string comparison |
| **Thermo-Nuclear** | 6 (1 high, 1 medium, 3 low, 1 none) | T1: IV/delta range filters return incorrect results due to string comparison |

### Recommended Action Items (in priority order)

1. ~~**T1/P2 (High):** Add numeric `latestDelta` and `latestIv` top-level fields to `ContractCatalogDoc` for correct Firestore range queries. Update writer, query service, and types.~~ — ✅ Done
2. ~~**P6 (Low):** Update PRD to document `firstObservedDow` / `lastObservedDow` fields.~~ — ✅ Done (also documented `latestDelta` / `latestIv`)
3. ~~**S1 (Low):** Consider `Omit<ContractCatalogDoc, 'lastUpdated'>` for `ContractCatalogEntry`.~~ — ✅ Done
4. **T2 (Medium):** Use `select()` in summary aggregator to reduce memory/payload. — Not addressed
5. **P5 (Low):** Validate `pageSize >= 1` in the partner handler instead of silently clamping. — Not addressed
