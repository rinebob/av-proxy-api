# Partner Historical Options V2 — As-Built

This document describes `partnerHistoricalOptionsV2` exactly as implemented. It is intended to explain the complete backend path for a developer who needs to understand, operate, or extend the endpoint.

It is split into three parts:

1. **Plain-English request lifecycle** — what happens in order.
2. **Lifecycle with implementation paths** — the files and symbols responsible for each step.
3. **Implementation and operations reference** — contracts, tests, deployment work, limits, and extension boundaries.

> Scope note: this is the partner-facing Cloud Function and its Alpha Vantage path. It does not describe a browser integration, a Firestore archive, or a shared Alpha Vantage throttle because none is implemented for this endpoint.

---

## Part 1 — What happens

### 1. The moving pieces

The endpoint is an authenticated, server-to-server proxy for Alpha Vantage `HISTORICAL_OPTIONS` data. Its moving pieces are:

- **Cloud Function export** — deploys the HTTP function as `partnerHistoricalOptionsV2`.
- **Partner request handler** — enforces method, audience configuration, authentication, request validation, error handling, response size, and lifecycle logging.
- **Shared partner authentication** — verifies a Google OIDC ID token or Firebase ID token. This endpoint then requires the successful identity to be an allowlisted service account.
- **Request parser** — normalizes `symbol`, validates an optional `date`, and maps typed upstream failures to the endpoint's public error contract.
- **Historical-options retrieval service** — makes the Alpha Vantage call, validates and normalizes the response, and computes the options analysis. It performs no storage I/O.
- **Alpha Vantage handler factory** — still used by the browser gateway; the partner endpoint no longer constructs a handler.
- **Options analysis** — computed by the retrieval service and reused by the partner handler.
- **Shared contracts** — define the normalized option contract, response data shape, enum values, and derived analysis structures.

### 2. A successful request

A partner sends a `GET` request with:

- `Authorization: Bearer <Google OIDC ID token>`
- `symbol`, such as `AAPL`
- optional `date` in `YYYY-MM-DD` format

The request then follows this sequence:

