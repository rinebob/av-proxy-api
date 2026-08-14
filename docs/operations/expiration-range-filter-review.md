# Code Review: Expiration Range Filtering for `partnerContractCatalogV2`

**Date:** 2026-07-29  
**Reviewer:** Cascade  
**Fixed point:** `HEAD` (commit `981fe25`) — all changes are uncommitted  
**Diff scope:** 3 modified files, 2 new test files

---

## Changed Files

| File | Status | Lines |
|---|---|---|
| `functions/src/v2/historical-options-corpus/services/contract-catalog-query.service.ts` | Modified | 247 total |
| `functions/src/v2/partner/partner-contract-catalog-partner.ts` | Modified | 407 total |
| `firestore.indexes.json` | Modified | 216 total |
| `functions/tests/v2/historical-options-corpus/contract-catalog-query.service.test.ts` | New | 153 |
| `functions/tests/v2/partner/partner-contract-catalog-partner.test.ts` | New | 137 |

---

## Standards

*Does the code conform to this repo's documented coding standards?*

### S1 — Duplicated Code: validation error pattern (judgement call)

**Smell:** Duplicated Code  
**Location:** `partner-contract-catalog-partner.ts:211-227`

The `expirationGte` and `expirationLte` invalid-date validation blocks are near-identical copies of the existing `expiration` validation block at lines 202-209. All three follow the same shape:

```typescript
if (param === null && req.query.param !== undefined) {
  res.status(400).json(errorResponse(
    HistoricalOptionsErrorCode.BAD_REQUEST,
    'Invalid param. Expected YYYY-MM-DD.',
    now,
  ));
  return;
}
```

This pattern is repeated 3× for date params and follows the same shape as the `strike`, `type`, `sortBy`, `sortOrder`, and `pageSize` validators. The handler already has 8+ of these blocks. That said, this is a pre-existing pattern — the diff extends it consistently rather than introducing a new shape. Extracting a helper like `validateDateParam(req, res, 'expirationGte', now)` would reduce repetition, but the project rules say "Prefer the smallest direct change that satisfies the request" and this is an established pattern in the file.

**Verdict:** Judgement call. The duplication is real but consistent with the existing file's style. Not a hard violation.

### S2 — Handler test missing "expected use" and "edge case" tests (hard violation)

**Rule:** `MEMORY[project-rules.md]` Testing section: "Include at least: 1 test for expected use, 1 edge case, 1 failure case."

**Location:** `partner-contract-catalog-partner.test.ts`

The handler test file has 6 tests, all failure cases (400 validation errors). There are zero "expected use" tests (a valid request that returns 200) and zero "edge case" tests (e.g., `expirationGte == expirationLte` for a single-day range, or only `expirationGte` without `expirationLte`). The test file's own comment acknowledges this:

```
// # Reason: "Accepts" tests that pass validation proceed to Firestore I/O.
// Since the handler instantiates ContractCatalogQueryService with the real db,
// we cannot mock Firestore here.
```

The query service test file does cover acceptance cases for `validateFilterCombination`, but the handler-level acceptance path (parsing → validation → queryCatalog → response shaping) is untested.

**Verdict:** Hard violation. The project rules require all three test categories. The handler's dependency injection pattern (`PartnerContractCatalogDependencies`) was designed to enable mocking, but `queryCatalog` is called on a `ContractCatalogQueryService` instantiated with the real `db` inside the handler — making it impossible to mock Firestore without refactoring the handler to accept a query service factory.

### S3 — `any` type in test file (judgement call)

**Rule:** `MEMORY[project-rules.md]` Code Structure: "Follow Angular and Typescript style guides; use type hints."

**Location:** `contract-catalog-query.service.test.ts:26`

```typescript
let service: any;
```

The test accesses a private method (`validateFilterCombination`) via `any`-typed variable. This is a common pattern for testing private methods but bypasses type safety.

**Verdict:** Judgement call. Testing private methods often requires this. The alternative (making the method public or using a test-specific subclass) has its own downsides.

### S4 — JSDoc comments present (standards pass)

**Rule:** `MEMORY[project-rules.md]` Documentation: "Write JSDoc comments for all classes and functions."

