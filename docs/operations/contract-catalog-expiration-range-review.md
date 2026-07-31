# Code Review: Contract Catalog Expiration Range & Multi-Bucket Queries

**Review date:** 2026-07-31  
**Commits in scope:** Commit 1 (BE-FEAT-CONTRACT-CATALOG) + Commit 2 (CONFIG-CONTRACT-CATALOG)  
**Fixed point:** `a9871ed` (origin/prod)  
**Review axes:** Standards, Spec, Thermo-Nuclear  

---

## Files in scope

| File | Lines | Concern |
|---|---|---|
| `shared/options/contract-catalog.types.ts` | 170 | Type definitions |
| `shared/options/contract-length.utils.ts` | 105 | Bucket label constants |
| `functions/src/v2/historical-options-corpus/services/contract-catalog-query.service.ts` | 265 | Firestore query builder |
| `functions/src/v2/historical-options-corpus/services/contract-summary-aggregator.service.ts` | 101 | Summary aggregation |
| `functions/src/v2/partner/partner-contract-catalog-partner.ts` | 388 | HTTP handler |
| `functions/scripts/backfill/backfill-contract-catalog.ts` | 431 | Backfill script (1-line change) |
| `docs/partner/options-data/contract-catalog-prd.md` | 570 | PRD / spec |
| `firestore.indexes.json` | 106 | Composite index definitions |
| `firestore.indexes.README.md` | 115 | Index documentation |
| `functions/tests/v2/historical-options-corpus/contract-catalog-query.service.test.ts` | 160 | Query service tests |
| `functions/tests/v2/partner/partner-contract-catalog-partner.test.ts` | 327 | Handler tests |

**Standards sources:** `.devin/skills/rel-str-coding-guidelines.md`, project rules in user memory (500-line limit, single concern per file, barrel exports, no cross-concern imports).  
**Spec source:** `docs/partner/options-data/contract-catalog-prd.md`

---

## Standards Axis

### S1 — PRD examples not updated for `LengthBucketEntry[]` (hard violation)

**Problem:** The `ContractSummaryDoc.lengthBuckets` field changed from `Record<string, number>` to `LengthBucketEntry[]`. The PRD was updated for new params (expirationGte/Lte, multi-bucket) but the JSON examples in §5.2 (line 128) and §6.3 (line 195) still show the old object format:

```json
"lengthBuckets": {
  "1d": 8, "3d": 15, "5d": 22, ...
}
```

The actual response now returns:

```json
"lengthBuckets": [
  { "label": "1d", "count": 8, "sortOrder": 0 },
  { "label": "3d", "count": 15, "sortOrder": 1 },
  ...
]
```

This violates the project rule: "Update README.md when new features are added, dependencies change, or setup steps are modified." The PRD is the spec document for this feature and its examples must match the implementation.

**Fix:** Update the JSON examples in PRD §5.2 and §6.3 to show the `LengthBucketEntry[]` array format.

---

### S2 — PRD §3 Goals not updated for `expirationGte`/`expirationLte` (hard violation)

**Problem:** PRD §3 Goals (line 31) still reads:

> Enable filtering by: `expiration`, `strike`, `type`, `contractLengthBucket`, `deltaGte/deltaLte`, `ivGte/ivLte`, `minObservationCount`.

The new `expirationGte`/`expirationLte` range filter is not mentioned. §6.2 and §6.5 were updated, but the goals section was missed.

**Fix:** Add `expirationGte/expirationLte` to the filter list in §3.

---

### S3 — `LengthBucketEntry.sortOrder` is redundant (judgement call — Speculative Generality)

**Problem:** The `sortOrder` field on `LengthBucketEntry` is the zero-based index from `LENGTH_BUCKET_LABELS`. The aggregator iterates `LENGTH_BUCKET_LABELS` in canonical order and only includes buckets with count > 0, so the output array is already pre-sorted by contract length. Array position gives the same information as `sortOrder`.

This is a Fowler Speculative Generality smell — a field added for a need the spec doesn't have. No consumer currently relies on `sortOrder` for re-sorting.