1. Cloud Run IAM must permit the caller to invoke the deployed function. This happens before the handler runs.
2. The handler rejects every non-`GET` method with `405 METHOD_NOT_ALLOWED`.
3. The handler checks that `EXPECTED_GOOGLE_AUDIENCE` contains at least one non-empty configured audience. If not, it fails closed with `500 INTERNAL_ERROR`.
4. The shared authentication middleware reads the bearer token.
5. For Google OIDC, it verifies the token, requires the token audience to match one of the configured audiences, and requires the email claim to be in `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
6. The shared middleware can also recognize a Firebase ID token. This endpoint rejects that successful Firebase identity with `403 FORBIDDEN`, because this endpoint is service-account-only.
7. The request parser trims and uppercases `symbol`, validates its allowed characters and length, and validates the calendar date when `date` is present.
8. The handler creates `HistoricalOptionsRetrievalService` with a no-op throttle (the partner path is not subject to the shared seed throttle).
9. `HistoricalOptionsRetrievalService.fetch()` makes the upstream request with `symbol`, optional `date`, and the shared JSON response-format constant.
10. The provider response is checked for Alpha Vantage `Information`, `Note`, and `Error Message` failures. A valid data payload must contain a `data` array.
11. Each provider contract is normalized. Missing, blank, invalid, or non-finite numeric fields become absent; the endpoint does not invent zero values or a default call/put type.
12. The retrieval service calculates analysis over the normalized array and returns `{ response, analysis }`.
13. It builds the public response envelope, serializes it, and rejects it with `413 RESPONSE_TOO_LARGE` if it exceeds 10 MiB.
14. Otherwise, it returns `200` with the normalized Alpha Vantage payload and analysis.

There is no raw-chain Firestore write in this path. Every accepted request makes a live Alpha Vantage call.

### 3. Authentication and authorization

The endpoint has two layers of authorization:

1. **Cloud Run IAM** must grant the caller `roles/run.invoker` for the deployed function.
2. **Application authorization** requires the Google OIDC token to have an allowlisted service-account email and an allowed audience.

The configuration is shared with the existing partner authentication middleware:

- `ALLOWED_SERVICE_ACCOUNT_EMAILS` is a comma-separated service-account email allowlist.
- `EXPECTED_GOOGLE_AUDIENCE` is a comma-separated Google OIDC audience allowlist shared by partner endpoints.
- `ALPHAVANTAGE_API_KEY` remains backend-only and is used by the Alpha Vantage request path.

For this endpoint, `EXPECTED_GOOGLE_AUDIENCE` must be non-empty. The shared application authorization accepts any configured token audience. However, Cloud Functions/Run can reject a token before this handler when its audience is not accepted for the deployed target. Use the deployed endpoint URL as the token audience unless an alternative configured audience has been validated against that target. Add a new audience only when RS requires one that is not already allowed.

Authentication failures emitted directly by shared middleware use its existing envelope:

```json
{
  "error": "Forbidden",
  "message": "Google ID token audience mismatch."
}
```

A valid Firebase identity reaches the endpoint but is rejected by the endpoint's own service-account check. That response uses the endpoint error envelope and `FORBIDDEN` code.

### 4. Request validation

The endpoint accepts only:

| Input | Rule | Result |
|---|---|---|
| HTTP method | Must be `GET` | All other methods return `405` |
| `symbol` | Required string; trimmed, uppercased, 1–32 characters; letters, digits, `.`, and `-` | Invalid input returns `400 BAD_REQUEST` |
| `date` | Optional exact calendar date in `YYYY-MM-DD` | Invalid input returns `400 BAD_REQUEST` |
| Other query parameters | Not used | Ignored |

An omitted date is passed through as omitted, so Alpha Vantage determines the returned session.

### 5. Provider failures and response limits

The no-persistence fetch path translates known Alpha Vantage failure modes into typed categories:

| Condition | HTTP status | Public code |
|---|---:|---|
| Provider rate-limit note or upstream `429` | 429 | `RATE_LIMITED` |
| Upstream timeout | 504 | `UPSTREAM_TIMEOUT` |
| Invalid provider response or other upstream failure | 502 | `UPSTREAM_ERROR` |
| Serialized success response exceeds 10 MiB | 413 | `RESPONSE_TOO_LARGE` |
| Unexpected handler failure | 500 | `INTERNAL_ERROR` |

The endpoint does not expose the Alpha Vantage API key or unfiltered provider error text.

### 6. Normalization and analysis

Each returned option contract is represented as a normalized object. All contract fields are optional because upstream fields may be absent or unusable.

- Identity fields such as `contractID`, `symbol`, `expiration`, and `date` are retained only when supplied as strings.
- `type` is retained only when it is the canonical `call` or `put` value.
- Numeric market fields remain strings when usable, preserving the upstream representation. Missing, whitespace-only, invalid, or non-finite values are omitted.

The analysis uses the following rules:

- `totalContracts` equals the entire returned normalized contract count.
- `totalVolume`, `totalOpenInterest`, and averages use every contract with a usable metric.
- `callContracts` and `putContracts` use contracts with a recognized `type`.
- Expiration and strike breakdowns use contracts with the relevant grouping fields plus a recognized `type`.
- `uniqueStrikes` counts usable normalized strike values regardless of option type.

This keeps the top-level total faithful to the provider response while avoiding directional or grouped claims where required fields are absent.

### 7. Persistence boundary

`partnerHistoricalOptionsV2` no longer reaches `AvHistoricalOptionsHandler`. It calls `HistoricalOptionsRetrievalService.fetch()`, which returns `{ response, analysis }` and performs no storage I/O.

`AvHistoricalOptionsHandler` now exists only as a thin adapter for the browser gateway. Its `fetch()` method delegates to `HistoricalOptionsRetrievalService.fetch()` and wraps the result in the base handler's response envelope. The legacy `fetchWithoutPersistence()` method has been removed.

No raw historical options chain is written to Firestore by the partner endpoint.

### 8. Logs and operational behavior

The handler emits bounded structured lifecycle events. It records a generated `requestId` and relevant safe fields such as HTTP status, normalized symbol, requested date, response byte size, contract count, provider duration, and endpoint processing duration.

It does not log bearer tokens, Alpha Vantage API keys, complete response bodies, or unbounded query content.

The deployed function is configured for:

| Setting | Value |
|---|---:|
| Memory | 1 GiB |
| Maximum instances | 10 |
| Timeout | 60 seconds |
| Maximum serialized response | 10 MiB |

The endpoint does not yet enforce a shared account-wide Alpha Vantage throttle. It can return `429 RATE_LIMITED` when Alpha Vantage rejects a request. The partner must avoid polling, deduplicate concurrent requests, and use bounded backoff.

---

## Part 2 — What happens, with implementation paths

### Deployment export and handler entry

- The Functions package exports `partnerHistoricalOptionsV2` from `functions/src/index.ts`.
- The function declaration is `partnerHistoricalOptionsV2 = onRequest(functionOptions, historicalOptionsPartnerHandler)` in `functions/src/v2/partner/historical-options-partner.ts`.
- `functionOptions` binds the three required secrets, memory, instance cap, and timeout.
- `historicalOptionsPartnerHandler` owns the endpoint lifecycle.

### Authentication and secrets

- `historical-options-partner.ts` declares and binds `ALPHAVANTAGE_API_KEY`, `ALLOWED_SERVICE_ACCOUNT_EMAILS`, and `EXPECTED_GOOGLE_AUDIENCE` with Firebase `defineSecret`.
- `historicalOptionsPartnerDependencies.hasExpectedGoogleAudience` checks that the configured audience secret has a usable comma-separated value.
- `authenticateRequestEither` in `functions/src/v2/utils/utils.ts` performs the shared authentication flow.
- `getExpectedGoogleAudiences` and `getAllowedServiceAccounts` in the same shared utility module provide the configured allowlists to authentication.
- The endpoint checks for the returned `serviceAccountEmail` property after shared authentication. The absence of that property means a Firebase identity was authenticated and is rejected for this service-account-only endpoint.

### Request parsing and endpoint errors

- `parseHistoricalOptionsRequest` in `functions/src/v2/partner/historical-options-request.utils.ts` normalizes and validates `symbol` and `date`.
- `HistoricalOptionsErrorCode` in that file is the canonical public endpoint-error enum.
- `mapHistoricalOptionsProviderError` maps `AlphaVantageUpstreamErrorCategory` values to HTTP status, public code, and safe response message.
- The handler builds direct endpoint failures with `{ ok: false, error, code, timestamp }`.

### Historical-options retrieval call

- `HistoricalOptionsRetrievalService` in `functions/src/v2/historical-options-corpus/services/historical-options-retrieval.service.ts` is instantiated directly by `historicalOptionsPartnerHandler`.
- `fetch()` builds the provider request, applies the configured `AvThrottle`, validates the response, normalizes contracts, computes analysis, and converts failures to `AlphaVantageUpstreamError`.
- `AvHistoricalOptionsHandler` in `functions/src/v2/alpha-vantage/handlers/av-historical-options.handler.ts` now delegates to the same service and is used only by the browser gateway.
- API-key resolution is centralized in `functions/src/v2/utils/utils.ts`; the partner endpoint itself never receives or returns the key.

### Provider response validation and typed failures

- `validateAlphaVantageApiResponse` in `functions/src/v2/alpha-vantage/utils/av-response-utils.ts` detects Alpha Vantage `Information`, `Note`, and `Error Message` response forms and throws `AlphaVantageProviderResponseError`.
- `toAlphaVantageUpstreamError` in `functions/src/v2/alpha-vantage/utils/av-upstream-error.utils.ts` converts provider-response errors and Axios transport errors into `RATE_LIMITED`, `TIMEOUT`, or `UPSTREAM_ERROR` categories.
- `HistoricalOptionsRetrievalService.fetch()` catches raw failures and applies `toAlphaVantageUpstreamError` before returning control to the partner handler.

### Contract normalization

- `HistoricalOptionsRetrievalService.transformResponse()` validates the presence of the provider `data` array and maps each item through `normalizeAvOptionContract`.
- `normalizeAvOptionContract` preserves only valid string identity fields, recognized `AvOptionType` values, and usable numeric values.
- `normalizeNumber` rejects missing, blank, invalid, and non-finite values rather than substituting zero.
- `AvOptionContract`, `AvHistoricalOptionsResponse`, `SvtOptionsAnalysis`, and related analysis interfaces are in `shared/alpha-vantage/av-historical-options.ts`.
- `AvOptionType` is the canonical shared `call` / `put` enum.

### Analysis

- `HistoricalOptionsRetrievalService.fetch()` calls `analyzeOptions` in `functions/src/v2/alpha-vantage/utils/av-analyze-options.ts` and returns the `analysis` object as part of `{ response, analysis }`.
- `parseOptionMetric` recognizes usable string metrics.
- `typedContracts` is used for call/put counts.
- `groupedContracts` is used for expiration and strike breakdowns.
- Summary totals and metric averages use the full normalized contract array where their required metric is present.
- The partner handler places the same `analysis` object directly in the public response envelope without recomputing it.

### Response serialization and logs

- `historicalOptionsPartnerHandler` creates the successful response envelope with `ApiProvider.ALPHA_VANTAGE` and `AlphaVantageEndpoint.HISTORICAL_OPTIONS`.
- The same handler uses `Buffer.byteLength(JSON.stringify(response), 'utf8')` to enforce `MAX_RESPONSE_BYTES`.
- The endpoint logger is created with `createLogger('[partner-historical-options]')`.
- Events include `historicalOptions.method_not_allowed`, `historicalOptions.audience_not_configured`, `historicalOptions.authentication_rejected`, `historicalOptions.firebase_auth_rejected`, `historicalOptions.invalid_request`, `historicalOptions.request`, `historicalOptions.provider_error`, `historicalOptions.response_too_large`, `historicalOptions.response`, and `historicalOptions.error`.

### Tests

- `functions/tests/v2/partner/historical-options-partner.test.ts` covers method handling, missing audience configuration, authentication stop behavior, Firebase rejection, invalid request input, typed provider failure, successful no-persistence envelope behavior, and response-size rejection.
- `functions/tests/v2/partner/historical-options-request.utils.test.ts` covers request normalization, date and symbol rejection, and typed provider-error mapping.
- `functions/tests/v2/alpha-vantage/utils/av-historical-options.test.ts` covers call/put counting, missing numeric metrics, incomplete-contract summary semantics, whitespace metrics, and provider error classification.
- `functions/tests/tsconfig.json` provides the test TypeScript project and shared-path alias resolution.

---

## Part 3 — Implementation and operations reference

### Public request contract

| Item | Value |
|---|---|
| Function export | `partnerHistoricalOptionsV2` |
| Deployed URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsV2` |
| HTTP method | `GET` only |
| Required query | `symbol` |
| Optional query | `date` (`YYYY-MM-DD`) |
| Authentication | Google OIDC ID token for an allowlisted service account |
| Browser use | Unsupported; this is server-to-server |
| Data source | Live Alpha Vantage `HISTORICAL_OPTIONS` request |
| Persistence | None in the partner path |

