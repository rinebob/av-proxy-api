# Test Plan: Contract Availability Endpoint (BE)

**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** `options-corpus-bulk-ingest`  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** `availability-endpoint`  
**Issue:** #239  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Domain:** OPTIONS-DATA  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

## E2E User Journeys

- Journey 1: Partner SA GETs `?symbol=QQQ` → receives full contract catalog + `corpusDates` + `truncated` flag.
- Journey 2: Partner GETs with `expirationGte`/`expirationLte` + `strikeGte`/`strikeLte` + `type=C` → filtered contracts only, all `type === 'call'`.
- Journey 3: Partner GETs with `expirations=2026-05-15,2026-06-19` → only those expirations, regardless of range params.
- Journey 4: Partner GETs unauthenticated / non-allowlisted → 401/403 with error envelope.
- Journey 5: Broad query exceeding cap → `truncated: true`, deterministic ordering preserved.

## Integration Tests

- Handler + query service + dates service with faked Firestore (in-memory collection) and faked GCS bucket listing.
- Auth paths: valid SA token vs Firebase-user identity vs missing token (mock `authenticateRequest`).
- `optionsEnabled` gate behavior for disabled symbols.

## Unit Tests

- Pure functions: param parsers (date, date-list, number, step, type normalization), strikeStep grid math (integer-cent multiples), primary-range precedence selector, expirations chunker (≤30 per `in`), sort comparator, response mapper (strips `lastUpdated`).
- Services: `contract-availability-query.service` (server-side filter set + post-filter application + cap+1), `corpus-dates.service` (prefix listing → dates, `.json.gz` filtering, sort).
- Utils: `parseOptionalDateList` edge cases (empty, malformed, dupes).

## Test Seams

- Highest seam: HTTP handler with `authenticateRequest`, `queryService`, `datesService`, and `isOptionsEnabled` injected/faked — mirrors `partner-contract-catalog-partner` test pattern.
- Lower seams: services with fake Firestore query results; dates service with fake bucket `getFiles` page iterator.

## Existing Test Coverage

- `partner-contract-catalog-partner` tests cover the auth/gate/envelope pattern this handler copies.
- Corpus/seed/coverage service tests cover GCS adapter faking patterns.
- Gap this plan fills: multi-range post-filter semantics, truncation flag, dates-only listing, availability envelope.

## Edge Cases

- Empty `ts-contracts` for symbol → `contracts: []`, `count: 0`, `truncated: false`.
- Malformed date / inverted range pair (`gte > lte`) / `strikeStep <= 0` → `400`.
- `expirations` > 30 values → chunked `in` queries merged without dupes.
- `strikeStep` with non-grid-aligned strikes (e.g. $2.50 strikes, step 10) → no false positives via integer-cent math.
- Expired-only result sets (frozen docs, no `latest`) → fields omitted cleanly.
- Exactly 2000 vs 2001 matching → `truncated` boundary.
- Symbol with zero corpus objects → `corpusDates: []`.
- Non-GET method → `405`.
