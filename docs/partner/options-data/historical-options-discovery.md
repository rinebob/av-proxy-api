# Partner Historical Options — Discovery Document

**Status:** Proposed; not yet deployed  
**Audience:** Partner engineering and administrative teams  
**Last updated:** 2026-07-20

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
| `partnerHistoricalOptionsV2` | Proposed; not yet deployed |
| GCS cache | Not implemented |

Do not integrate against the endpoint until Savant provides the deployed URL and confirms your service account has been granted access.

## Intended Endpoint

| Property | Value |
|---|---|
| Function name | `partnerHistoricalOptionsV2` |
| HTTP method | `GET` |
| Request URL | Provided during onboarding |
| Authentication | Google OIDC ID token from an allowlisted service account; Firebase ID token may be approved for internal callers |
| Upstream data source | Alpha Vantage `HISTORICAL_OPTIONS` |
| Request scope | One symbol and one optional historical date |
| Data delivery | Synchronous JSON response |
| Browser support | No. Server-to-server only. |

## Authentication Model

The endpoint will use the same dual-auth model as existing partner endpoints.

- Cloud Run IAM requires the caller to have `roles/run.invoker` on the deployed function.
- Application authorization requires the service account email in `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
- The caller sends `Authorization: Bearer <Google OIDC ID token>`.
- The ID token must include an email claim and must be minted with the exact deployed endpoint URL as its `aud` value.
- Never place service account credentials or token-minting capability in browser code.

## Request Parameters

| Parameter | Required | Format | Description |
|---|---:|---|---|
| `symbol` | Yes | Ticker symbol | Equity symbol, case-insensitive. The service normalizes it to uppercase. |
| `date` | No | `YYYY-MM-DD` | Historical trading date requested from Alpha Vantage. When omitted, Alpha Vantage determines the returned session. |

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

The service will enforce limits to protect Alpha Vantage quota and service stability.

- One symbol/date request per HTTP call.
- Per-partner request quotas and concurrency limits apply.
- Large responses may be rejected with `413 RESPONSE_TOO_LARGE` rather than streamed or truncated without notice.
- Requests can receive `429 RATE_LIMITED`; consumers must honor `Retry-After` when present and use exponential backoff with jitter.
- Upstream vendor failures can return `502 UPSTREAM_ERROR` or `504 UPSTREAM_TIMEOUT`.
- A date supported by request validation can still have no vendor data.

Exact quota values, maximum response size, and timeout will be communicated during onboarding because they may be adjusted based on vendor entitlement and observed payload sizes.

## Error Handling

| Status | Code | Consumer action |
|---:|---|---|
| 400 | `BAD_REQUEST` | Correct request parameters; do not retry unchanged. |
| 401 / 403 | `UNAUTHORIZED` / `FORBIDDEN` | Verify OIDC token, audience, IAM invoker role, and allowlisting. |
| 413 | `RESPONSE_TOO_LARGE` | Reduce request scope if a future filter is available; otherwise contact Savant. |
| 429 | `RATE_LIMITED` | Retry after the specified delay using backoff and jitter. |
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
3. Environment-specific quota and operational limits.
4. A test symbol/date and acceptance-test window.

## Related Documents

- `historical-options-prd.md` — delivery scope, non-goals, security controls, and rollout plan.
- `rs-historical-options-usage.md` — RS-specific authentication and request patterns.
- `../partner-integration.md` — shared partner authentication and operational guidance.
