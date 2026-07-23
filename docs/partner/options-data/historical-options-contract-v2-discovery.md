# Partner Historical Options Contract V2 — Discovery Document

**Status:** Deployed; 2019–2024 QQQ time series complete; 2025 QQQ backfill in progress; TQQQ pending; ready for partner acceptance testing  
**Audience:** Partner engineering and administrative teams  
**Last updated:** 2026-07-23

---

## Overview

`partnerHistoricalOptionsContractV2` is a server-to-server HTTPS endpoint that returns a per-contract historical options time series for a single option contract. The data is read from Google Cloud Storage (GCS) and is the canonical source for the `QQQ`/`TQQQ` historical options corpus built from Alpha Vantage `HISTORICAL_OPTIONS` data.

This is a **read-only, on-demand** API. It does not call Alpha Vantage on each request; it serves pre-materialized contract time series that are refreshed by a separate internal pipeline.

---

## Availability

| Item | Status |
|---|---|
| `partnerHistoricalOptionsContractV2` Cloud Function | Deployed |
| GCS time-series corpus for `QQQ`/`TQQQ` | Available for QQQ (2019–2024 complete, 2025 in progress); TQQQ not yet backfilled |
| Contract metadata resolution | Implemented (OCC-style `contractID` or GCS metadata fallback) |
| Date-range filtering | Implemented |
| Symbol allowlist | `QQQ`, `TQQQ` only |

---

## Deployed Endpoint

