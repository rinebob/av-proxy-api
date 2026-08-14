# Code Review: Multi-Value `contractLengthBucket` + Expiration Range Filtering

**Date:** 2026-07-29
**Fixed point:** `HEAD` (`981fe25`)
**Diff scope:** 6 modified files + 2 new test files (untracked)

## Changed Files

| File | Status | Lines changed |
|---|---|---|
| `functions/src/v2/historical-options-corpus/services/contract-catalog-query.service.ts` | Modified | +53 |
| `functions/src/v2/partner/partner-contract-catalog-partner.ts` | Modified | +163/-94 |
| `docs/partner/options-data/contract-catalog-prd.md` | Modified | +23 |
| `firestore.indexes.json` | Modified | -39 (removed duplicates) |
| `firestore.indexes.README.md` | Modified | +118/-66 |
| `.gitignore` | Modified | 1 line |
| `functions/tests/v2/historical-options-corpus/contract-catalog-query.service.test.ts` | New | 168 lines |
| `functions/tests/v2/partner/partner-contract-catalog-partner.test.ts` | New | 296 lines |

---

## Standards

### Hard Violations

**S1. `.gitignore` un-ignores `.devin/skills/` — unrelated to this feature**
`.gitignore` line 108 changed from `-.devin/skills/**/*` to `+#.devin/skills/**/*`. This un-ignores the entire `.devin/skills/` directory, which contains 20+ untracked skill directories. This change is unrelated to the contract catalog feature and would add massive noise to the commit. **Action:** Revert this line or move to a separate commit.

**S2. No validation of bucket label values (PRD §6.6 violation)**
`parseOptionalBucketList` at `partner-contract-catalog-partner.ts:85-89` explicitly states "Does not validate individual labels — that is the caller's responsibility." But the caller (the handler) never validates them either. Invalid labels like `contractLengthBucket=foo,bar` pass through to Firestore's `in` operator and return empty results instead of a `400` error. PRD §6.6 states: "`contractLengthBucket`, if supplied, must be one or more comma-separated bucket labels from the defined set." **Action:** Add validation against the known bucket label set, returning `400` for invalid labels.

### Judgement Calls (Baseline Smells)

**S3. Duplicated Code — range dimension detection logic appears twice**
`getRangeField` (lines 210-217) and `validateFilterCombination` (lines 223-249) in `contract-catalog-query.service.ts` check the exact same conditions on `CatalogQueryFilters` but return different representations. They also use inconsistent names for the same dimensions: `getRangeField` returns `'latestDelta'` while `validateFilterCombination` pushes `'delta'`; `getRangeField` returns `'latestIv'` while `validateFilterCombination` pushes `'iv'`. A single `getActiveRangeDimensions()` method returning `string[]` could serve both callers, eliminating the risk of one being updated without the other.

**S4. Duplicated Code — `requireValidParam` / `requireRangeOrder` pattern repeats 10+ times**
The handler uses `requireValidParam` 8 times and `requireRangeOrder` 4 times in sequence. While the extraction is an improvement over the previous inline blocks, the pattern still results in a long sequential validation chain. This is acceptable for now but is approaching the point where a validation schema or declarative validator would be cleaner.

---

## Spec

### Requirements Implemented Correctly

- **`expirationGte`/`expirationLte` parameters:** Added, parsed, validated (format, mutual exclusivity with `expiration`, range ordering). ✅
- **Firestore `orderBy` fix:** Range-filtered field is now prepended as first `orderBy` when `sortBy` differs. ✅
- **Multi-value `contractLengthBucket`:** Comma-separated parsing, Firestore `in` operator for multiple values, `==` for single. ✅
- **PRD §6.2 updated:** Documents comma-separated format and `in` operator. ✅
- **PRD §6.5 updated:** Clarifies `contractLengthBucket` uses `in` operator (equality, not range). ✅
- **PRD §6.6 updated:** Validation rule updated for multi-value. ✅
- **Firestore indexes:** 5 new indexes for `type`-omitted + expiration range + sort deployed. Duplicate indexes removed from `firestore.indexes.json`. ✅
- **Tests:** 24 tests covering validation, acceptance, edge cases, and multi-value bucket parsing. ✅
- **Dependency injection:** `queryServiceFactory` added for handler testability. ✅

### Missing or Partial

**SP1. No validation of bucket label values against the defined set**
PRD §6.6: "`contractLengthBucket`, if supplied, must be one or more comma-separated bucket labels from the defined set." The code does not validate individual labels. Invalid labels silently return empty results instead of `400`. **Severity:** Medium — spec explicitly requires validation.