The new `expirationGte`/`expirationLte` fields on `CatalogQueryFilters` have JSDoc comments. The inline `# Reason:` comment on the mutual exclusivity check follows the project's "Comment non-obvious code" rule.

**Verdict:** Pass.

### S5 — File size within limits (standards pass)

**Rule:** `MEMORY[project-rules.md]` Code Structure: "Never create a file longer than 500 lines of code."

- `contract-catalog-query.service.ts`: 247 lines
- `partner-contract-catalog-partner.ts`: 407 lines
- Both well under the 500-line limit.

**Verdict:** Pass.

### S6 — Single concern per file (standards pass)

**Rule:** `MEMORY[project-rules.md]` Backend Module Design: "Every Cloud Functions `.ts` file must own exactly one concern."

The changes extend each file within its existing concern:
- `contract-catalog-query.service.ts` — query construction and validation (unchanged concern)
- `partner-contract-catalog-partner.ts` — HTTP handler param parsing and validation (unchanged concern)

No new concerns were introduced into either file.

**Verdict:** Pass.

---

## Spec

*Does the code faithfully implement the originating spec?*

**Spec source:** There is no dedicated PRD or issue for the `expirationGte`/`expirationLte` enhancement. The originating spec is the conversation between the user and Cascade. The existing PRD at `docs/partner/options-data/contract-catalog-prd.md` documents the original `partnerContractCatalogV2` endpoint with `expiration` as an exact-match filter only.

### SP1 — `expirationGte`/`expirationLte` not in PRD §6.2 request parameters table (scope note)

**PRD §6.2** lists `expiration` as "Filter by exact expiration date" with no range variants. The new `expirationGte`/`expirationLte` params are not in the PRD.

This is expected — the enhancement was requested after the PRD was written. The PRD should be updated to document the new params. The as-built doc (`partner-contract-catalog-v2-as-built.md`) should also be updated.

**Verdict:** Not a spec violation (the PRD predates the enhancement), but the PRD is now stale.

### SP2 — PRD §6.5 query constraints table not updated (scope note)

**PRD §6.5** lists `expiration` as an equality filter in the "Allowed combinations" table. The change makes `expiration` usable as both equality (exact `expiration` param) and range (`expirationGte`/`expirationLte`). The constraint table should be updated to reflect that:
- `expiration` (exact) remains an equality filter
- `expirationGte`/`expirationLte` is a range filter, mutually exclusive with `expiration` (exact)
- `expirationGte`/`expirationLte` counts as the one allowed range dimension

**Verdict:** Documentation gap, not a code spec violation.

### SP3 — Moneyness filtering explicitly deferred (spec alignment)

The user explicitly said: "lets stick to the expiration range impl for now we'll come back to moneyness." No moneyness code was implemented. Correct.

**Verdict:** Pass.

### SP4 — Validation requirements implemented correctly (spec pass)

The conversation established these validation rules:
1. ✅ `expirationGte`/`expirationLte` parsed as ISO dates (`YYYY-MM-DD`)
2. ✅ Invalid date format → 400
3. ✅ `expiration` (exact) + `expirationGte`/`expirationLte` (range) → 400 (mutually exclusive)
4. ✅ `expirationGte > expirationLte` → 400
5. ✅ Expiration range counts as one range dimension in `validateFilterCombination`
6. ✅ New params logged in request log
7. ✅ New params passed through to `queryCatalog`

**Verdict:** Pass.

### SP5 — Firestore indexes prepared (spec pass)

The conversation established that composite indexes would be needed. 12 new indexes were added to `firestore.indexes.json` and deployed. Two duplicate indexes (auto-created by Firestore from failed queries) were identified and removed before deployment to avoid 409 conflicts.

**Verdict:** Pass.

### SP6 — Unit tests created (spec partial)

The conversation established that unit tests should be created for both the query service and the handler. Tests were created for both files, but the handler tests only cover failure cases (see S2 above).

**Verdict:** Partial. Coverage is failure-case-only for the handler.

---

## Thermo-Nuclear

*Deep code quality audit following the Whole-Change Protocol.*

### Whole-Change Protocol Execution

**1. Change set inventory:** 3 modified files, 2 new test files. All changes are uncommitted against `HEAD` at `981fe25`.

