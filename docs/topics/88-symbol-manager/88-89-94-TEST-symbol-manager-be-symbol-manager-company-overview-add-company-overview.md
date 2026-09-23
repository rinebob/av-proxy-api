**Topic:** Add Company Overview Data to Symbol Manager  
**Topic Slug:** symbol-manager-company-overview  
**Thread:** Add Company Overview Data to Symbol Manager  
**Thread Slug:** add-company-overview  
**Issue:** #94  
**Thread Parent:** #89  
**Topic Parent:** #88  
**Domain:** SYMBOL-MANAGER  
**Type:** Test Plan (BE)  
**Status:** Draft  
**Created:** 2026-09-20  
**Last Updated:** 2026-09-20  

# Test Plan — BE

## E2E / Verification

- Verify script (per project convention, permanent script under `functions/scripts/verify/`, hits real env, not wired into CI): call `partnerListTrackedSymbolsV2?sortBy=companyInfo.marketCap&sortDirection=desc` and assert NVDA-scale symbols lead the response; repeat for `companyInfo.Sector` asc.
- Run the backfill script with `--dry-run`, then for real on a `--symbols` subset; verify `tracked-symbols/{SYM}` gains numeric `marketCap`/`beta` in the Firebase console or via `getSymbol`.

## Integration Tests

- `listSymbolsV2` with each new whitelisted `sortBy` value produces ordered results (Firestore emulator or verify script); invalid `sortBy` falls back to `symbol`.
- Write-back: a mocked `handler.fetch` producing an overview payload results in `companyInfo.marketCap`/`beta` as **numbers** on the tracked-symbol doc.

## Unit Tests

- AV-string → number parse: `"2512345678901"` → `2512345678901`; `"None"`, `undefined`, `""`, `"abc"` → field omitted; `"0"` → `0` written (falsy-but-valid edge).
- Whitelist: every listed field accepted; `companyInfo.Exchange` (deliberately excluded) falls back to `symbol`; arbitrary strings rejected.
- Backfill parse: existing `symbol-data` doc → correct numeric fields; missing doc skipped; idempotent re-run writes no diff.

## Test Seams

- Highest seam: `listSymbolsV2` / partner endpoint exercised end-to-end (emulator or verify script).
- Lower seams: pure parse function; whitelist validation; backfill transform (doc → write payload) as a pure function.

## Existing Test Coverage

- `functions/tests/v2/partner/` has partner-endpoint contract tests (e.g., `historical-options-partner.test.ts`) — mirror that style for the extended `sortBy` contract.
- Overview handler tests (if present under `functions/tests/v2/alpha-vantage/`) — extend for the write-back fields.

## Edge Cases

- Symbol mid-onboarding: `companyInfo` absent → write-back on first OVERVIEW fetch populates all fields together.
- ETF tracked symbol: no overview doc → backfill skips, sort excludes it from partner-sorted views.
- Overview doc exists but `MarketCapitalization`/`Beta` missing (15 known symbols) → fields omitted, no write of `NaN`.
- `orderBy` on a field with zero matching docs → empty page, not an error.