**Fix:** Remove `sortOrder` from `LengthBucketEntry`. Consumers can use array index if they need the canonical position. If a future consumer needs to re-sort, reintroduce it then.

---

### S4 — Non-null assertion on `LENGTH_BUCKET_SORT_INDEX.get(label)!` (judgement call — type boundary)

**Problem:** In `contract-summary-aggregator.service.ts:75`:

```typescript
sortOrder: LENGTH_BUCKET_SORT_INDEX.get(label)!,
```

The `!` silences the type checker. While this is safe (the label comes from `LENGTH_BUCKET_LABELS` which is derived from the same source as `LENGTH_BUCKET_SORT_INDEX`), it violates the spirit of the coding guidelines §5: "Do not use `any` index signatures to hide shape mismatches." The non-null assertion is a similar pattern — silencing a type checker when the invariant could be made explicit.

**Fix:** If `sortOrder` is kept, use a helper that returns a guaranteed number:

```typescript
function bucketSortIndex(label: string): number {
  return LENGTH_BUCKET_SORT_INDEX.get(label) ?? -1;
}
```

Or, if S3 is accepted and `sortOrder` is removed, this finding is moot.

---

## Spec Axis

### SP1 — Missing Firestore index for `expirationGte + expirationLte + sortBy=strike DESC` (hard)

**Problem:** PRD §6.5 lists allowed combinations including `expirationGte + expirationLte + type + sort by strike`. The without-`type` variant (`expirationGte + expirationLte + sortBy=strike`) is also a valid query per the spec.

When `expirationGte`/`expirationLte` is used without `contractLengthBucket`, the query service prepends `orderBy('expiration', 'asc')` then adds the user's `orderBy('strike', sortOrder)`. For `sortOrder=desc`, this requires the composite index:

```
(expiration ASC, strike DESC, __name__ DESC)
```

This index is **not** in `firestore.indexes.json` and is **not** in the deployed indexes listed in `firestore.indexes.README.md`. The deployed index `(expiration ASC, strike ASC, __name__ ASC)` covers the ASC variant only.

Firestore will auto-create this index from the first failed query, but the query will return 500 until the index is READY (several minutes on 370K+ docs). The PRD §9 and the README both note this pattern.

**Fix:** Add `(expiration ASC, strike DESC, __name__ DESC)` to `firestore.indexes.json` and document it in the README. Alternatively, document that this query pattern requires auto-creation and is not pre-indexed.

---

### SP2 — PRD examples not updated for `LengthBucketEntry[]`

**Same as S1.** From the spec axis: the implementation's response schema does not match the documented response schema in PRD §5.2 and §6.3.

---

### SP3 — PRD §3 Goals not updated

**Same as S2.** From the spec axis: the spec's goals section does not mention the new `expirationGte`/`expirationLte` filtering capability.

---

### SP4 — Breaking schema change to `lengthBuckets` not documented in PRD (hard)

**Problem:** The `lengthBuckets` field on `ContractSummaryDoc` and `ContractSummaryResponse` changed from `Record<string, number>` to `LengthBucketEntry[]`. This is a **breaking change** to the API response shape. Any consumer expecting `summary.lengthBuckets["3mo"]` will break because the field is now an array of objects.

The PRD does not flag this as a breaking change, note a migration path, or mention the schema change at all. The PRD §5.2 example still shows the old format (see S1). The PRD §10 discusses migration paths for `contractIds[]` deprecation but says nothing about the `lengthBuckets` shape change.

While there may be no existing consumers yet (endpoint not deployed), the spec should still document breaking changes for future reference.

**Fix:** Add a note to PRD §5.2 and §6.3 documenting the schema change from `Record<string, number>` to `LengthBucketEntry[]`, including the rationale (pre-sorted array enables ordered UI rendering without client-side sorting).

---

## Thermo-Nuclear Axis

### T1 — Missing Firestore index

**Same as SP1.** From the thermo-nuclear axis: the index coverage has a gap for a valid query pattern. The contract matrix (PRD §6.5 allowed combinations vs. `firestore.indexes.json` index definitions) has a mismatch.

