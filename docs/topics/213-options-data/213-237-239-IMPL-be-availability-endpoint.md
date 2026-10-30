# Implementation Plan: Contract Availability Endpoint (BE)

**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** `options-corpus-bulk-ingest`  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** `availability-endpoint`  
**Issue:** #239  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Domain:** OPTIONS-DATA  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

## Areas

BE only (single Blueprint). Shared API types land in `shared/options/` but are carried under the BE blueprint per Thread #214 precedent (Task #219 shipped shared types the same way). No FE, no SHARED blueprint.

## Architecture

```mermaid
flowchart LR
    subgraph Handler
        H[partnerContractAvailabilityV1<br/>onRequest GET]
    end
    subgraph Services
        P[param parser<br/>validate + normalize]
        Q[contract-availability-query.service<br/>primary range in Firestore<br/>post-filters + sort + cap]
        D[corpus-dates.service<br/>GCS prefix listing → dates]
    end
    H --> P --> Q
    H --> D
    Q --> FS[(Firestore options-file-index/{symbol}/ts-contracts)]
    D --> GCS[(GCS historical-options-corpus/{symbol}/)]
```

- **Handler** — `functions/src/v2/partner/contract-availability-partner.ts`, exported as `partnerContractAvailabilityV1` from `functions/src/index.ts`. Follows `partner-contract-catalog-partner.ts` exactly: `onRequest` + `HttpsOptions` (256MiB / 30s is tight for a 2000-doc read + GCS listing — bump to `512MiB` / `60s`, maxInstances 20), `authenticateRequestEither` + `allowedServiceAccounts`/`expectedGoogleAudience` secrets, `createOptionsEnabledChecker` gate, injectable deps for tests.
- **Param parsing** — reuse `partner-request.utils` (`toFirstString`, `parseOptionalDate`, `parseOptionalNumber`); add `parseOptionalDateList` for `expirations`. All validation errors → `400 BAD_REQUEST` in the V2 error envelope.
- **Query service** — new `contract-availability-query.service.ts` (sibling of `contract-catalog-query.service.ts`; do NOT mutate the V2 service — different semantics, shared types only).
- **Dates service** — new `corpus-dates.service.ts`. GCS `getFiles` prefix listing (pattern from `StorageFileViewerService.listCorpus`), strips `.json.gz` → date, sort asc. Dates only — no file metadata on the wire.
- **Shared types** — `shared/options/contract-availability.types.ts`: `ContractAvailabilityResponse`, `ContractAvailabilityErrorResponse` (reuse V2 error shape), request-param constants.

## Key decisions

1. **Multi-range (locked):** Firestore allows one range field per query. Deterministic precedence — `expiration` > `firstObserved` > `strike` — the first present range dim runs server-side; all remaining filters (other ranges, `strikeStep`, `expirations` overflow) apply in memory.
2. **`expirations` list:** overrides `expirationGte/Lte`. `in` queries chunked at 30 values (Firestore `in` limit); chunks merged + deduped client-side.
3. **`strikeStep`:** in-memory only — strike converted to integer cents, keep when `cents % stepCents === 0`.
4. **Truncation:** after post-filter + in-memory sort (expiration asc → strike asc → contractId asc), take `CAP + 1`; if extra exists, drop it and set `truncated: true`. Read amplification on broad queries is accepted (discovery endpoint, low volume).
5. **Response:** `contracts` = `ContractCatalogEntry` (strip `lastUpdated`); `corpusDates` sorted ascending.
6. **Auth:** identical posture to `partnerContractCatalogV2` — OIDC bearer, audience check, allowlisted SA emails, `optionsEnabled` gate → `404`.

## Tasks (flat under the BE Blueprint)

| # | Task | Blocked by | Deliverables |
|---|---|---|---|
| T1 | Shared types + request-param parser | — | `contract-availability.types.ts`; `parseOptionalDateList`; param validation (range pairs, step > 0, type normalization `C/P`→`call/put`, date-list format); unit tests |
| T2 | Availability data services | T1 | `contract-availability-query.service.ts` (primary-range precedence, expirations `in`-chunking, post-filters, ordering, cap+1) + `corpus-dates.service.ts`; unit tests w/ fake Firestore + fake bucket |
| T3 | `partnerContractAvailabilityV1` handler + wiring | T1, T2 | handler, `index.ts` export, error envelope, dep injection; handler tests w/ mocked deps |
| T4 | Verify script + index | T3 | `functions/scripts/verify/options-data-{task}-contract-availability.ts` + `.md` + README/run-all entries |

## Risks / notes

- **Read amplification:** worst case ~thousands of doc reads/request on unfiltered calls (~$0.0004–0.006). Acceptable now; a cached catalog snapshot or cached corpus-dates doc is the documented future optimization.
- **Cold-start latency:** 2000-doc query + GCS listing ≈ 1–3s worst case; 60s timeout is ample.
- **Task #225 overlap:** partner endpoint + Firestore rules under Thread #214 shares auth/rules plumbing — this endpoint reads `ts-contracts`, which `partnerContractCatalogV2` already reads; no new rules expected (confirm during T3).
- **Deploy:** new function deploys via the normal functions deploy; IAM `run.invoker` for the partner SA group must be granted post-deploy (same as V2 — note in ship runbook).
