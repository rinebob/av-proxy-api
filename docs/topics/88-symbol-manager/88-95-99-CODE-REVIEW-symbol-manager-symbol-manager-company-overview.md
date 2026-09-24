**Topic:** Add Company Overview Data to Symbol Manager  
**Topic Slug:** symbol-manager-company-overview  
**Thread:** Add Company Overview Data to Symbol Manager  
**Thread Slug:** add-company-overview  
**Issue:** #95 (BE Blueprint)  
**Task:** #99  
**Topic Parent:** #88  
**Domain:** SYMBOL-MANAGER  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

# Code Review — Task #99: companyInfo marketCap/beta backfill

## Scope reviewed

- `functions/src/v2/alpha-vantage/logic/company-info.builder.ts` — `diffCompanyInfoForWrite`
- `functions/tests/v2/alpha-vantage/logic/company-info.builder.test.ts` — 5 diff tests
- `functions/scripts/backfill/backfill-companyinfo-numbers.ts` — one-time migration script
- `functions/scripts/verify/symbol-manager-99-backfill.md` + README index row

## Findings and remediation

### Remediated during review

- Test `as TrackedSymbolCompanyInfo` casts on `Partial` objects — dropped (unnecessary + asserted totality the fixtures don't have).
- `process.exit(1)` in summary/fatal paths → `process.exitCode` (avoids truncating pending stdout; matches `check-company-overview` convention).

### Verified clean

- **Dotted-path updates** (`companyInfo.X` via `update()`): correct Firestore mechanism — merges nested fields without replacing the map; keys come from a fixed whitelist so no path collision; `exists` gate prevents update-on-missing-doc.
- **Init ordering**: `initializeApp({projectId})` runs before the inline `require` of `firebase-admin-init` — `db` binds the explicit app. Minor caveat: `ignoreUndefinedProperties` inside the skipped init block isn't applied — harmless since the diff never emits `undefined`.
- **Idempotency**: re-run writes 0 docs — proven on prod.
- **`_companyInfoLastUpdated` bump**: consistent with handler semantics ("companyInfo map last synced"); no TTL/freshness gate reads the field — verified by grep.
- **update() vs spec "merge"**: spec wording loose; minimal dotted-field update satisfies the intent and avoids rewriting unchanged fields.

### Accepted (documented, non-blocking)

- **Stale-key persistence**: `diffCompanyInfoForWrite` only emits keys present in `built` — a stored value that AV now reports as `"None"` persists on the tracked doc. Divergence vs the handler's wholesale companyInfo write (which clears stale fields). Benign: next live OVERVIEW refresh self-heals.
- **Double-read**: `getTrackedSymbols` fetches all tracked docs for IDs, then each doc is re-fetched — ~924 extra reads on a one-time script. Cosmetic.
- **`null` return** from the diff — technically the null-heavy pattern the guidelines question; `if (!delta)` reads clearly and the alternative (`{}` + size check) is no better.
- Sequential I/O — fine for a one-shot ~900-doc migration.

## Test results

- Builder suite: 15/15 (10 parse + 5 diff).
- Prod run (2026-09-23): dry-run 875 → real run **875 written, 0 errors** → re-run **0 written / 876 already-current** (idempotent). 48 ETFs skipped + reported.
- Post-backfill #98 verify: 10/10 — marketCap desc ordered across the full set, `total=876` (filtered count, not active count).

## Verdict

**PASS**
