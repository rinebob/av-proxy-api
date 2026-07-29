# Partner Spread Time Series — Discovery Document

**Status:** Single-spread and batch endpoints deployed; strategy scan pending (Phase 3)
**Audience:** Partner engineering and administrative teams
**Last updated:** 2026-07-28

---

## Overview

`partnerSpreadTimeSeries` and `partnerSpreadTimeSeriesBatch` are server-to-server HTTPS endpoints that compute and return historical time series for multi-leg options spread positions (verticals, straddles, strangles, iron condors). Unlike traditional charting software that shows theoretical expiration P/L diagrams, these endpoints return the **actual historical price of the spread over time** as a single daily time series — the same format as an individual stock or option contract.

The spread price is computed on-demand from the mark prices of the constituent option contracts, which are stored as per-contract JSONL files in GCS. No pre-computation or persistence of spread data is required.

This is a **read-only, on-demand** API. It does not call Alpha Vantage on each request; it serves pre-materialized per-contract time series and computes the spread series at request time.

---

## Availability

| Item | Status |
|---|---|
| `partnerSpreadTimeSeries` Cloud Function | Deployed |
| `partnerSpreadTimeSeriesBatch` Cloud Function | Deployed |
| GCS time-series corpus for `QQQ`/`TQQQ` | Available for QQQ (2019–present, nightly incremental); TQQQ pending |
| Spread types | Vertical, Straddle, Strangle, Iron Condor (Phase 1) |
| Symbol allowlist | `QQQ`, `TQQQ` only |

---

## Deployed Endpoints

### Single-Spread Endpoint

| Property | Value |
|---|---|
| Function name | `partnerSpreadTimeSeries` |
| HTTP method | `POST` |
| Request URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerSpreadTimeSeries` |
| Authentication | Google OIDC ID token from an allowlisted service account |
| Data source | GCS `av-options-time-series-bucket` (Alpha Vantage `HISTORICAL_OPTIONS` derived) |
| Request scope | One spread (2–4 legs), with optional `startDate`/`endDate` filter |
| Data delivery | Synchronous JSON response |
| Browser support | No. Server-to-server only. |
| Timeout | 30 seconds |
| Memory | 256 MiB |
| Max instances | 20 |
| Max response size | 10 MiB |

### Batch Endpoint (Phase 2)

| Property | Value |
|---|---|
| Function name | `partnerSpreadTimeSeriesBatch` |
| HTTP method | `POST` |
| Request URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerSpreadTimeSeriesBatch` |
| Authentication | Same as single endpoint |
| Request scope | Up to 200 spreads, with optional `startDate`/`endDate` filter |
| Data delivery | Synchronous JSON response |
| Browser support | No. Server-to-server only. |
| Timeout | 120 seconds |
| Memory | 1 GiB |
| Max spreads | 200 (hardcoded ceiling) |
| Max response size | 10 MiB |

---

## Authentication Model

Both endpoints use the same dual-auth middleware as existing partner endpoints.

### Cloud Run IAM

- The caller must have `roles/run.invoker` on the deployed Cloud Run service.
- Without this, Google's IAM rejects the request before it reaches the application code.

### Application Authorization

- The caller sends `Authorization: Bearer <Google OIDC ID token>`.
- The ID token must include an `email` claim.
- The service account email must be in the `ALLOWED_SERVICE_ACCOUNT_EMAILS` secret.
- The ID token audience must match the deployed endpoint URL.

### Expected Google Audience Secret

The `EXPECTED_GOOGLE_AUDIENCE` secret in Secret Manager contains a comma-separated list of audience URLs that the auth middleware will accept. When a new endpoint is deployed, its URL must be appended to this secret:

```
https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsContractV2,
https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerSpreadTimeSeries,
https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerSpreadTimeSeriesBatch
```

The function reads this at runtime via `getExpectedGoogleAudiences()` in `functions/src/v2/utils/utils.ts`. Without the endpoint URL in this secret, the auth middleware returns `403 "Google ID token audience mismatch."`

After updating the secret, the function must be redeployed so it mounts the updated secret value.

### Secrets Summary

| Secret | Purpose | Updated When |
|---|---|---|
| `ALLOWED_SERVICE_ACCOUNT_EMAILS` | Comma-separated list of service account emails allowed to call the endpoints | When a new partner is onboarded |
| `EXPECTED_GOOGLE_AUDIENCE` | Comma-separated list of accepted audience URLs | When a new endpoint is deployed |

Never place service account credentials or token-minting capability in browser code.

---

## Supported Spread Types