**SP2. Missing Firestore indexes for `contractLengthBuckets` (in) + `expirationGte/Lte` + sort by non-expiration field**
PRD §6.5 lists `expirationGte + expirationLte + contractLengthBucket + sort by expiration` as allowed. But the code also allows `contractLengthBuckets + expirationGte/Lte + sortBy=strike` (or any other sort field). This combination requires indexes like `(contractLengthBucket ASC, expiration ASC, strike ASC, __name__ ASC)`, which are NOT deployed. This is a pre-existing gap (single `contractLengthBucket == X` has the same issue), but the multi-value feature doesn't fix it. **Severity:** Low — only affects a combination not explicitly listed in the PRD's allowed combinations table. Firestore will auto-create the index on first failed query, but the first request will 500.

### Scope Creep

**SP3. `.gitignore` change is unrelated to this feature**
The `.gitignore` modification un-ignores `.devin/skills/`. This is not part of the contract catalog feature and should be reverted or moved to a separate commit.

---

## Thermo-Nuclear

### Structural Findings

**T1. Range dimension detection duplicated — `getRangeField` and `validateFilterCombination` check the same conditions**
`contract-catalog-query.service.ts` lines 210-217 and 223-249. Both methods iterate the same five range-dimension checks on `CatalogQueryFilters`. They use inconsistent dimension names (`'latestDelta'` vs `'delta'`, `'latestIv'` vs `'iv'`), making the duplication less obvious and creating a maintenance hazard. If a new range dimension is added, both methods must be updated in sync.

**Recommended remedy:** Extract a single `private getActiveRangeDimensions(filters: CatalogQueryFilters): Array<{ dimension: string; fieldPath: string }>` method. `validateFilterCombination` checks `length > 1` on the dimension names. `getRangeField` returns `dimensions[0]?.fieldPath ?? null`. This deletes the duplicated condition chain and the naming inconsistency.

**T2. `parseOptionalBucketList` lacks label validation — silently passes invalid values to Firestore**
`partner-contract-catalog-partner.ts:85-89`. The function's JSDoc explicitly defers validation to "the caller's responsibility," but no caller validates. This is not a stylistic nit — it's a missing validation step that allows malformed requests to reach Firestore and return empty results instead of a clear `400` error. The valid bucket labels are known at compile time from `contract-length.utils.ts` (`LENGTH_BUCKETS`), but that array is not exported.

**Recommended remedy:** Export the valid bucket label set from `shared/options/contract-length.utils.ts` and validate each parsed value in the handler, returning `400` for unknown labels.

**T3. Missing indexes for `contractLengthBuckets` (in) + expiration range + non-expiration sort**
When a user sends `contractLengthBucket=3mo,6mo&expirationGte=2025-01-01&sortBy=strike`, the Firestore query needs index `(contractLengthBucket ASC, expiration ASC, strike ASC, __name__ ASC)`. This index is not deployed and not in `firestore.indexes.json`. The first request hitting this combination will 500 until Firestore auto-creates the index (minutes on 370K+ docs). The 5 new indexes in `firestore.indexes.json` only cover `expiration` range + sort without `contractLengthBucket` equality.

**Severity:** Low — the combination is allowed by the code but not explicitly listed in the PRD's allowed combinations. The pre-existing single-value `contractLengthBucket` has the same gap. No action needed unless this combination is expected to be common.

### Positive Observations

- **`requireValidParam` and `requireRangeOrder` extraction** is a clean simplification — it replaced 90+ lines of repeated inline error blocks with two reusable helpers. Good code judo.
- **`queryServiceFactory` DI pattern** is a minimal, clean testability improvement that doesn't add unnecessary indirection.
- **`getRangeField` + orderBy prepend** is the correct fix for the Firestore `FAILED_PRECONDITION` error. The comment explaining why is valuable.
- **Test coverage** is thorough: validation errors, acceptance paths, edge cases (single-day range, open-ended range, whitespace trimming, multi-value buckets).
- **File sizes** are well within limits: handler is 376 lines, query service is 274 lines.
- **No abstraction leaks** — the handler owns HTTP parsing/validation, the service owns Firestore query construction. Clean boundary.

### Approval Bar Assessment

- **No structural regression** — the change improves the handler's organization.
- **No file-size explosion** — both files are well under 500 lines.
- **No spaghetti growth** — the validation chain is sequential but clean.
- **One missed simplification** — `getRangeField` / `validateFilterCombination` duplication (T1).
- **One missing validation** — bucket label validation (T2/SP1).
- **One unrelated change** — `.gitignore` (S1/SP3).

---

## Summary

| Axis | Findings | Worst issue |
|---|---|---|
| Standards | 4 (1 hard, 3 judgement) | S1: `.gitignore` un-ignores `.devin/skills/` (hard, unrelated) |
| Spec | 3 (1 missing, 1 partial, 1 scope creep) | SP1: No bucket label validation per PRD §6.6 |
| Thermo-Nuclear | 3 findings | T1: Duplicated range-dimension detection logic |

**Recommended actions before commit:**
1. Revert `.gitignore` change (S1/SP3)
2. Add bucket label validation against the known set (S2/SP1/T2)
3. Consider extracting `getActiveRangeDimensions()` to eliminate duplication (T1) — optional, not a blocker