| Property | Value |
|---|---|
| Function name | `partnerHistoricalOptionsContractV2` |
| HTTP method | `GET` |
| Request URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsContractV2` |
| Authentication | Google OIDC ID token from an allowlisted service account |
| Data source | GCS `av-options-time-series-bucket` (Alpha Vantage `HISTORICAL_OPTIONS` derived) |
| Request scope | One `symbol` + one `contractID`, with optional `startDate`/`endDate` filter |
| Data delivery | Synchronous JSON response |
| Browser support | No. Server-to-server only. |

---

## Authentication Model

The endpoint uses the same dual-auth middleware as existing partner endpoints.

- Cloud Run IAM requires the caller to have `roles/run.invoker` on the deployed function.
- Application authorization requires the service account email to be in the `ALLOWED_SERVICE_ACCOUNT_EMAILS` secret.
- The caller sends `Authorization: Bearer <Google OIDC ID token>`.
- The ID token must include an `email` claim and normally uses the deployed endpoint URL as its audience. That audience must also be in `EXPECTED_GOOGLE_AUDIENCE`.
- Never place service account credentials or token-minting capability in browser code.

---

## Request Parameters

| Parameter | Required | Format | Description |
|---|---:|---|---|
| `symbol` | Yes | Ticker symbol | Equity symbol, case-insensitive. Only `QQQ` and `TQQQ` are accepted. |
| `contractID` | Yes | OCC-style contract ID | Identifies a single option contract. Must start with the supplied `symbol`. |
| `startDate` | No | `YYYY-MM-DD` | Earliest observation date to include. |
| `endDate` | No | `YYYY-MM-DD` | Latest observation date to include. |

Unknown query parameters are ignored.

### contractID format

The contractID follows OCC symbology:

```text
{SYMBOL}{YYMMDD}{C|P}{8-DIGIT-STRIKE}
```

- `SYMBOL` — underlying symbol (e.g., `QQQ`).
- `YYMMDD` — expiration date.
- `C` or `P` — call or put.
- `8-digit strike` — strike price multiplied by 1,000 and zero-padded.

Example: `QQQ260117C00050000` is a QQQ call expiring 2026-01-17 with a strike of `50`.

If the contractID cannot be parsed, the endpoint attempts to read matching metadata from the GCS object as a fallback.

---

## Response Semantics

A successful response contains:

- `ok: true`
- `symbol`, `contractID`, `expiration`, `type`, `strike`
- `startDate` and `endDate` reflecting the effective range of observations in the response
- `series` — an array of observations sorted by date ascending

Each observation follows the `TimeSeriesApiObservation` shape. All numeric values are strings and all fields except `date` are optional.

Example response:

```json
{
  "ok": true,
  "symbol": "QQQ",
  "contractID": "QQQ260117C00050000",
  "expiration": "2026-01-17",
  "type": "call",
  "strike": "50",
  "startDate": "2026-01-02",
  "endDate": "2026-01-15",
  "series": [
    {
      "date": "2026-01-02",
      "last": "1.23",
      "mark": "1.22",
      "bid": "1.20",
      "bid_size": "100",
      "ask": "1.25",
      "ask_size": "150",
      "volume": "500",
      "open_interest": "1200",
      "implied_volatility": "0.22",
      "delta": "0.51",
      "gamma": "0.02",
      "theta": "-0.04",
      "vega": "0.11",
      "rho": "0.03"
    }
  ]
}
```

### Observation fields

| Field | Type | Description |
|---|---|---|
| `date` | string `YYYY-MM-DD` | Observation date. Always present. |
| `last` | string? | Last trade price. |
| `mark` | string? | Mark price. |
| `bid` | string? | Bid price. |
| `bid_size` | string? | Bid size. |
| `ask` | string? | Ask price. |
| `ask_size` | string? | Ask size. |
| `volume` | string? | Traded volume. |
| `open_interest` | string? | Open interest. |
| `implied_volatility` | string? | Implied volatility. |
| `delta` | string? | Delta Greek. |
| `gamma` | string? | Gamma Greek. |
| `theta` | string? | Theta Greek. |
| `vega` | string? | Vega Greek. |
| `rho` | string? | Rho Greek. |

---

## Limits and Expected Behavior

- Allowed symbols: `QQQ` and `TQQQ` only. Any other symbol returns `400 BAD_REQUEST`.
- One contract per HTTP request.
- Observations are filtered by `startDate` and `endDate` after the full GCS object is read. Requesting a wide range narrows the returned JSON but does not reduce GCS read cost.
- The response is rejected with `413 RESPONSE_TOO_LARGE` if the serialized JSON exceeds **10 MiB**.
- Function timeout: **30 seconds**. Memory: **256 MiB**. Max instances: **20**.

---

## Error Handling

| HTTP | Code | Meaning / Consumer action |
|---|---|---|
| 200 | (none) | Success. |
| 400 | `BAD_REQUEST` | Missing/invalid `symbol`, `contractID`, `startDate`, or `endDate`; `startDate` > `endDate`; `contractID` does not start with `symbol`; symbol not in allowlist; or contract metadata cannot be resolved. Correct the request. |
| 401 / 403 | (auth middleware) | Invalid or missing ID token, `aud` mismatch, email not allowlisted, or IAM invoker denied. |
| 403 | `FORBIDDEN` | A Firebase identity token was presented instead of a service-account ID token. |
| 404 | `NOT_FOUND` | The GCS time-series object for the requested contract does not exist. |
| 405 | `METHOD_NOT_ALLOWED` | Only `GET` is supported. |
| 413 | `RESPONSE_TOO_LARGE` | Serialized response exceeded 10 MiB; narrow the date range. |
| 500 | `INTERNAL_ERROR` | Retry once or twice; report persistent failures with the response timestamp. |

---

## Integration Readiness Checklist

Before onboarding, partners should provide:

1. Environment name and service account email.
2. Confirmation that the caller is a backend service, not browser code.
3. Expected request volume, burst rate, and typical date-range patterns.
4. Acceptance that only `QQQ` and `TQQQ` are supported.
5. Agreement that numeric values are strings and may be missing for any observation.

Savant will provide:

1. The deployed endpoint URL.
2. IAM invoker access and application allowlisting.
3. A known-good `symbol` + `contractID` for acceptance testing.
4. Environment-specific operational limits.

---

## Related Documents

- `historical-options-prd.md` — product scope for the raw-chain partner endpoint.
- `historical-options-time-series-prd.md` — GCS corpus and contract time-series product requirements.
- `qqq-tqqq-options-corpus-implementation-plan.md` — corpus architecture, storage contract, and test plan.
- `historical-options-contract-v2-usage.md` — RS-specific request examples and retry policy.
