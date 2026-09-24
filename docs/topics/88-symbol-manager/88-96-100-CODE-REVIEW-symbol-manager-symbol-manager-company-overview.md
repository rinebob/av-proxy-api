**Topic:** Add Company Overview Data to Symbol Manager  
**Topic Slug:** symbol-manager-company-overview  
**Thread:** Add Company Overview Data to Symbol Manager  
**Thread Slug:** add-company-overview  
**Issue:** #96 (FE Blueprint)  
**Task:** #100  
**Topic Parent:** #88  
**Domain:** SYMBOL-MANAGER  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

# Code Review — Task #100: companyInfo columns in V2 table

## Scope reviewed

- `src/app/feat/symbol-manager-view/utils/company-info.format.ts` — `orDash`, `formatMarketCap`, `formatBeta`
- `src/app/feat/symbol-manager-view/utils/company-info.format.spec.ts` — 9 Jasmine tests
- `src/app/feat/symbol-manager-view/components/symbol-manager/symbol-manager.component.{ts,html}` — 4 new column defs (after `name`, before `type`); removed region/timezone/currency/matchScore columns per user request

## Findings

### Verified clean

- **Type contract**: capitalized `companyInfo.Sector`/`.Industry` vs lowercase `marketCap`/`beta` — matches `TrackedSymbolCompanyInfo` exactly; `?.` chaining correct for optional `companyInfo`.
- **Column order** matches spec (`displayedV2Columns` array order governs).
- **New formatter vs `AbbreviateCurrencyPipe`**: reuse correctly rejected — the pipe lacks a T tier, uses wrong decimals, returns `'$0'` instead of `'—'`; extending it would fork existing consumers.
- **Column removal**: PRD only *describes* the old columns, doesn't mandate them — user-authorized scope adjustment. No remaining template references; leftover `matchScore`/`region` usages in the search dialog/service are unrelated surfaces.
- **Format semantics**: negative beta renders `-3.18` (correct — prod has negative betas); `≤0`/NaN marketCap → `—`; `0` beta → `0.00` (valid).

### Accepted (documented, non-blocking)

- Dead sort scaffold (`MatSortModule`, `Sort` import, `sortField`/`sortDirection`, `onSortChange`) — deliberately kept: task #101 wires sorting next.
- `formatMarketCap(1_500_000)` → `$2M` (rounds, not truncates) and `$750000` unformatted below 1M — spec-silent edge cases; consistent as written.
- `name`/`type` cells render raw without dash fallback — V2 docs always carry them; minor inconsistency vs the new columns.
- Per-cell formatter calls each CD cycle — ~400 trivial calls worst case at pageSize 100; negligible.
- Pre-existing `console.log`s in component/service — untouched (not this diff).

### Note for #101

TEST-FE §31 and IMPL-FE:42 include `matchScore` in the sort comparator — that column no longer exists; #101's comparator spec needs updating to the new column set.

## Test results

- `company-info.format.spec.ts`: 9/9 Karma tests pass (ChromeHeadless).
- `ng build`: clean.
- UI verified by user in dev preview: real values for ~875 equities, `—` for 48 ETFs.

## Verdict

**PASS**
