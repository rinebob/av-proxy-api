**Topic:** Add Company Overview Data to Symbol Manager  
**Topic Slug:** symbol-manager-company-overview  
**Thread:** Add Company Overview Data to Symbol Manager  
**Thread Slug:** add-company-overview  
**Issue:** #94  
**Thread Parent:** #89  
**Topic Parent:** #88  
**Domain:** SYMBOL-MANAGER  
**Type:** Implementation Plan (BE)  
**Status:** Draft  
**Created:** 2026-09-20  
**Last Updated:** 2026-09-20  

# Implementation Plan — BE

## Scope

Backend work: extend the company-overview write-back with numeric `marketCap`/`beta`, widen the `listSymbolsV2` sort whitelist for partner/internal callers, add required Firestore composite indexes, and provide a zero-AV-call backfill for existing tracked symbols.

## Components

### 1. Shared type extension — `shared/alpha-vantage/av-company-overview.ts`

`TrackedSymbolCompanyInfo` gains two optional numeric fields:

- `marketCap?: number` — parsed from AV `MarketCapitalization` (string)
- `beta?: number` — parsed from AV `Beta` (string)

`shared/` is the single source of truth (functions resolves `@shared` → `lib/shared`; FE imports `@shared/alpha-vantage` directly). No functions-local copy exists — verified.

### 2. Write-back — `functions/src/v2/alpha-vantage/handlers/av-company-overview.handler.ts`

`COMPANY_INFO_FIELDS` copies keys verbatim (string → string). Extend the write-back so that after copying the stable subset it additionally:

- Parses `data.MarketCapitalization` → `companyInfo.marketCap` as `number`; omit when absent, `"None"`, or non-numeric
- Parses `data.Beta` → `companyInfo.beta` as `number`; same omission rules

Both land inside the existing `companyInfo` merge write — no new Firestore write, no new field on the tracked-symbol doc root.

### 3. Sortable-fields whitelist — `shared/alpha-vantage` + `symbol-manager.service.ts`

`listSymbolsV2` currently validates `sortBy` against `Object.values(TRACKED_SYMBOL_V2_FIELDS)`. Add a `TRACKED_SYMBOL_SORTABLE_FIELDS` whitelist (new const in shared, beside `TRACKED_SYMBOL_V2_FIELDS`):

```
symbol, name, type, region, currency, _createdAt, _lastUpdated,
companyInfo.Sector, companyInfo.Industry, companyInfo.Country,
companyInfo.marketCap, companyInfo.beta
```

`listSymbolsV2` validates `sortBy` against the whitelist, falling back to `symbol` (existing behavior preserved). Firestore `orderBy` accepts dotted paths (`companyInfo.marketCap`) directly.

### 4. Partner passthrough — `tracked-symbols-partner.ts`

Already forwards `sortBy`/`sortDirection` query params to `listSymbolsV2` — no code change needed beyond confirming the whitelist covers it. Update the doc-comment listing valid values.

### 5. Composite indexes — `firestore.indexes.json`

`where(_isActive == true).orderBy(companyInfo.X)` requires a composite index per sortable `companyInfo` field (matches existing convention of ASC/DESC pairs in this file):

- `(_isActive ASC, companyInfo.Sector ASC)` and `DESC`
- `(_isActive ASC, companyInfo.Industry ASC)` and `DESC`
- `(_isActive ASC, companyInfo.Country ASC)` and `DESC`
- `(_isActive ASC, companyInfo.marketCap ASC)` and `DESC`
- `(_isActive ASC, companyInfo.beta ASC)` and `DESC`

Deployed via `firebase deploy --only firestore:indexes`.

### 6. Backfill script — `functions/scripts/` (one-time, idempotent)

Reads `symbol-data/{SYM}/company-overview/av-company-overview` for every tracked symbol; writes `companyInfo.marketCap`/`companyInfo.beta` (and the full `companyInfo` subset when absent) onto `tracked-symbols/{SYM}` via merge. **Zero AV API calls** — parses already-stored docs. Supports `--dry-run` and `--symbols` subset (conventions from `check-company-overview.ts`).

## Contracts verified against existing code

- Write-back path: `tracked-symbols/{SYM}` merge — same as existing handler write-back (even path segments, verified in `av-company-overview.handler.ts`).
- Overview doc: `symbol-data/{SYM}/company-overview/av-company-overview`, field `data.MarketCapitalization`/`data.Beta` — verified live against prod (876 symbols populated).
- `orderBy` nested path: `companyInfo.marketCap` is a valid Firestore field path on a map field.

## Risks

- **Stale sorts**: `marketCap`/`beta` refresh only on OVERVIEW TTL (~7–30d). Accepted — see ADR 0001.
- **Existence filtering**: partner `orderBy(companyInfo.X)` silently drops docs lacking the field (45 ETFs + mid-onboarding). Accepted per PRD.
- **Index propagation lag**: composite indexes take minutes to build after deploy; partner sortBy calls for new fields fail until built — sequence index deploy before the whitelist ships.

## Task breakdown (proposed)

1. `BE-IMPL`: shared type + write-back parse (`marketCap`, `beta`)
2. `BE-IMPL`: sortBy whitelist + composite indexes + partner doc-comment
3. `BE-IMPL`: backfill script (`--dry-run`, `--symbols`, idempotent)