The deployed URL is environment-specific. Use the supplied URL as the request target and token audience unless Savant has validated an alternative configured audience for that deployed target. In every case, the token audience must also be in the shared `EXPECTED_GOOGLE_AUDIENCE` allowlist.

### Successful response shape

A successful response has this shape:

```json
{
  "ok": true,
  "symbol": "AAPL",
  "date": "2026-07-17",
  "source": "alpha-vantage",
  "endpoint": "HISTORICAL_OPTIONS",
  "data": {
    "endpoint": "HISTORICAL_OPTIONS",
    "message": "success",
    "data": []
  },
  "analysis": {
    "summary": {
      "totalContracts": 0,
      "totalVolume": 0,
      "totalOpenInterest": 0,
      "callContracts": 0,
      "putContracts": 0,
      "uniqueStrikes": 0,
      "avgVolumePerContract": 0,
      "avgOpenInterest": 0
    },
    "expirations": [],
    "strikes": []
  },
  "timestamp": "2026-07-20T00:00:00.000Z",
  "processingTimeMs": 0
}
```

When the caller omits `date`, the top-level response has `"date": null` and the provider selects its default session.

### Error envelopes

Endpoint-generated errors use:

```json
{
  "ok": false,
  "error": "Safe human-readable message",
  "code": "HISTORICAL_OPTIONS_ERROR_CODE",
  "timestamp": "2026-07-20T00:00:00.000Z"
}
```

