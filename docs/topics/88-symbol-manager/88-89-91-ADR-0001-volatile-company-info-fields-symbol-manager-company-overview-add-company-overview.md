**Topic:** Add Company Overview Data to Symbol Manager  
**Topic Slug:** symbol-manager-company-overview  
**Thread:** Add Company Overview Data to Symbol Manager  
**Thread Slug:** add-company-overview  
**Issue:** #91  
**Thread Parent:** #89  
**Topic Parent:** #88  
**Domain:** SYMBOL-MANAGER  
**Type:** ADR  
**Status:** Draft  
**Created:** 2026-09-20  
**Last Updated:** 2026-09-20  

# ADR 0001 — Allow volatile numeric fields (`marketCap`, `beta`) in `companyInfo`

## Context

`TrackedSymbolCompanyInfo` was deliberately limited to stable, slowly-changing identity/classification fields (name, sector, industry, exchange, country, CIK, etc.). Volatile fundamentals were explicitly excluded and kept only in `symbol-data` — the rationale was that denormalized fields should not need frequent rewriting.

Symbol Manager requires sorting tracked symbols by market cap and beta. Firestore cannot sort by a field that is not on the document being queried, and cannot join to `symbol-data`. The only way to make these sorts server-side (required, because pagination is server-side) is to denormalize them onto `tracked-symbols`.

## Decision

Add two **numeric** fields to the `companyInfo` write-back in the company-overview handler: `marketCap` (parsed from `MarketCapitalization`) and `beta` (parsed from `Beta`). Both are strings in the AV payload; they are stored as numbers because Firestore sorts strings lexicographically, which would produce wrong ordering.

Accepted consequence: both fields are only as fresh as the symbol's last OVERVIEW refresh (TTL ~7–30 days). Sorted order is therefore approximate — deemed acceptable because relative ordering by market cap and beta rarely shifts materially within the TTL window.

## Considered Options

- **Keep `companyInfo` stable-only; join at query time** — rejected: Firestore has no joins; sorting by a `symbol-data` field is impossible without denormalizing.
- **Store the raw AV strings** — rejected: lexicographic ordering is wrong for numeric magnitudes (`"9B" > "10B"`).
- **Recompute market cap from price × shares** — rejected: adds a dependency on daily bars and introduces split-adjustment coupling; the provider's figure is good enough for sorting.

## Consequences

- The "stable identity only" contract on `companyInfo` is intentionally weakened; future volatile-field additions should be evaluated against the same staleness trade-off.
- Documents written before this change lack `marketCap`/`beta` until their next OVERVIEW refresh; a one-time backfill script parses the existing `symbol-data` overview docs (zero AV calls).
- `orderBy` on these fields silently excludes documents that lack them (all ETFs, plus symbols mid-onboarding).
