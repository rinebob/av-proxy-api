# Verification Guide: Task #98 — listSymbolsV2 sortBy whitelist + composite indexes

## Scripts

### symbol-manager-98-sortable-fields.ts

**Purpose:** Verifies the sorting pipeline end-to-end against prod Firestore via the real `SymbolManagerService.listSymbolsV2` (the same call `partnerListTrackedSymbolsV2` makes): the new `companyInfo.*` sort fields resolve through the whitelist, execute against the deployed composite indexes, and return correctly ordered results.

**Pipeline stages verified:**
- Validation: `resolveTrackedSymbolSortField` accepts whitelisted `companyInfo.*` paths, falls back to `symbol` for invalid input
- Query: real `orderBy(companyInfo.X)` executes (fails loudly if the composite index is missing or still building)
- Ordering: numeric desc ordering for `marketCap`, numeric asc for `beta`
- Fallback: invalid `sortBy` produces `symbol`-ordered results
- Existence filter: docs lacking the sort field are omitted from ordered results (documented behavior)

**Prerequisite:** composite indexes deployed (`firebase deploy --only firestore:indexes`) and built — freshly deployed indexes can take several minutes to become usable.

**Command:**
```bash
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/symbol-manager-98-sortable-fields.ts
```

**Arguments:** none.

**What it checks (10 checks):**
1. Resolver accepts `companyInfo.marketCap`
2. Resolver falls back to `symbol` for invalid input
3. `marketCap` desc query returns results
4. All returned docs have numeric `marketCap` (existence filter)
5. `total` matches the filtered result count (orderBy existence-filter applies to count, not just the page)
6. `marketCap` desc results are numerically ordered
7. `beta` asc results are numerically ordered
8. Invalid `sortBy` produces symbol-ordered results; `companyInfo.Sector` asc returns results
9. `name` asc sorts correctly through its composite index
10. `symbol` desc sorts correctly through its composite index

**Passing result:** All checks print `PASS:`, ends with `=== All verification checks passed ===`, exits 0.

**Failing result:** `FAIL:` + exit 1. If the failure says "index is currently building", wait and re-run — composite indexes take minutes to build after deploy.

**Setup/teardown:** None. Read-only — no writes to prod.
