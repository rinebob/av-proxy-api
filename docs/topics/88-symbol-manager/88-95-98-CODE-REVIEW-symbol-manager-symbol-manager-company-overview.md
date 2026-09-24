**Topic:** Add Company Overview Data to Symbol Manager  
**Topic Slug:** symbol-manager-company-overview  
**Thread:** Add Company Overview Data to Symbol Manager  
**Thread Slug:** add-company-overview  
**Issue:** #95 (BE Blueprint)  
**Task:** #98  
**Topic Parent:** #88  
**Domain:** SYMBOL-MANAGER  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

# Code Review — Task #98: sortBy whitelist + composite indexes

## Scope reviewed

- `shared/alpha-vantage/av-symbol-search.ts` — `TRACKED_SYMBOL_SORTABLE_FIELDS`, `TrackedSymbolSortableField`, `resolveTrackedSymbolSortField`; `ListSymbolsOptions.sortBy` widened to `string`
- `functions/src/v2/alpha-vantage/services/symbol-manager.service.ts` — resolver + `sortDirection` clamp
- `functions/src/v2/partner/tracked-symbols-partner.ts` — doc-comment updated
- `firestore.indexes.json` — 24 tracked-symbols composite entries (5 companyInfo + 7 scalar fields, ASC/DESC pairs)
- `functions/tests/v2/alpha-vantage/services/symbol-manager-sort.test.ts` — 10 tests
- `functions/scripts/verify/symbol-manager-98-sortable-fields.{ts,md}` + README/run-all entries

## Findings and remediation

### HIGH — scalar sort fields were advertised but unindexed (fixed)

The 12-field whitelist includes `name`, `type`, `region`, `currency`, `_createdAt`, `_lastUpdated` — but composites were only added for `companyInfo.*`. `where(_isActive).orderBy(name)` → FAILED_PRECONDITION. Pre-existing (old code accepted them equally), but the new whitelist + partner doc-comment made it a *documented* contract. Remediated: 13 composite indexes created via gcloud (file-based deploy is broken by prod drift — see below) and all 14 scalar pairs added to `firestore.indexes.json` as canonical truth. Verified: `name` asc and `symbol` desc sort correctly on prod.

**Side discovery:** prod has 65+ indexes not tracked in `firestore.indexes.json`, and `firebase deploy --only firestore:indexes` 409s on identical existing indexes (it does not skip them). File-based index deploy is currently broken project-wide until the file is reconciled with prod — flagged for triage, out of scope.

### LOW — remediated

- `sortDirection` unvalidated (`as 'asc'|'desc'` cast → junk reaches orderBy) → clamped to `'desc' | 'asc'`.
- `sortBy as string` cast in resolver → removed via truthy-narrowing.

### LOW — accepted / documented

- Whitelist narrowing: previously-accepted-but-non-sortable fields (`matchScore`, `timezone`, etc.) now fall back to `symbol`. No caller uses them (FE hardcodes `symbol`, partner passthrough is raw); partner doc-comment notes the fallback.
- `sortBy?: string` keeps the HTTP boundary honest (invalid values must reach the resolver); `TrackedSymbolSortableField` remains available for typed callers.
- `require()`-after-init in verify script — justified: `firebase-admin-init` self-initializes on import; explicit `projectId` init must precede it.

### Pre-existing bugs noticed (not this diff, flagged for triage)

- `countActiveSymbols`/`cleanupInactiveSymbols` query `isActive`/`lastUpdated` — wrong field names (real: `_isActive`/`_lastUpdated`); those methods have never worked correctly.
- `firestore.indexes.json` vs prod drift (65 untracked indexes; deploy 409s).

## Round 2 (final state)

### HIGH — `total` overcounted sparse-field sorts (fixed)

`count()` ran on the unordered query, but `orderBy(companyInfo.X)` drops docs lacking the field — `total` reported the active-doc count, not the result count. Fixed: the count query now carries the same `orderBy`, so existence filtering applies to `total` too. Verified on prod: `sortBy=companyInfo.marketCap` returns `total=1` matching the single populated doc (was ~921 before).

### LOW — remediated

- Partner handler `(q.sortBy as any)` casts → `as string` / `as 'asc'|'desc'` (clamping still centralizes in the service).
- `as any` → `TrackedSymbolV2`-adjacent maps in verify script noted; kept `any` callbacks as script-acceptable.
- Verify script now asserts `total === symbols.length` when the filtered set fits the page, and warns when sparse coverage (<3 docs) makes ordering checks weak — covers the pre-backfill state until #99 lands.

### Axes summary

- **Standards:** PASS — whitelist exact, indexes match query shape + file conventions, resolver cast-free, tests iterate the real const.
- **Spec:** all 5 ACs met; scalar indexes judged *beneficial scope* (honest fulfillment of the advertised whitelist), not creep; sortDirection clamping is spec-permitted.
- **Thermo-nuclear:** approve — adding indexes over trimming the whitelist endorsed; whitelist kept as explicit enumeration (sort contract ≠ storage schema).

### Pre-existing (flagged for triage, not this diff)

- `countActiveSymbols`/`cleanupInactiveSymbols`/`removeSymbol` use `isActive`/`lastUpdated` — wrong field names vs `_isActive`/`_lastUpdated`; likely never worked correctly.
- `getSymbol` returns `id` on a type that lacks it (masked by cast).
- `_fallbackCount` reads all doc IDs unbounded; `limit`/`offset` unvalidated in the service (internal-only exposure).
- `firestore.indexes.json` ↔ prod drift: 65+ untracked indexes; file deploy 409s on identical existing indexes — needs a reconciliation task.

## Test results

- New suite: 10/10 green.
- Full suite: 461/467 — same 6 pre-existing `contract-summary-aggregator` failures.
- Prod verification: 10/10 checks, incl. corrected `total` semantics.
- `tsc --noEmit`: clean.
- Indexes: all 24 tracked-symbols composites READY in prod (10 companyInfo via file deploy, 14 scalar via gcloud — all documented in the file).

## Verdict

**PASS**
