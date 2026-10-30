# PRD: Contract Availability Endpoint

**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** `options-corpus-bulk-ingest`  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** `availability-endpoint`  
**Issue:** #238  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Domain:** OPTIONS-DATA  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

## Problem Statement

Partner consumers (starting with the ST options-chart product) cannot discover what options data actually exists for a symbol. To draw multi-contract time-series charts they must already know which contracts exist and which dates have data — today that knowledge lives only inside our storage layout. Blind probing of data endpoints is wasteful and produces a poor consumer experience.

Two pieces of availability information are needed per symbol:

1. **Which contracts exist in the database** — with enough metadata (expiration, strike, type, first/last observation dates) to filter and preview before requesting time series.
2. **Which dates have corpus data** — the set of trading days for which a historical options corpus object exists.

## Solution

A new partner-facing, read-only `GET` endpoint that returns both payloads in a single response:

- `contracts` — filtered entries from the canonical per-contract catalog (`options-file-index/{symbol}/ts-contracts`), which only ever contains contracts that actually have time-series data. Returned in the catalog's existing field naming (`contractId`, `expiration`, `strike`, `type` = `call|put`, `firstObserved`, `lastObserved`, `observationCount`, etc.) — the same shape `partnerContractCatalogV2` already emits.
- `corpusDates` — the sorted list of dates for which a corpus object exists under `historical-options-corpus/{symbol}/{date}.json.gz`, sourced by a live GCS prefix listing (always accurate; ~100–300 ms for ~250 objects/year).
- `truncated` — set `true` when the contracts list exceeds the result cap, so the consumer can warn the user to narrow filters. No pagination in v1.

Auth follows the existing partner pattern (OIDC ID token, allowlisted service accounts, `optionsEnabled` symbol gate).

## User Stories

1. As a partner consumer, I want to enumerate all contracts with time-series data for a symbol, so that I can let users build multi-contract chart queries.
2. As a partner consumer, I want each contract record to include `firstObserved` and `lastObserved` dates, so that I can bound chart ranges and show data-availability previews.
3. As a partner consumer, I want to filter contracts by an expiration date range (`expirationGte`/`expirationLte`), so that I can list e.g. all contracts expiring next quarter.
4. As a partner consumer, I want to filter contracts by an explicit list of expirations (`expirations`), so that I can target specific known dates; the explicit list overrides the range.
5. As a partner consumer, I want to filter contracts by strike range (`strikeGte`/`strikeLte`), so that I can restrict to near-the-money contracts.
6. As a partner consumer, I want to filter contracts by a strike step (`strikeStep`), so that I can select every-N-dollar strikes (e.g. every $10) without downloading the full grid.
7. As a partner consumer, I want to filter by option `type`, so that I can list only calls, only puts, or both.
8. As a partner consumer, I want to filter by first-observation bounds (`firstObservedGte`/`firstObservedLte`), so that I can find contracts that began trading before/after a date (e.g. ones that existed at a trade entry date).
9. As a partner consumer, I want a `truncated` flag with a deterministic result ordering and a defined cap, so that I can warn the user to narrow their filters instead of silently showing partial data.
10. As a partner consumer, I want the same response to include `corpusDates` — all dates with corpus data for the symbol — so that I can bound the chart x-axis and flag gaps without a second call.
11. As a partner consumer, I want expired contracts included when they have data, so that historical chart queries work; I can exclude them myself via `expirationLte` when unwanted.
12. As a partner consumer, I want only contracts that actually have time-series data returned, so that I never enumerate exchange-listed hypotheticals with no backing data.
13. As an operator, I want unauthenticated and non-allowlisted callers rejected, so that the endpoint is partner-only like the other catalog endpoints.
14. As an operator, I want requests for symbols without `optionsEnabled` rejected with a clear error, consistent with the existing partner gate.
15. As a partner consumer, I want machine-readable error responses (stable `code` values), so that my client can react programmatically.

## Implementation Decisions

