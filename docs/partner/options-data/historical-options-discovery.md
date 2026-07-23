# Partner Historical Options — Discovery Document

**Status:** Deployed; Savant production smoke test passed for raw chain; `partnerHistoricalOptionsContractV2` deployed and serving QQQ per-contract time series; 2019–2024 QQQ complete; 2025 backfill in progress; TQQQ pending
**Audience:** Partner engineering and administrative teams  
**Last updated:** 2026-07-23

---

## Overview

Savant plans to provide historical options chains through a dedicated partner endpoint: `partnerHistoricalOptionsV2`.

The first release is intentionally different from the time-series and company-overview partner APIs: it is an authenticated, on-demand proxy to Alpha Vantage rather than a Firestore-backed reader. Full option chains can be too large for one Firestore document, so raw-chain persistence is not part of the initial service.

## Availability

| Item | Status |
|---|---|
| Internal AV historical-options handler | Implemented |
| Scheduled data refresh | Disabled for this endpoint |
| Raw-chain Firestore persistence | Not production-safe for large chains |
| `partnerHistoricalOptionsV2` | Deployed; Savant production smoke test passed; RS acceptance pending |
| `partnerHistoricalOptionsContractV2` (per-contract time series) | Deployed |
| Per-contract GCS time-series corpus | Implemented; 2019–2024 QQQ complete, 2025 QQQ in progress; TQQQ not yet backfilled |

Savant has validated the endpoint with the approved RS service account. RS should now run its own acceptance request before enabling production traffic.

## Deployed Endpoint

| Property | Value |
|---|---|
| Function name | `partnerHistoricalOptionsV2` |
| HTTP method | `GET` |
| Request URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsV2` |
| Authentication | Google OIDC ID token from an allowlisted service account |
| Upstream data source | Alpha Vantage `HISTORICAL_OPTIONS` |
| Request scope | One symbol and one optional historical date |
| Data delivery | Synchronous JSON response |
| Browser support | No. Server-to-server only. |

## Authentication Model

The endpoint uses the same dual-auth model as existing partner endpoints.

- Cloud Run IAM requires the caller to have `roles/run.invoker` on the deployed function.
- Application authorization requires the service account email in `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
- The caller sends `Authorization: Bearer <Google OIDC ID token>`.
- The ID token must include an email claim and normally uses the deployed endpoint URL as its audience so Cloud Functions/Run accepts the request. That audience must also be in the shared `EXPECTED_GOOGLE_AUDIENCE` allowlist; use another configured audience only after it has been validated for the deployed target. The endpoint rejects requests until the shared audience configuration is present.
- Never place service account credentials or token-minting capability in browser code.

## Request Parameters

| Parameter | Required | Format | Description |
|---|---:|---|---|
| `symbol` | Yes | Ticker symbol | Equity symbol, case-insensitive. The service normalizes it to uppercase. |
| `date` | No | `YYYY-MM-DD` | Historical trading date requested from Alpha Vantage. When omitted, Alpha Vantage determines the returned session. |

Unknown query parameters are ignored.

Example intended request:

```text
GET /partnerHistoricalOptionsV2?symbol=AAPL&date=2026-07-17
Authorization: Bearer <id_token>
```

## Response Semantics

The response will contain:

- A normalized request symbol and requested date.
- Alpha Vantage historical-options contracts in `data.data`.
- Derived aggregate analysis for the returned contracts, including call/put counts, volume, open interest, expiration summaries, and strike summaries.
- Service-generated `timestamp` and `processingTimeMs` fields.

`analysis.summary.totalContracts` equals the number of returned normalized contracts. Directional and grouped analysis fields include only contracts with the fields required for that calculation.

Contract market-data values are represented as strings because that is the upstream representation. Values can be missing or non-numeric. Consumers must treat every contract field as optional and parse numbers safely.

A successful response means the service received and normalized an Alpha Vantage response. It does not guarantee that every listed contract is current, complete, tradable, or suitable for investment decisions.

## Freshness and Caching

Initial release behavior:

- Each accepted request results in a live call to Alpha Vantage.
- No raw response is persisted to Firestore.
- The endpoint does not promise a service-side cache hit.
- The returned chain reflects the `date` requested or the provider's default session behavior when no date is specified.

A future release may use Google Cloud Storage (GCS) for a bounded server-side cache. This would not change the request contract, but it could mean a response is served from a recent cached object rather than a new vendor request. Any cache behavior and TTL will be documented before activation.

## Limits and Expected Behavior

The service applies its configured function capacity limits and Alpha Vantage's provider limits.

- One symbol/date request per HTTP call.
- Large responses may be rejected with `413 RESPONSE_TOO_LARGE` rather than streamed or truncated without notice.
- Requests can receive `429 RATE_LIMITED` when Alpha Vantage rejects a request; consumers should use bounded exponential backoff with jitter.
- Upstream vendor failures can return `502 UPSTREAM_ERROR` or `504 UPSTREAM_TIMEOUT`.
- A date supported by request validation can still have no vendor data.

Maximum response size and timeout will be communicated during onboarding because they may be adjusted based on vendor entitlement and observed payload sizes.

## Error Handling

| Status | Code | Consumer action |
|---:|---|---|
| 400 | `BAD_REQUEST` | Correct request parameters; do not retry unchanged. |
| 401 / 403 | Authentication middleware envelope | Verify OIDC token, audience, IAM invoker role, and allowlisting. The response contains `error` and `message`, not an endpoint `code`. |
| 403 | `FORBIDDEN` | A valid Firebase identity was presented instead of the required service-account identity. |
| 413 | `RESPONSE_TOO_LARGE` | Reduce request scope if a future filter is available; otherwise contact Savant. |
| 429 | `RATE_LIMITED` | Retry with bounded exponential backoff and jitter. |
| 502 / 504 | `UPSTREAM_ERROR` / `UPSTREAM_TIMEOUT` | Retry transiently with bounded exponential backoff. |
| 500 | `INTERNAL_ERROR` | Retry once or twice; report persistent failures with request timestamp and symbol/date. |

## Integration Readiness Checklist

Before onboarding, RS or another partner should provide:

1. Environment name and service account email.
2. Confirmation that the caller is a backend service, not browser code.
3. Expected request volume, burst rate, symbols, and date-use pattern.
4. Acceptance of the live-provider and rate-limit behavior.
5. Confirmation that the intended data use complies with the applicable vendor agreement.

Savant will provide:

1. The deployed endpoint URL.
2. IAM invoker access and application allowlisting.
3. Environment-specific operational limits.
4. A test symbol/date and acceptance-test window.

## Related Documents

- `historical-options-prd.md` — delivery scope, non-goals, security controls, and rollout plan.
- `rs-historical-options-usage.md` — RS-specific authentication and request patterns for the raw-chain endpoint.
- `historical-options-contract-v2-discovery.md` — contract time-series endpoint availability, auth model, limits, and onboarding.
- `historical-options-contract-v2-usage.md` — RS-specific contract time-series request examples and retry policy.
- `../partner-integration.md` — shared partner authentication and operational guidance.