**2. Feature path trace:**
- Entry: HTTP GET `?symbol=QQQ&expirationGte=2024-01-01&expirationLte=2026-01-01`
- Auth: Existing dual-auth middleware (unchanged) ✓
- Parsing: `parseOptionalDate()` → `string | null` ✓
- Validation: Format, mutual exclusivity, ordering ✓
- Filter validation: `validateFilterCombination` counts expiration as range dimension ✓
- Query: `.where('expiration', '>=', gte)` + `.where('expiration', '<=', lte)` ✓
- Response: Same `ContractCatalogResponse` shape ✓
- Error mapping: 400 for validation, `FilterConflictError` caught in catch block ✓
- Logging: New params in request log ✓
- Indexes: 12 new composite indexes deployed ✓
- Tests: 17 tests, all passing ✓

**3. Whole-file reads:** All 5 files read in full. No transitive consumers of changed public symbols beyond the handler itself (`partnerContractCatalogV2` is the only consumer of `ContractCatalogQueryService` and `CatalogQueryFilters`).

**4. Contract matrix:**

| Aspect | Implementation | Contract | Match? |
|---|---|---|---|
| Input parsing | `parseOptionalDate` returns `string \| null` | Same as existing `expiration` | ✅ |
| Validation: format | `null && query param !== undefined` → 400 | Same pattern as existing | ✅ |
| Validation: mutual exclusivity | `expiration && (expirationGte \|\| expirationLte)` → 400 | New rule, not in PRD | ✅ |
| Validation: ordering | `expirationGte > expirationLte` → 400 | String comparison on ISO dates | ✅ |
| Range dimension counting | `expirationGte \|\| expirationLte` → push 'expiration' | New, consistent with existing pattern | ✅ |
| Query construction | `.where('expiration', '>=', gte)` + `<= lte` | Firestore range on string field | ✅ |
| Response shape | Unchanged `ContractCatalogResponse` | No new fields | ✅ |
| Error envelope | `ContractCatalogErrorResponse` | Same as existing | ✅ |
| Logging | `expirationGte`/`expirationLte` added to request log | Consistent with existing params | ✅ |
| Indexes | 12 new composite indexes | Cover all equality+range+sort combos | ✅ |
| Tests | 11 service + 6 handler = 17 total | Handler missing acceptance tests | ⚠️ |

**5. Final state review:** Reviewing the complete diff, not patch history.

**6. Completion gate:** Build passes (`npm run build` exit 0). Tests pass (17/17). `git diff --check` not run (uncommitted). Deployment of indexes in progress (1 still CREATING).

### T1 — Handler acceptance tests impossible without refactoring (structural finding)

**Priority:** 1 — Structural code-quality regression

The handler instantiates `ContractCatalogQueryService` internally at line 145:

```typescript
const queryService = new ContractCatalogQueryService(db);
```

This makes it impossible to write handler-level acceptance tests without hitting real Firestore. The dependency injection pattern (`PartnerContractCatalogDependencies`) was designed to enable testability, but it only covers `authenticateRequest` and `now` — not the query service.

The test file acknowledges this limitation and gives up on acceptance tests entirely. This means the handler's parsing → validation → queryCatalog → response shaping path is untested at the handler level.

**Remedy:** Add an optional `queryServiceFactory?: () => ContractCatalogQueryService` to `PartnerContractCatalogDependencies`, defaulting to `() => new ContractCatalogQueryService(db)`. Tests can inject a mock factory. This is a small, clean change that completes the DI pattern the handler already started.

### T2 — Validation block ordering is inconsistent (minor structural finding)

**Priority:** 4 — Boundary / legibility concern

The new `expirationGte`/`expirationLte` validation blocks (lines 211-247) are inserted between the `expiration` validation (lines 202-209) and the `strike` validation (lines 249-256). This breaks the visual grouping — previously, all "invalid format" checks were contiguous, then all "range pair" checks were contiguous. Now the mutual-exclusivity check (lines 229-238) and the ordering check (lines 240-247) are interleaved with the format checks.

The existing file has this structure:
```
// Validate individual params  (format checks)
// Validate range pairs         (ordering checks)
```

The diff inserts new format checks + new ordering checks in the middle of the format checks section, then the existing range-pair checks follow. A reader has to scan the entire validation block to find all the ordering checks.