| HTTP status | Code or envelope | Meaning |
|---:|---|---|
| 400 | `BAD_REQUEST` | Invalid or missing `symbol`, or invalid `date` |
| 401 / 403 | Shared authentication envelope | Missing, invalid, unauthorized, or audience-mismatched authentication; returns `{ error, message }` |
| 403 | `FORBIDDEN` | A valid Firebase identity was supplied instead of a required service-account identity |
| 405 | `METHOD_NOT_ALLOWED` | Method is not `GET` |
| 413 | `RESPONSE_TOO_LARGE` | Serialized success response exceeds 10 MiB |
| 429 | `RATE_LIMITED` | Alpha Vantage rate limit was reached |
| 502 | `UPSTREAM_ERROR` | Invalid or failed Alpha Vantage response |
| 504 | `UPSTREAM_TIMEOUT` | Alpha Vantage request timed out |
| 500 | `INTERNAL_ERROR` | Missing endpoint audience configuration or unexpected failure |

### Core source map

| Concern | Source |
|---|---|
| Function export | `functions/src/index.ts` |
| HTTP lifecycle | `functions/src/v2/partner/historical-options-partner.ts` |
| Request validation and public errors | `functions/src/v2/partner/historical-options-request.utils.ts` |
| Shared partner authentication and API-key resolution | `functions/src/v2/utils/utils.ts` |
| Historical-options retrieval seam | `functions/src/v2/historical-options-corpus/services/historical-options-retrieval.service.ts` |
| Browser gateway handler adapter | `functions/src/v2/alpha-vantage/handlers/av-historical-options.handler.ts` |
| Provider response validation | `functions/src/v2/alpha-vantage/utils/av-response-utils.ts` |
| Typed upstream-error conversion | `functions/src/v2/alpha-vantage/utils/av-upstream-error.utils.ts` |
| Options analysis | `functions/src/v2/alpha-vantage/utils/av-analyze-options.ts` |
| Shared historical-options contract | `shared/alpha-vantage/av-historical-options.ts` |
| Partner PRD | `docs/partner/options-data/historical-options-prd.md` |
| Discovery and onboarding guide | `docs/partner/options-data/historical-options-discovery.md` |
| RS consumer guide | `docs/partner/options-data/rs-historical-options-usage.md` |
| Review record | `docs/partner/options-data/historical-options-code-review.md` |
| Deployment work plan | `docs/project-plan/project-tasks.md` |

