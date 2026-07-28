# Partner Contract Catalog V2 — As-Built

This document describes `partnerContractCatalogV2` exactly as implemented. It is intended to explain the complete backend path for a developer who needs to understand, operate, or extend the endpoint.

It is split into three parts:

1. **Plain-English request lifecycle** — what happens in order.
2. **Lifecycle with implementation paths** — the files and symbols responsible for each step.
3. **Implementation and operations reference** — contracts, tests, deployment work, limits, and extension boundaries.

> Scope note: this is the partner-facing Cloud Function that serves per-contract metadata from the Firestore `ts-contracts` subcollection. It does not describe the time-series builder, the GCS corpus, or the backfill script in detail — those are covered in the PRD and related docs.

---

## Part 1 — What happens

### 1. The moving pieces

The endpoint is an authenticated, server-to-server read API for the per-contract metadata catalog stored in Firestore. Its moving pieces are:

- **Cloud Function export** — deploys the HTTP function as `partnerContractCatalogV2`.
- **Partner request handler** — enforces method, authentication, request validation, parameter parsing, error handling, and lifecycle logging. Serves two modes: summary and catalog.
- **Shared partner authentication** — verifies a Google OIDC ID token or Firebase ID token. This endpoint requires the successful identity to be an allowlisted service account.
- **Request parsing utilities** — shared pure functions that normalize Express query-string values into typed values or `null` when invalid.
- **Contract catalog query service** — builds and executes Firestore queries against `ts-contracts` with filtering, sorting, and cursor pagination. Single concern: catalog queries.
- **Contract catalog writer** — writes `ts-contracts` docs. Called by the time-series builder after each GCS file flush and by the backfill script. Not called by the endpoint at runtime.
- **Contract summary aggregator** — scans all `ts-contracts` docs for a symbol and writes the symbol summary doc with a length-bucket histogram and totals. Runs daily, not per request.
- **Shared contracts** — define the catalog document, API response types, sort options, and Firestore collection constants.

### 2. A successful request (summary mode)

A partner sends a `GET` request with:

- `Authorization: Bearer <Google OIDC ID token>`
- `symbol`, such as `QQQ`
- `summary=true`

The request follows this sequence:

1. Cloud Run IAM must permit the caller to invoke the deployed function. This happens before the handler runs.
2. The handler rejects every non-`GET` method with `405 METHOD_NOT_ALLOWED`.
3. The shared authentication middleware reads the bearer token, verifies it, checks the audience against `EXPECTED_GOOGLE_AUDIENCE`, and checks the email against `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
4. The handler checks that the authenticated identity is a service account (not a Firebase user). A Firebase identity is rejected with `403 FORBIDDEN`.
5. The handler parses `symbol`, trims and uppercases it, and validates it against `ALLOWED_SYMBOLS` (`QQQ`, `TQQQ`).
6. The handler checks `summary=true` and enters summary mode.
7. The query service reads the symbol summary doc at `options-file-index/{symbol}`. If it doesn't exist, returns `404 NOT_FOUND`.
8. The handler builds the summary response with `totalContracts`, `expirationCount`, `lengthBuckets`, and `lastUpdated`.
9. Returns `200` with the summary response.

### 3. A successful request (catalog mode)

A partner sends a `GET` request with:

- `Authorization: Bearer <Google OIDC ID token>`
- `symbol`, such as `QQQ`
- Optional filters: `expiration`, `contractLengthBucket`, `type`, `strike`, `strikeGte`, `strikeLte`, `deltaGte`, `deltaLte`, `ivGte`, `ivLte`, `minObservationCount`
- Optional sort: `sortBy` (default `expiration`), `sortOrder` (default `asc`)
- Optional pagination: `pageSize` (default 200, max 500), `pageToken`

The request follows this sequence:

1. Steps 1–4 are identical to summary mode (IAM, method, auth, service-account check).
2. The handler parses `symbol` and validates it against `ALLOWED_SYMBOLS`.
3. The handler parses all optional filter, sort, and pagination parameters using shared utilities. Each parameter is validated individually — invalid values return `400 BAD_REQUEST` with a descriptive message.
4. The handler validates range pairs (`strikeGte <= strikeLte`, `deltaGte <= deltaLte`, `ivGte <= ivLte`).
5. The handler logs the request with the parsed parameters.
6. The query service validates the filter combination — at most one range dimension is allowed. If two different range dimensions are used (e.g., `strikeGte` + `deltaGte`), it throws `FilterConflictError` which the handler catches and returns as `400 BAD_REQUEST`.
7. The query service builds a Firestore query against `options-file-index/{symbol}/ts-contracts` with equality filters, at most one range dimension, sort, and cursor pagination.
8. The query fetches `pageSize + 1` docs to determine if there's a next page. If more than `pageSize` docs are returned, the extra doc is dropped and the last visible doc's ID becomes `nextPageToken`.
9. The handler maps each `ContractCatalogDoc` to `ContractCatalogEntry` by stripping `lastUpdated`.
10. Returns `200` with the catalog response.

### 4. Authentication and authorization

The endpoint has two layers of authorization:

1. **Cloud Run IAM** must grant the caller `roles/run.invoker` for the deployed function.
2. **Application authorization** requires the Google OIDC token to have an allowlisted service-account email and an allowed audience.

The configuration is shared with the existing partner authentication middleware:

- `ALLOWED_SERVICE_ACCOUNT_EMAILS` is a comma-separated service-account email allowlist.
- `EXPECTED_GOOGLE_AUDIENCE` is a comma-separated Google OIDC audience allowlist shared by partner endpoints.

For this endpoint, `EXPECTED_GOOGLE_AUDIENCE` must be non-empty. The deployed endpoint URL must be in the allowlist.

Authentication failures emitted directly by shared middleware use its existing envelope:

```json
{
  "error": "Forbidden",
  "message": "Google ID token audience mismatch."
}
```

A valid Firebase identity reaches the endpoint but is rejected by the endpoint's own service-account check. That response uses the endpoint error envelope and `FORBIDDEN` code.

### 5. Request validation

The endpoint accepts only:

| Input | Rule | Result |
|---|---|---|
| HTTP method | Must be `GET` | All other methods return `405` |
| `symbol` | Required string; trimmed, uppercased; must be `QQQ` or `TQQQ` | Invalid or missing returns `400 BAD_REQUEST` |
| `summary` | Optional boolean (`true` or `1`) | When true, enters summary mode and ignores all other params |
| `expiration` | Optional `YYYY-MM-DD` calendar date | Invalid returns `400` |
| `contractLengthBucket` | Optional string (e.g., `3mo`, `1yr`) | Not validated against known labels — any non-empty string is accepted |
| `type` | Optional `C` or `P` (case-insensitive) | Invalid returns `400` |
| `strike` | Optional non-negative number | Invalid returns `400` |
| `strikeGte` / `strikeLte` | Optional numbers; `strikeGte` must be `<= strikeLte` | Invalid or inconsistent returns `400` |
| `deltaGte` / `deltaLte` | Optional numbers; `deltaGte` must be `<= deltaLte` | Invalid or inconsistent returns `400` |
| `ivGte` / `ivLte` | Optional numbers; `ivGte` must be `<= ivLte` | Invalid or inconsistent returns `400` |
| `minObservationCount` | Optional non-negative number | Invalid returns `400` |
| `sortBy` | Optional: `expiration`, `strike`, `contractLengthDays`, `observationCount`, `delta` | Invalid returns `400` |
| `sortOrder` | Optional: `asc` or `desc` | Invalid returns `400` |
| `pageSize` | Optional non-negative number; clamped to 1–500 | Invalid returns `400`; 0 is silently clamped to 1 |
| `pageToken` | Optional string (contract ID from previous response) | Invalid token returns empty results (cursor doc not found) |
| Other query parameters | Not used | Ignored |

### 6. Firestore query constraints

Firestore supports at most **one range field** per query. Equality filters (`expiration`, `contractLengthBucket`, `type`, `strike`) can combine freely. Range filters (`strikeGte/Lte`, `deltaGte/Lte`, `ivGte/Lte`, `minObservationCount`) conflict with each other.

The query service validates the combination and throws `FilterConflictError` when two different range dimensions are used. The handler catches this and returns `400` with a descriptive error message listing which filters conflict.

For `deltaGte` + `deltaLte` (same field, two bounds), Firestore treats this as a single range on `latestDelta` — supported.

For `sortBy=delta`, the query orders by `latestDelta`. This requires a composite index on the filter fields + `latestDelta`.

### 7. Numeric range filters

`latest.delta` and `latest.iv` are stored as strings (matching the JSONL storage format). To enable correct Firestore numeric range queries, the catalog also stores **numeric top-level fields** `latestDelta` and `latestIv` derived from the same source. The query service uses these numeric fields for `deltaGte`/`deltaLte`, `ivGte`/`ivLte`, and `sortBy=delta` — not the string fields. This avoids the lexicographic comparison bug that would produce incorrect results for values with different decimal places.

**Note:** Existing docs in Firestore do not have `latestDelta`/`latestIv` fields until they are rewritten by the builder or a backfill. A backfill or builder run is needed to populate the new fields on existing docs.

### 8. Persistence boundary

The endpoint is read-only. It queries Firestore directly — no external API calls, no GCS reads, no writes. The catalog data is written by:

- **Time-series builder** — calls `ContractCatalogWriter.upsertContractCatalog()` after each GCS file flush with the latest observation record.
- **Backfill script** — one-time script that reads GCS metadata and writes `ts-contracts` docs for all existing files. Skips the `latest` object (requires file download).
- **Summary aggregator** — daily job that scans `ts-contracts` and writes the symbol summary doc.

### 9. Logs and operational behavior

The handler emits bounded structured lifecycle events. It records a generated `requestId` and relevant safe fields such as HTTP status, normalized symbol, filter parameters, response count, and processing duration.

It does not log bearer tokens, complete response bodies, or unbounded query content.

The deployed function is configured for:

| Setting | Value |
|---|---:|
| Memory | 256 MiB |
| Maximum instances | 20 |
| Timeout | 30 seconds |

### 10. Firestore indexes

The endpoint requires composite indexes on the `ts-contracts` collection group. 14 indexes are defined in `firestore.indexes.json` (3 additional indexes were auto-created by Firestore from failed query attempts during deployment debugging, for a total of 17 in Firestore).

Indexes on large collections (370K+ docs) take several minutes to build. Queries will fail with `500 INTERNAL_ERROR` until the required index reaches `READY` state.

---

## Part 2 — What happens, with implementation paths

### Deployment export and handler entry

- The Functions package exports `partnerContractCatalogV2` from `functions/src/index.ts`.
- The function declaration is `partnerContractCatalogV2 = onRequest(functionOptions, partnerContractCatalogHandler)` in `functions/src/v2/partner/partner-contract-catalog-partner.ts`.
- `functionOptions` binds two required secrets (`ALLOWED_SERVICE_ACCOUNT_EMAILS`, `EXPECTED_GOOGLE_AUDIENCE`), memory, instance cap, and timeout.
- `partnerContractCatalogHandler` owns the endpoint lifecycle and accepts injectable dependencies for testing.

### Authentication and secrets

- `partner-contract-catalog-partner.ts` declares and binds `ALLOWED_SERVICE_ACCOUNT_EMAILS` and `EXPECTED_GOOGLE_AUDIENCE` with Firebase `defineSecret`.
- `authenticateRequestEither` in `functions/src/v2/utils/utils.ts` performs the shared authentication flow.
- `getExpectedGoogleAudiences` and `getAllowedServiceAccounts` in the same shared utility module provide the configured allowlists to authentication.
- The endpoint checks for the returned `serviceAccountEmail` property after shared authentication. The absence of that property means a Firebase identity was authenticated and is rejected for this service-account-only endpoint.

### Request parsing and validation

- `toFirstString`, `parseOptionalDate`, `parseOptionalNumber`, `parseOptionalNonNegativeNumber`, and `parseOptionalBool` are in `functions/src/v2/partner/partner-request.utils.ts`. These are pure functions with no I/O or side effects.
- `parseOptionalType` is defined locally in `partner-contract-catalog-partner.ts` because the return type (`'call' | 'put'`) differs from the existing `list-contracts-partner.ts` which uses `'C' | 'P'`.
- `parseSortBy` and `parseSortOrder` are also defined locally, validating against `VALID_SORT_FIELDS` and `VALID_SORT_ORDERS` sets.
- `HistoricalOptionsErrorCode` in `functions/src/v2/partner/historical-options-request.utils.ts` is the canonical public endpoint-error enum, shared with the historical options endpoints.
- The handler builds direct endpoint failures with `{ ok: false, error, code, timestamp }`.

### Catalog query service

- `ContractCatalogQueryService` in `functions/src/v2/historical-options-corpus/services/contract-catalog-query.service.ts` is instantiated per request with the shared `db` instance.
- `queryCatalog()` builds a Firestore query against `options-file-index/{symbol}/ts-contracts` with:
  - Equality filters: `expiration`, `contractLengthBucket`, `type`, `strike`
  - Range filters (at most one dimension): `strikeGte/Lte`, `deltaGte/Lte`, `ivGte/Lte`, `minObservationCount`
  - Sort: mapped via `SORT_FIELD_MAP` (`delta` → `latest.delta`)
  - Cursor pagination: `pageToken` is the contract ID (document ID); `decodeCursor` fetches the doc by ID and passes it to `startAfter()`
- `validateFilterCombination()` throws `FilterConflictError` when two different range dimensions are used.
- `getSummary()` reads the symbol summary doc at `options-file-index/{symbol}`. Returns `null` when the doc doesn't exist.
- Default page size: 200. Maximum: 500. The service fetches `pageSize + 1` docs to determine if there's a next page.

### Catalog writer (not called by the endpoint)

- `ContractCatalogWriter` in `functions/src/v2/historical-options-corpus/services/contract-catalog.writer.ts` writes `ts-contracts` docs.
- `upsertContractCatalog()` parses the contract ID for `expiration`, `strike`, and `type`, computes `contractLengthDays`, `contractLengthBucket`, and `expectedObservationCount`, extracts the `latest` snapshot from the last observation record, and writes the doc with `set({ merge: true })`.
- `extractLatestSnapshot()` returns a sparse `LatestSnapshot` object with only present fields. Returns `undefined` when no relevant fields are present.
- Called by the time-series builder after GCS write succeeds and by the backfill script.

### Summary aggregator (not called by the endpoint)

- `ContractSummaryAggregator` in `functions/src/v2/historical-options-corpus/services/contract-summary-aggregator.service.ts` scans all `ts-contracts` docs for a symbol and writes the summary doc.
- `aggregateAndWriteSummary()` does a full `colRef.get()`, iterates all docs, counts by `contractLengthBucket` and distinct `expiration`, and writes the summary doc with `set({ merge: true })`.
- Runs once per day per symbol. Not called by the endpoint.

### Builder integration

- `TimeSeriesBuilderService` in `functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts` calls `catalogWriter.upsertContractCatalog()` after the GCS write and index writer calls succeed.
- The catalog write is in a separate `try/catch` block — a catalog write failure does not affect the GCS write or the index write.
- The builder passes `firstObserved` (from `sorted[0].d`), `lastObserved` (from `sorted[last].d`), `observationCount` (`sorted.length`), and `latestRecord` (`sorted[last]`).

### Response serialization and logs

- The handler creates the successful response envelope with `ContractCatalogResponse` or `ContractSummaryResponse`.
- For catalog mode, the handler maps `ContractCatalogDoc` → `ContractCatalogEntry` via destructuring to strip `lastUpdated`:
  ```typescript
  const entries: ContractCatalogEntry[] = result.contracts.map(({ lastUpdated: _, ...entry }) => entry);
  ```
- The endpoint logger is created with `createLogger('[partner-contract-catalog]')`.
- Events include `partnerContractCatalog.request`, `partnerContractCatalog.summary`, `partnerContractCatalog.response`, `partnerContractCatalog.error`, `partnerContractCatalog.forbidden`, and `partnerContractCatalog.symbol_not_allowed`.

### Tests

No unit tests have been created. The project rules state: "We will not be implementing unit testing yet but will in the future." The PRD §16.1 calls for Jest unit tests for all new services — this is a known gap.

---

## Part 3 — Implementation and operations reference

### Public request contract

| Item | Value |
|---|---|
| Function export | `partnerContractCatalogV2` |
| Deployed URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerContractCatalogV2` |
| HTTP method | `GET` only |
| Required query | `symbol` |
| Optional query (summary) | `summary=true` |
| Optional query (catalog) | `expiration`, `contractLengthBucket`, `type`, `strike`, `strikeGte`, `strikeLte`, `deltaGte`, `deltaLte`, `ivGte`, `ivLte`, `minObservationCount`, `sortBy`, `sortOrder`, `pageSize`, `pageToken` |
| Authentication | Google OIDC ID token for an allowlisted service account |
| Browser use | Unsupported; this is server-to-server |
| Data source | Firestore `options-file-index/{symbol}/ts-contracts` subcollection |
| Persistence | Read-only; no writes from the endpoint |

