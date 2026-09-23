**Topic:** Add Company Overview Data to Symbol Manager  
**Topic Slug:** symbol-manager-company-overview  
**Thread:** Add Company Overview Data to Symbol Manager  
**Thread Slug:** add-company-overview  
**Issue:** #94  
**Thread Parent:** #89  
**Topic Parent:** #88  
**Domain:** SYMBOL-MANAGER  
**Type:** Test Plan (FE)  
**Status:** Draft  
**Created:** 2026-09-20  
**Last Updated:** 2026-09-20  

# Test Plan — FE

## E2E User Journeys

- User opens Symbol Manager → four new columns render with real values for equities, `—` for ETFs/mid-onboarding symbols.
- User clicks Market Cap header → full list reorders desc (largest first); clicks again → asc; page 2 continues the ranking.
- User filters via the search box while a sort is active → sort holds over the filtered subset.

## Integration Tests

- Component + store: `v2Symbols` patched with mixed `companyInfo` presence → `displayedSymbols` renders correct page slice after sorting.
- Store: `v2Total` populated from `ListSymbolsV2Response.total`; banner condition `v2Total > v2Symbols.length`.

## Unit Tests

- Market-cap formatter: `5150000000000` → `$5.15T`; `980600000000` → `$980.6B`; `43466100` → `$43M`; `undefined`/`null`/`0`/negative → `—`.
- Beta formatter: `2.202` → `2.20`; `undefined` → `—`.
- Comparator: numeric vs string columns; nested `companyInfo.*` access; **missing values always last** in both directions; tiebreak on `symbol`; `matchScore` compares numerically.

## Test Seams

- Highest seam: component test harness (TestBed) driving `matSortChange` events against a stubbed store — verifies sort + pagination compose.
- Lower seams: pure formatter and comparator functions — fast, deterministic.

## Existing Test Coverage

- No existing specs under `symbol-manager-view` — this introduces the first; keep them colocated (`*.spec.ts` beside source) matching the repo's test style.

## Edge Cases

- Empty state, loading state, error banner — unchanged.
- Symbol search result active (`v2SymbolSearchResult` single-row view) — sorting a 1-row list is a no-op, must not error.
- All-`—` column (no data backfilled yet): sorting by that column is stable and harmless.
- Rapid sort toggles: computed re-evaluation only, no requests fired.
