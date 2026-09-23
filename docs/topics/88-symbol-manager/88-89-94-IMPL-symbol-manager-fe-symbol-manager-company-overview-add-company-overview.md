**Topic:** Add Company Overview Data to Symbol Manager  
**Topic Slug:** symbol-manager-company-overview  
**Thread:** Add Company Overview Data to Symbol Manager  
**Thread Slug:** add-company-overview  
**Issue:** #94  
**Thread Parent:** #89  
**Topic Parent:** #88  
**Domain:** SYMBOL-MANAGER  
**Type:** Implementation Plan (FE)  
**Status:** Draft  
**Created:** 2026-09-20  
**Last Updated:** 2026-09-20  

# Implementation Plan — FE

## Scope

Symbol Manager V2 view (`src/app/feat/symbol-manager-view/`): render four new `companyInfo` columns and wire the already-scaffolded client-side sort into the displayed-symbols pipeline.

## Components

### 1. Columns — `symbol-manager.component.html` + `displayedV2Columns`

Add four `matColumnDef`s to `displayedV2Columns` (order: after `name`, before `type` — grouping identity then classification):

| Column | Source | Format |
|---|---|---|
| `sector` | `companyInfo.Sector` | raw string; `—` when absent |
| `industry` | `companyInfo.Industry` | raw string; `—` when absent |
| `marketCap` | `companyInfo.marketCap` | `$X.XXT` / `$X.XB` / `$XM`; `—` when absent |
| `beta` | `companyInfo.beta` | two decimals; `—` when absent |

Market-cap formatting lives in a pure function (unit-testable), colocated with the component or in a shared FE util if an existing formatting helper exists.

### 2. Client-side sorting — `symbol-manager.component.ts`

The scaffold exists: `MatSortModule` is imported and `onSortChange(sort: Sort)` sets `sortField`/`sortDirection` — currently dead plain fields never applied.

- Convert `sortField`/`sortDirection` to signals.
- Add `matSort` + `(matSortChange)="onSortChange($event)"` on the table and `mat-sort-header` on each sortable header (all displayed columns).
- Insert a sort step into the pipeline: `filteredSymbols → sortedSymbols (computed) → displayedSymbols (slice)`. Sort happens **before** the slice → global ordering across the loaded set.
- Comparator: case-insensitive string compare for text fields; numeric for `marketCap`/`beta`/`matchScore`; nested `companyInfo.*` accessors; **missing values always sort last regardless of direction**; stable tiebreak on `symbol`.
- No changes to `SymbolManagerService.listSymbolsV2` or the store's fetch — sorting never triggers a refetch.

### 3. Fetch-cap guard — component + store

When the loaded set is smaller than the server's `total` (fetch cap hit), sorting would silently cover only a subset. Add a `v2Total` signal to the store (from `ListSymbolsV2Response.total`); the component shows a banner/snackbar when `v2Total > v2Symbols.length`: "Sorting covers only the first {loaded} of {total} symbols."

## Contracts verified against existing code

- `companyInfo` already arrives in `listSymbolsV2` responses via `toTrackedSymbolV2` (`functions/src/v2/common/common-dm.ts`) — no API change needed for display.
- `matSort` on a plain `[dataSource]` array: sorting is applied manually in the computed — no `MatTableDataSource` needed (existing pattern uses computed slices).
- FE imports `TrackedSymbolV2` from `@shared/alpha-vantage` — new optional fields flow automatically once the shared type lands.

## Risks

- **Silent partial sort past 10k symbols** — mitigated by the fetch-cap guard (section 3).
- **`matchScore` is a string** in `TrackedSymbolV2` — sorting numerically is the intent; treat as numeric compare.
- No blocking dependency on BE deploy: `companyInfo` fields are optional; columns render `—` until data lands.

## Task breakdown (proposed)

1. `FE-IMPL`: four columns + formatters + placeholders
2. `FE-IMPL`: sort wiring (signals + computed sort step + `mat-sort-header`s + nulls-last) + fetch-cap guard banner

FE-2 is blocked by FE-1 (columns to sort must exist). Both are blocked by BE-1 (shared type fields must exist to compile against).