The deployed URL is environment-specific. Use the supplied URL as the request target and token audience. The token audience must be in the shared `EXPECTED_GOOGLE_AUDIENCE` allowlist.

### Successful response shape (summary mode)

```json
{
  "ok": true,
  "symbol": "QQQ",
  "totalContracts": 369810,
  "expirationCount": 412,
  "lengthBuckets": {
    "1d": 8, "3d": 15, "5d": 22, "7d": 30, "14d": 45,
    "21d": 18, "1mo": 120, "1.5mo": 35, "2mo": 60, "3mo": 380,
    "4mo": 95, "6mo": 210, "9mo": 48, "1yr": 95, "2yr": 40, "3yr": 12
  },
  "lastUpdated": "2026-07-25T16:00:00Z"
}
```

### Successful response shape (catalog mode)

```json
{
  "ok": true,
  "symbol": "QQQ",
  "contracts": [
    {
      "contractId": "QQQ260319C00500000",
      "expiration": "2026-03-19",
      "strike": 500,
      "type": "call",
      "firstObserved": "2026-03-06",
      "firstObservedDow": "Fri",
      "lastObserved": "2026-03-19",
      "lastObservedDow": "Thu",
      "observationCount": 10,
      "expectedObservationCount": 10,
      "contractLengthDays": 14,
      "contractLengthBucket": "14d",
      "latest": {
        "mark": "0.05",
        "volume": "0",
        "openInterest": "0",
        "iv": "0.0001",
        "delta": "0.00001",
        "gamma": "0.00000",
        "theta": "0.00000",
        "vega": "0.00000",
        "rho": "0.00001"
      }
    }
  ],
  "count": 1,
  "nextPageToken": "QQQ260319C00500000"
}
```