---

### T2 — PRD examples not updated

**Same as S1/SP2.** From the thermo-nuclear axis: the contract matrix (PRD §5.2/§6.3 response examples vs. `ContractSummaryDoc`/`ContractSummaryResponse` types) has a mismatch.

---

### T3 — `LengthBucketEntry.sortOrder` redundancy

**Same as S3.** From the thermo-nuclear axis: speculative generality — a field that adds no information the array position doesn't already provide. The cleaner design deletes the field entirely.

---

### T4 — Breaking schema change not documented

**Same as SP4.** From the thermo-nuclear axis: the contract matrix between the PRD's response examples and the actual TypeScript types has a mismatch. The Whole-Change Protocol requires comparing runtime behavior, shared types, and public documentation for response schema — this mismatch is a finding.

---

### T5 — Handler file approaching 400-line threshold (judgement call)

**Problem:** `partner-contract-catalog-partner.ts` is 388 lines. The project guidelines say "Target under 300 lines per file. If a file crosses 400 lines, treat as a strong smell." The file is 12 lines from the threshold.

The `requireValidParam` (lines 105-122) and `requireRangeOrder` (lines 129-145) helpers are ~45 lines of generic validation utilities that don't depend on any catalog-specific state. Moving them to `partner-request.utils.ts` would bring the handler to ~343 lines.

However, the guidelines also say "Do not define a generalized abstraction for one caller." These helpers currently have only one consumer. This is a tradeoff between file size and premature abstraction.

**Fix:** Acceptable as-is for now. When a second partner endpoint needs these helpers, extract them to `partner-request.utils.ts` at that time. Monitor the file size — any further additions should trigger extraction.

---

### T6 — No test coverage for summary response with `LengthBucketEntry[]` format (judgement call)

**Problem:** The test suite covers `getActiveRangeDimensions` (query service) and the catalog handler's param validation (expiration range, multi-bucket, mutual exclusivity). However, there is no test verifying that the summary response returns the new `LengthBucketEntry[]` format. The `ContractSummaryAggregator` is not tested at all.

The PRD §16 defers unit testing ("Deferred per project rules"), but the project rules also say "Create full unit tests for all new features" and "Include at least: 1 test for expected use, 1 edge case, 1 failure case." The new `LengthBucketEntry[]` format is an untested schema change.

**Fix:** Add a test for `ContractSummaryAggregator.aggregateAndWriteSummary` that verifies the `lengthBuckets` array is correctly ordered and contains only buckets with count > 0. Add a handler test for `?summary=true` that verifies the response shape matches `ContractSummaryResponse` with `LengthBucketEntry[]`.

---

## Summary

| Axis | Findings | Worst issue |
|---|---|---|
| Standards | 4 (2 hard, 2 judgement) | S1 — PRD examples don't match implementation (hard) |
| Spec | 4 (2 hard, 2 duplicates) | SP1 — Missing Firestore index for valid query pattern (hard) |
| Thermo-Nuclear | 6 (2 hard, 4 judgement) | T1/SP1 — Missing index; T4/SP4 — Undocumented breaking schema change |

**Unique findings (de-duplicated):** 7 total

### Remediated
- **S1/SP2/T2** (hard) — PRD §5.2 & §6.3 examples updated to `LengthBucketEntry[]` format ✅
- **S2/SP3** (hard) — PRD §3 Goals updated with `expirationGte/expirationLte` ✅
- **SP4/T4** (hard) — Breaking schema change documented in PRD §5.2 ✅
- **S4** (judgement) — Non-null assertion replaced with `?? -1` fallback ✅
- **T6** (judgement) — Tests added for aggregator and handler summary response ✅

### Declined / Deferred
- **S3/T3** (judgement) — `sortOrder` kept; user confirmed it's for consumers
- **SP1/T1** (hard) — Index not needed; user confirmed sorting is handled in frontend consumers
- **T5** (judgement) — Handler file size; deferred to later