### Test commands

From the repository root, the focused checks are:

```powershell
npx tsc --noEmit -p functions/tsconfig.json
npx tsc --noEmit -p functions/tests/tsconfig.json
npx ts-node -r tsconfig-paths/register -P functions/tests/tsconfig.json functions/tests/v2/partner/historical-options-request.utils.test.ts
npx ts-node -r tsconfig-paths/register -P functions/tests/tsconfig.json functions/tests/v2/partner/historical-options-partner.test.ts
npx ts-node -r tsconfig-paths/register -P functions/tests/tsconfig.json functions/tests/v2/alpha-vantage/utils/av-historical-options.test.ts
```

### Deployment checklist

The implementation is code-complete, but the endpoint is not ready for unrestricted production use until these deployment tasks are complete:

1. Configure `ALPHAVANTAGE_API_KEY` and `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
2. Confirm RS mints tokens for the deployed endpoint URL, or another audience validated for that target, and that this value is in the shared comma-separated `EXPECTED_GOOGLE_AUDIENCE` allowlist.
3. Grant Cloud Run `roles/run.invoker` only to the approved partner service account; do not allow public invocation.
4. Validate an approved request in a non-production environment with the allowlisted service account.
5. Configure deployment-managed log-based metrics for request volume, failures, latency, upstream latency, invalid requests, provider rate limits, and response-size rejections.
6. Roll out gradually while monitoring `429`, `413`, `502`, and `504` responses.

The task plan records this work under **Task 4.3: Deploy Partner Historical Options Endpoint**.

### Explicit non-features and future work

The following are intentionally not part of the current endpoint:

- Browser use or a browser-facing CORS integration
- Firestore persistence for raw options chains
- GCS per-contract time-series corpus is implemented separately via `partnerHistoricalOptionsContractV2` (see `historical-options-contract-v2-discovery.md`); raw-chain GCS caching or archival remains not implemented
- Provider-result filtering beyond upstream normalization
- Pub/Sub readiness events
- Endpoint-local request accounting or rate limiting
- A shared account-wide Alpha Vantage throttle

A shared provider throttle remains a future task because it must coordinate Alpha Vantage quota consumption across partner endpoints, scheduled refreshes, and other direct provider consumers. It should be implemented as a provider-level capability without changing this endpoint's public contract.

### Related documents

- `historical-options-prd.md` is the product and technical contract.
- `historical-options-discovery.md` is the partner onboarding/discovery view.
- `rs-historical-options-usage.md` is the RS consumer integration guide.
- `historical-options-contract-v2-discovery.md` and `historical-options-contract-v2-usage.md` — per-contract time series endpoint and RS usage.
- `historical-options-code-review.md` records prior review findings and remediations.

This as-built guide explains how those contracts map onto the current source tree.