When there are no more results, `nextPageToken` is omitted.

### Error envelopes

Endpoint-generated errors use:

```json
{
  "ok": false,
  "error": "Safe human-readable message",
  "code": "ERROR_CODE",
  "timestamp": "2026-07-28T00:00:00.000Z"
}
```

| HTTP status | Code | Meaning |
|---:|---|---|
| 400 | `BAD_REQUEST` | Invalid or missing parameter, or conflicting filter combination |
| 401 / 403 | Shared authentication envelope | Missing, invalid, unauthorized, or audience-mismatched authentication |
| 403 | `FORBIDDEN` | A valid Firebase identity was supplied instead of a required service-account identity |
| 404 | `NOT_FOUND` | Summary mode: no catalog data found for the symbol |
| 405 | `METHOD_NOT_ALLOWED` | Method is not `GET` |
| 500 | `INTERNAL_ERROR` | Firestore query failure (e.g., missing index) or unexpected failure |

### Core source map

| Concern | Source |
|---|---|
| Function export | `functions/src/index.ts` |
| HTTP lifecycle | `functions/src/v2/partner/partner-contract-catalog-partner.ts` |
| Request parsing utilities | `functions/src/v2/partner/partner-request.utils.ts` |
| Error code enum | `functions/src/v2/partner/historical-options-request.utils.ts` |
| Shared partner authentication and API-key resolution | `functions/src/v2/utils/utils.ts` |
| Catalog query service | `functions/src/v2/historical-options-corpus/services/contract-catalog-query.service.ts` |
| Catalog writer (builder/backfill path) | `functions/src/v2/historical-options-corpus/services/contract-catalog.writer.ts` |
| Summary aggregator (daily job) | `functions/src/v2/historical-options-corpus/services/contract-summary-aggregator.service.ts` |
| Builder integration | `functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts` |
| Backfill script | `functions/scripts/backfill/backfill-contract-catalog.ts` |
| Shared catalog types | `shared/options/contract-catalog.types.ts` |
| Contract length classifier | `shared/options/contract-length.utils.ts` |
| Shared barrel export | `shared/options/index.ts` |
| Services barrel export | `functions/src/v2/historical-options-corpus/services/index.ts` |
| Firestore indexes | `firestore.indexes.json` |
| Firestore rules | `firestore.rules` (rule 9: `options-file-index` admin read-only) |
| PRD | `docs/partner/options-data/contract-catalog-prd.md` |
| Code review (round 1-2) | `docs/operations/contract-catalog-review.md` |
| Code review (round 3) | `docs/operations/contract-catalog-review-r3.md` |
| Deployment workflow | `.devin/workflows/deploy-partner-endpoint.md` |