**Remedy:** Move the `expirationGte > expirationLte` check (lines 240-247) down to the "Validate range pairs" section (after line 320), next to the existing `strikeGte > strikeLte` and `deltaGte > deltaLte` checks. Keep the format and mutual-exclusivity checks where they are.

### T3 — String comparison for date ordering works but is not obvious (minor finding)

**Priority:** 7 — Legibility

```typescript
if (expirationGte && expirationLte && expirationGte > expirationLte) {
```

This uses lexicographic string comparison on ISO date strings (`YYYY-MM-DD`). This works correctly for ISO format because the year, month, and day fields are zero-padded and in descending significance order. However, a future reader might not immediately recognize this.

The existing `strikeGte > strikeLte` and `deltaGte > deltaLte` checks use numeric comparison, which is unambiguous. The date comparison is correct but benefits from a brief inline comment.

**Remedy:** Add `// # Reason: ISO date strings sort lexicographically in calendar order.` after the condition.

### T4 — Index coverage analysis (positive finding)

The 12 new indexes cover the following query patterns:

| Equality filters | Range | Sort field | Index exists? |
|---|---|---|---|
| `type` | `expiration` | `expiration` (default) | ✅ type+exp ASC/DESC |
| `type` | `expiration` | `strike` | ✅ type+exp+strike ASC/DESC |
| `type` | `expiration` | `contractLengthDays` | ✅ type+exp+cld ASC/DESC |
| `type` | `expiration` | `observationCount` | ✅ type+exp+obs ASC/DESC |
| `type` | `expiration` | `latestDelta` | ✅ type+exp+delta ASC/DESC |
| `contractLengthBucket` | `expiration` | `expiration` (default) | ✅ (pre-existing, auto-created) |
| `type` + `contractLengthBucket` | `expiration` | `expiration` (default) | ✅ type+clb+exp ASC/DESC |

**Missing coverage (acceptable):**
- `contractLengthBucket` + `expiration` range + sort by `strike`/`delta`/`observationCount`/`contractLengthDays` — not indexed. These queries would fall back to client-side sorting or fail with an index error. This is acceptable given the PRD's §9 note: "Less common query patterns fall back to client-side filtering."
- No `type`-omitted + `expiration` range indexes — when `type` is not specified, Firestore uses the existing `expiration` indexes (lines 7-20 of `firestore.indexes.json`) which don't include a range filter on `expiration`. These queries would need a different index shape. This is a potential runtime gap if a client queries with `expirationGte`/`expirationLte` but no `type` filter.

**Verdict:** Index coverage is thorough for the primary query patterns. The `type`-omitted case may produce index errors at runtime — this should be documented or tested.

### T5 — No structural regression (positive finding)

The changes extend two existing files within their established concerns. No new abstractions, wrappers, or layers were introduced. No file crossed the 500-line limit. The validation pattern, while duplicated (see S1), is consistent with the existing code style. The query service changes are minimal and additive — 3 new fields on an interface, 6 lines of filter application, 3 lines of validation logic.

**Verdict:** No structural regression. The implementation is direct and follows the existing architecture.

---

## Summary

| Axis | Findings | Worst issue |
|---|---|---|
| **Standards** | 6 (1 hard, 2 judgement, 3 pass) | S2 — Handler tests missing "expected use" and "edge case" categories (hard violation of project testing rules) |
| **Spec** | 6 (4 pass, 2 scope notes) | SP6 — Handler test coverage is partial (failure-case only) |
| **Thermo-Nuclear** | 5 (1 structural, 2 minor, 2 positive) | T1 — Handler DI pattern incomplete, making acceptance tests impossible without refactoring |

### Recommended Remediation Plan (consolidated)

1. **T1/S2:** Add `queryServiceFactory` to `PartnerContractCatalogDependencies` → write handler acceptance tests (expected use, edge case, failure case)
2. **T2:** Move `expirationGte > expirationLte` check to the "Validate range pairs" section
3. **T3:** Add inline comment explaining ISO date string comparison
4. **SP1/SP2:** Update PRD §6.2 and §6.5 to document `expirationGte`/`expirationLte` params and constraints
5. **T4:** Document or test the `type`-omitted + expiration range query pattern