- **Endpoint**: new partner Cloud Function, `GET` only, OIDC service-account auth identical to `partnerContractCatalogV2` (audience check + allowlisted emails + `optionsEnabled` symbol validation). Working name: `partnerContractAvailabilityV1`.
- **Request parameters** (query string): `symbol` (required); `expirationGte`, `expirationLte`, `expirations` (comma-separated explicit list; overrides range), `strikeGte`, `strikeLte`, `strikeStep`, `type` (`C|P|call|put`, case-insensitive; omitted = both), `firstObservedGte`, `firstObservedLte`. Parameter names deliberately mirror catalog doc field names per the naming decision (ST updates their draft).
- **Response**: `{ ok: true, symbol, contracts: ContractCatalogEntry[], count, truncated, corpusDates: string[], corpusDateCount }`. `contracts` reuses the exact `ContractCatalogEntry` shape already emitted by `partnerContractCatalogV2` (`lastUpdated` stripped). `corpusDates` sorted ascending, `YYYY-MM-DD`.
- **Canonical sources**: contracts = `options-file-index/{symbol}/ts-contracts` Firestore docs; corpus dates = live GCS prefix listing of `historical-options-corpus/{symbol}/` objects (decision A — no new write path, always accurate; a cached Firestore index doc is a documented future optimization if call volume warrants it).
- **Result cap**: 2000 contracts; deterministic default ordering (expiration asc → strike asc → contractId asc) so truncation is stable across calls.
- **Expired contracts**: included — expired docs are frozen in the catalog and still represent chartable history.
- **`strikeStep` semantics**: strike must be an exact multiple of the step (evaluated in integer cents to avoid float error), within any strike bounds given.
- **`expirations` semantics**: explicit list overrides `expirationGte`/`expirationLte` when present.
- **Error contract**: same envelope as `partnerContractCatalogV2` — `{ ok: false, error, code, timestamp }` with 400/401/403/404/405 codes.
- **Overlap with Task #225** (Partner endpoint + Firestore rules, Thread #214): auth/rules plumbing is shared; this Thread's endpoint is a distinct function. Blueprint should sequence or share the middleware path rather than duplicate it.
- **As-built doc**: a consumer-facing As-Built document will be produced at ship time (per user request) so ST and other consumers have a canonical contract reference.

## Testing Decisions

- Good tests assert external behavior (request → response mapping, filter semantics, error codes), not implementation details.
- Unit tests (Jest): request-param parsing/validation, filter-building (expiration range vs explicit list override, strike grid arithmetic, first-observation bounds), truncation + ordering, response shape; handler tests with mocked Firestore and mocked GCS listing — prior art: `partnerContractCatalogV2` handler/query-service tests and the corpus service tests under `functions/tests/v2/`.
- Verification script under `functions/scripts/verify/` hitting the real endpoint against a known symbol, per the repo's verification convention.
- Highest meaningful seam: the HTTP handler with service dependencies faked; lower seams for the filter builder and the dates lister.

## Out of Scope

- Cursor pagination (v1 uses the `truncated` flag + cap; consumers narrow filters).
- A cached/precomputed corpus-dates index (live listing in v1).
- Per-contract date lists (per-contract coverage is conveyed by `firstObserved`/`lastObserved`/`observationCount`).
- Additional sort parameters beyond the fixed deterministic order.
- Any mutation or admin endpoints.
- Frontend/consumer implementation (ST owns that side).

## Further Notes

- ST's draft contract used different field names (`occId`, `expiry`, `firstTraded`/`lastTraded`, `type` = `C|P`); decision taken to keep catalog naming for consistency with `partnerContractCatalogV2` — ST updates their side.
- Corpus-date coverage for charted data depends on Thread #214's backfill/materialization progress; this endpoint reports reality, not the planned universe.

## System Context

```mermaid
flowchart LR
    ST[ST options-chart consumer<br/>allowlisted service account] -->|GET /partnerContractAvailabilityV1<br/>symbol + filters| FN[Contract Availability endpoint<br/>Cloud Function]
    FN -->|auth: OIDC audience + allowlist| AUTH[Partner auth middleware]
    FN -->|optionsEnabled gate| FS[(Firestore<br/>tracked_symbols)]
    FN -->|filtered query| TS[(Firestore<br/>options-file-index/{symbol}/ts-contracts)]
    FN -->|prefix listing| GCS[(GCS<br/>historical-options-corpus/{symbol}/)]
    FN -->|contracts + corpusDates + truncated| ST
```