### Firestore data model

**Catalog document:** `options-file-index/{symbol}/ts-contracts/{contractId}`

Fields: `contractId`, `expiration`, `strike`, `type`, `firstObserved`, `firstObservedDow`, `lastObserved`, `lastObservedDow`, `observationCount`, `expectedObservationCount`, `contractLengthDays`, `contractLengthBucket`, `latest?` (optional), `lastUpdated`.

**Summary document:** `options-file-index/{symbol}`

Fields: `symbol`, `totalContracts`, `expirationCount`, `lengthBuckets` (histogram), `lastUpdated`.

**Firestore rules:** The `options-file-index` collection is admin read-only via Firestore rules (rule 9). The endpoint uses the Admin SDK which bypasses rules. Client-side access is not permitted — the catalog is served exclusively through the partner endpoint.

### Firestore composite indexes

14 indexes defined in `firestore.indexes.json` for `ts-contracts` collection group. 3 additional indexes were auto-created by Firestore from failed query attempts during deployment (total 17 in Firestore). Each index covers a specific combination of equality filters + sort field + `__name__` for cursor pagination, in both ASC and DESC variants.

Check index status:

```bash
gcloud firestore indexes composite list --project=alpha-vantage-proxy-api --database='(default)' --filter="state:CREATING"
```