| Spread Type | Legs | Description |
|---|---|---|
| `vertical` | 2 | Same option type, same expiration, two different strikes. One long, one short. |
| `straddle` | 2 | Same strike, same expiration, one call + one put. Same direction (both long or both short). |
| `strangle` | 2 | Different strikes, same expiration, one call + one put. Same direction. |
| `iron_condor` | 4 | Same expiration, two calls + two puts, two long + two short, four different strikes. |

Each spread type has validation rules enforced server-side (see [Validation Rules](#validation-rules)).

---

## Request Shape

### Single-Spread Request

```json
{
  "spreadType": "vertical",
  "symbol": "QQQ",
  "legs": [
    {
      "expiration": "2024-07-19",
      "strike": 450,
      "optionType": "call",
      "direction": "long"
    },
    {
      "expiration": "2024-07-19",
      "strike": 455,
      "optionType": "call",
      "direction": "short"
    }
  ],
  "startDate": "2024-05-01",
  "endDate": "2024-07-18"
}
```

### Request Fields

| Field | Required | Type | Description |
|---|---:|---|---|
| `spreadType` | Yes | `"vertical" \| "straddle" \| "strangle" \| "iron_condor"` | Spread type. Acts as a validator for the legs array. |
| `symbol` | Yes | string | Underlying symbol. Case-insensitive. Only `QQQ` and `TQQQ` are accepted. |
| `legs` | Yes | array | 2–4 leg objects (see below). |
| `startDate` | No | string `YYYY-MM-DD` | Earliest observation date to include. |
| `endDate` | No | string `YYYY-MM-DD` | Latest observation date to include. |

### Leg Fields

| Field | Required | Type | Description |
|---|---:|---|---|
| `expiration` | Yes | string `YYYY-MM-DD` | Contract expiration date. |
| `strike` | Yes | number | Strike price (e.g., `450`, `455.5`). |
| `optionType` | Yes | `"call" \| "put"` | Call or put. |
| `direction` | Yes | `"long" \| "short"` | Long (buy) or short (sell). |

### Batch Request (Phase 2)

```json
{
  "spreads": [
    { "spreadType": "vertical", "symbol": "QQQ", "legs": [...] },
    { "spreadType": "strangle", "symbol": "QQQ", "legs": [...] }
  ],
  "startDate": "2024-05-01",
  "endDate": "2024-07-18"
}
```

The `startDate`/`endDate` filter applies to all spreads in the batch.

---

## Validation Rules

The server validates the legs array against the `spreadType`:

| Spread Type | Min Legs | Max Legs | Constraints |
|---|---|---|---|
| `vertical` | 2 | 2 | Same `optionType`, same `expiration`, different `strike`, one `long` + one `short` |
| `straddle` | 2 | 2 | Same `strike`, same `expiration`, one `call` + one `put`, same `direction` |
| `strangle` | 2 | 2 | Different `strike`, same `expiration`, one `call` + one `put`, same `direction` |
| `iron_condor` | 4 | 4 | Same `expiration`, two `call` + two `put`, two `long` + two `short`, all different `strike` |

Additional validation:
- `symbol` must be in the allowed set (`QQQ`, `TQQQ`).
- `expiration` must be a valid ISO date (`YYYY-MM-DD`).
- `strike` must be a positive number.
- If both `startDate` and `endDate` are present, `startDate` must be ≤ `endDate`.

The server does **not** validate financial sensibility (e.g., whether a vertical spread's long strike is below its short strike for a call debit spread). The consumer is responsible for constructing the spread they intend.

---

## Contract ID Resolution

The server constructs the OCC contract ID directly from each leg's parameters — no Firestore lookup is needed:

```
{SYMBOL}{YYMMDD}{C|P}{STRIKE×1000 padded to 8 digits}
```

Example: `QQQ`, expiration `2024-07-19`, call, strike `450` → `QQQ240719C00450000`

The constructed ID is used to read the contract's JSONL time-series file from GCS. If the file does not exist, the response includes a clear error identifying which leg failed and the constructed contract ID.

---

## Pricing Logic

### Spread Price

```
spreadPrice = sum(long leg marks) − sum(short leg marks)
```

The sign of the price indicates debit (positive) or credit (negative). A `debitOrCredit` field in the response envelope provides the structural classification for UI labeling.

### Spread Greeks

Greeks are linear — the portfolio Greeks are the signed sum of the individual leg Greeks already stored in the JSONL observations:

```
spreadDelta = sum(long leg deltas) − sum(short leg deltas)
spreadGamma = sum(long leg gammas) − sum(short leg gammas)
spreadTheta = sum(long leg thetas) − sum(short leg thetas)
spreadVega  = sum(long leg vegas)  − sum(short leg vegas)
spreadRho   = sum(long leg rhos)   − sum(short leg rhos)
```

No Black-Scholes computation is needed.

### Mark Resolution

The `mark` field is the canonical price for all calculations. If `mark` is missing from an observation, the server resolves it via a fallback chain:

1. Use `mark` if present
2. Compute `(bid + ask) / 2` if both are present
3. Carry forward the last known resolved mark from the previous observation
4. Skip the day only as a last resort

### Date Alignment

The spread series covers the **intersection** of all leg date ranges. The series starts on the latest `firstObserved` date across all legs and ends on the earliest `lastObserved` date.

Dates within the intersection range where one or more legs have unresolvable data are surfaced in a `gaps` array in the response.

### Debit/Credit Classification

`debitOrCredit` is computed once from the leg structure:

| Spread Type | Debit | Credit |
|---|---|---|
| Vertical (calls) | Long strike < short strike | Long strike > short strike |
| Vertical (puts) | Long strike > short strike | Long strike < short strike |
| Straddle / Strangle | `direction: "long"` | `direction: "short"` |
| Iron Condor | — | Always credit |

---

## Response Shape

### Single-Spread Response

```json
{
  "ok": true,
  "spreadType": "vertical",
  "symbol": "QQQ",
  "debitOrCredit": "debit",
  "startDate": "2024-05-01",
  "endDate": "2024-07-18",
  "gaps": ["2024-06-03"],
  "legs": [
    {
      "contractID": "QQQ240719C00450000",
      "expiration": "2024-07-19",
      "strike": 450,
      "optionType": "call",
      "direction": "long",
      "firstObserved": "2024-04-15",
      "lastObserved": "2024-07-18",
      "series": [
        { "date": "2024-04-15", "mark": 8.50 },
        { "date": "2024-04-16", "mark": 8.45 }
      ]
    },
    {
      "contractID": "QQQ240719C00455000",
      "expiration": "2024-07-19",
      "strike": 455,
      "optionType": "call",
      "direction": "short",
      "firstObserved": "2024-05-01",
      "lastObserved": "2024-07-18",
      "series": [
        { "date": "2024-05-01", "mark": 3.25 },
        { "date": "2024-05-02", "mark": 3.20 }
      ]
    }
  ],
  "series": [
    {
      "date": "2024-05-01",
      "price": 5.25,
      "delta": 0.23,
      "gamma": -0.0001,
      "theta": 0.03,
      "vega": -0.01,
      "rho": 0.02
    }
  ]
}
```

### Response Fields

#### Envelope

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` on success. |
| `spreadType` | string | The spread type from the request. |
| `symbol` | string | The underlying symbol. |
| `debitOrCredit` | `"debit" \| "credit"` | Structural classification for UI labeling. |
| `startDate` | string `YYYY-MM-DD` | Start of the returned series (intersection or filtered). |
| `endDate` | string `YYYY-MM-DD` | End of the returned series (intersection or filtered). |
| `gaps` | string[] | Dates within the range where the spread could not be computed. |
| `legs` | array | Per-leg metadata and leg time series (see below). |
| `series` | array | Spread time series (see below). |

#### Leg Object

| Field | Type | Description |
|---|---|---|
| `contractID` | string | OCC-style contract ID constructed from leg params. |
| `expiration` | string `YYYY-MM-DD` | Contract expiration. |
| `strike` | number | Strike price. |
| `optionType` | `"call" \| "put"` | Call or put. |
| `direction` | `"long" \| "short"` | Long or short. |
| `firstObserved` | string `YYYY-MM-DD` | First observation date in the contract's time series. |
| `lastObserved` | string `YYYY-MM-DD` | Last observation date in the contract's time series. |
| `series` | array | Leg time series: `{ date, mark }` per observation. |

#### Spread Observation

| Field | Type | Precision | Description |
|---|---|---|---|
| `date` | string `YYYY-MM-DD` | — | Observation date. |
| `price` | number | 2 decimals | Spread price: `sum(long marks) − sum(short marks)`. |
| `delta` | number | 2 decimals | Net delta. |
| `gamma` | number | 4 decimals | Net gamma. |
| `theta` | number | 2 decimals | Net theta. |
| `vega` | number | 2 decimals | Net vega. |
| `rho` | number | 2 decimals | Net rho. |

#### Leg Observation

| Field | Type | Precision | Description |
|---|---|---|---|
| `date` | string `YYYY-MM-DD` | — | Observation date. |
| `mark` | number | 2 decimals | Resolved mark price for this leg on this date. |

### Batch Response (Phase 2)

```json
{
  "ok": true,
  "total": 20,
  "succeeded": 17,
  "failed": 3,
  "results": [
    {
      "ok": true,
      "index": 0,
      "spreadType": "vertical",
      "symbol": "QQQ",
      "debitOrCredit": "debit",
      "startDate": "2024-05-01",
      "endDate": "2024-07-18",
      "gaps": [],
      "series": [...]
    },
    {
      "ok": false,
      "index": 1,
      "error": "Leg 0: contract QQQ240719P00440000 not found in GCS",
      "code": "NOT_FOUND"
    }
  ]
}
```

Batch results include spread series (price + Greeks) but **no leg series** — too much noise for multi-spread comparison. The consumer can call the single endpoint for detailed inspection of any specific spread.

#### Batch Response Fields

| Field | Type | Description |
|---|---|---|
| `ok` | boolean | `true` for the top-level envelope. |
| `total` | number | Total number of spreads in the batch. |
| `succeeded` | number | Number of spreads that computed successfully. |
| `failed` | number | Number of spreads that failed. |
| `results` | array | Per-spread results, ordered by original request index. |

#### Batch Item (Success)

| Field | Type | Description |
|---|---|---|
| `ok` | `true` | Indicates this spread succeeded. |
| `index` | number | Original position in the `spreads` array. |
| `spreadType` | string | The spread type from the request. |
| `symbol` | string | The underlying symbol. |
| `debitOrCredit` | `"debit" \| "credit"` | Structural classification for UI labeling. |
| `startDate` | string | Start of the returned series. |
| `endDate` | string | End of the returned series. |
| `gaps` | string[] | Dates within the range where the spread could not be computed. |
| `series` | array | Spread time series (same `SpreadObservation` shape as single endpoint). |

#### Batch Item (Failure)

| Field | Type | Description |
|---|---|---|
| `ok` | `false` | Indicates this spread failed. |
| `index` | number | Original position in the `spreads` array. |
| `error` | string | Human-readable error message. |
| `code` | string | Error code (`BAD_REQUEST`, `NOT_FOUND`, etc.). |

---

## Limits and Expected Behavior

- Allowed symbols: `QQQ` and `TQQQ` only. Any other symbol returns `400 BAD_REQUEST`.
- One spread per single-endpoint request; up to 200 spreads per batch request.
- The spread series covers the intersection of all leg date ranges. Legs with different start dates will produce a shorter series.
- `gaps` array surfaces dates where data integrity issues prevented computation — useful for identifying contracts that may need repair.
- The response is rejected with `413 RESPONSE_TOO_LARGE` if the serialized JSON exceeds **10 MiB**.
- All numeric values are JSON numbers (not strings).
- No caching — every request recomputes from GCS. Phase 4 will add caching.

---

## Error Handling

| HTTP | Code | Meaning / Consumer action |
|---|---|---|
| 200 | (none) | Success. |
| 400 | `BAD_REQUEST` | Missing/invalid `symbol`, `spreadType`, `legs`; validation failure; leg contract not found in GCS (with leg index and constructed contract ID). Correct the request. |
| 401 / 403 | (auth middleware) | Invalid or missing ID token, `aud` mismatch, email not allowlisted, or IAM invoker denied. |
| 403 | `FORBIDDEN` | A Firebase identity token was presented instead of a service-account ID token. |
| 405 | `METHOD_NOT_ALLOWED` | Only `POST` is supported. |
| 413 | `RESPONSE_TOO_LARGE` | Serialized response exceeded 10 MiB; narrow the date range or reduce batch size. |
| 500 | `INTERNAL_ERROR` | Retry once or twice; report persistent failures with the response timestamp. |

---

## Integration Readiness Checklist

Before onboarding, partners should provide:

1. Environment name and service account email.
2. Confirmation that the caller is a backend service, not browser code.
3. Expected request volume, burst rate, and typical spread types.
4. Acceptance that only `QQQ` and `TQQQ` are supported.
5. Agreement that numeric values are JSON numbers and may have fixed precision (2 decimals for price/delta/theta/vega/rho, 4 decimals for gamma).

Savant will provide:

1. The deployed endpoint URL(s).
2. IAM invoker access and application allowlisting.
3. The endpoint URL added to the `EXPECTED_GOOGLE_AUDIENCE` secret.
4. A known-good spread request for acceptance testing.
5. Environment-specific operational limits.

---

## Related Documents

- `spread-time-series-prd.md` — product requirements for the spread time series feature.
- `spread-time-series-implementation-plan.md` — implementation plan with file structure and tasks.
- `historical-options-contract-v2-discovery.md` — discovery doc for the single-contract endpoint (source data).
- `partner-auth-and-audience.md` — partner authentication and audience configuration details.
- `.devin/workflows/deploy-partner-endpoint.md` — post-deployment steps for new partner endpoints.