### Deployment checklist

The implementation is code-complete and deployed. Post-deployment steps are documented in `.devin/workflows/deploy-partner-endpoint.md`:

1. **Update `EXPECTED_GOOGLE_AUDIENCE` secret** — append the endpoint URL to the comma-separated list in Secret Manager.
2. **Grant `roles/run.invoker`** on the Cloud Run service to the partner SA(s) and the CF admin robot SA.
3. **Deploy Firestore composite indexes** — check existing indexes first, remove duplicates from `firestore.indexes.json`, then `firebase deploy --only firestore:indexes`. Indexes on 370K+ docs take minutes to build.
4. **Deploy the function** — `firebase deploy --only "functions:partnerContractCatalogV2"`.
5. **Verify** — mint a test token and call the endpoint with both summary and catalog mode queries.
6. **Update documentation** — add the endpoint URL to `docs/partner/partner-auth-and-audience.md`.

### Explicit non-features and known limitations

- **No unit tests** — deferred per project rules, but PRD §16.1 calls for them.
- **`pageSize=0` silently clamped to 1** — should be a `400` error per PRD §6.6. Not addressed (R3 P5).
- **`contractLengthBucket` not validated against known labels** — any non-empty string is accepted as a filter value. An invalid bucket label simply returns zero results.
- **Summary aggregator loads entire subcollection** — works for 2 symbols (~370K docs) but won't scale. Should use `select()` field mask or streaming aggregation. Not addressed (R3 T2).
- **No scheduled summary refresh** — PRD §7.2 describes a daily scheduled job. Not yet implemented. Summary docs are currently updated by the backfill script and the builder.
- **Cursor pagination uses document ID** — the `pageToken` is the raw contract ID. If sort parameters change between paginated requests, the cursor position is wrong relative to the new sort order. Standard cursor pagination limitation.
- **No browser/CORS integration** — server-to-server only.
- **Coverage limited to `QQQ` and `TQQQ`** — `ALLOWED_SYMBOLS` set restricts the endpoint to these two symbols.

### Related documents

- `contract-catalog-prd.md` is the product and technical contract.
- `contract-catalog-review.md` records round 1-2 code review findings and remediations.
- `contract-catalog-review-r3.md` records round 3 code review findings.
- `partner-historical-options-v2-as-built.md` — as-built for the `partnerHistoricalOptionsV2` endpoint.
- `historical-options-contract-v2-discovery.md` and `historical-options-contract-v2-usage.md` — per-contract time series endpoint and RS usage.

This as-built guide explains how the PRD and review findings map onto the current source tree.
