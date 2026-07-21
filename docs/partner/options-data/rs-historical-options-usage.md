# RS Usage Guide: Historical Options Partner API

**Status:** Deployed; Savant production smoke test passed; ready for RS acceptance testing
**Audience:** Relative Strength (RS) backend engineers  
**Last updated:** 2026-07-20

---

## 1. Purpose

Use `partnerHistoricalOptionsV2` to request one Alpha Vantage historical options chain for one equity symbol and an optional historical date.

This is an **on-demand** API. It is not driven by the `partner-data-ready` Pub/Sub topic and should not be included in the time-series A/B/C ingestion flow.

## 2. Security Requirements

Call this API only from the RS backend.

- Do not call it from browser code.
- Do not distribute service account keys or OIDC tokens to users.
- Use a service account that Savant has granted `roles/run.invoker` and added to the partner allowlist.
- Mint a Google OIDC ID token per the authentication flow below.
- Use the endpoint URL supplied by Savant for both the request and token audience unless Savant has validated another configured audience for that target. The token audience must also be in the shared allowed-audience list.

## 3. Endpoint

| Property | Value |
|---|---|
| Function | `partnerHistoricalOptionsV2` |
| Method | `GET` |
| Content type | `application/json` response |
| Authentication | `Authorization: Bearer <Google OIDC ID token>` |
| Required query parameter | `symbol` |
| Optional query parameter | `date` (`YYYY-MM-DD`) |
| Unknown query parameters | Ignored |

Set the URL only after onboarding:

```bash
OPTIONS_URL="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsV2"
```

The URL above is the deployed endpoint. Savant has completed a production smoke test; RS should now run its acceptance request using the approved service account.

## 4. Request Examples

### cURL / Google Cloud CLI

```bash
OPTIONS_URL="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsV2"
TOKEN="$(gcloud auth print-identity-token --audiences="${OPTIONS_URL}" --include-email)"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${TOKEN}" \
  "${OPTIONS_URL}?symbol=AAPL&date=2026-07-17"
```

Request the provider-default session by omitting `date`:

```bash
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${TOKEN}" \
  "${OPTIONS_URL}?symbol=MSFT"
```

### Node.js backend example

```ts
import { GoogleAuth } from 'google-auth-library';

const audience = 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsV2';
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
const client = await auth.getIdTokenClient(audience);

const url = new URL(audience);
url.searchParams.set('symbol', 'AAPL');
url.searchParams.set('date', '2026-07-17');

const response = await client.request({ url: url.toString(), method: 'GET' });
const payload = response.data;
```

## 5. Response Handling

Successful responses use this envelope:

```json
{
  "ok": true,
  "symbol": "AAPL",
  "date": "2026-07-17",
  "source": "alpha-vantage",
  "endpoint": "HISTORICAL_OPTIONS",
  "data": {
    "endpoint": "Historical Options",
    "message": "success",
    "data": [
      {
        "contractID": "AAPL260717C00200000",
        "symbol": "AAPL",
        "expiration": "2026-07-17",
        "strike": "200",
        "type": "call",
        "last": "12.3",
        "mark": "12.25",
        "bid": "12.1",
        "ask": "12.4",
        "volume": "155",
        "open_interest": "1002",
        "date": "2026-07-17",
        "implied_volatility": "0.24",
        "delta": "0.51",
        "gamma": "0.02",
        "theta": "-0.04",
        "vega": "0.11",
        "rho": "0.03"
      }
    ]
  },
  "analysis": {
    "summary": {
      "totalContracts": 1,
      "totalVolume": 155,
      "totalOpenInterest": 1002,
      "callContracts": 1,
      "putContracts": 0,
      "uniqueStrikes": 1,
      "avgVolumePerContract": 155,
      "avgOpenInterest": 1002
    },
    "expirations": [],
    "strikes": []
  },
  "timestamp": "2026-07-20T23:00:00.000Z",
  "processingTimeMs": 420
}
```

### Contract fields

| Field | Meaning |
|---|---|
| `contractID` | Vendor contract identifier |
| `symbol` | Underlying equity symbol |
| `expiration` | Option expiration date |
| `strike` | Strike price, returned as a string |
| `type` | `call` or `put`, when supplied by the provider |
| `last`, `mark`, `bid`, `ask` | Option prices, when provided |
| `volume`, `open_interest` | Vendor-reported activity values, when provided |
| `implied_volatility`, `delta`, `gamma`, `theta`, `vega`, `rho` | Vendor-supplied option metrics, when provided |

All contract fields are optional. Numeric values are strings. RS must parse them with validation and represent unavailable or invalid values as missing rather than as zero. `analysis.summary.totalContracts` equals the number of returned normalized contracts; directional and grouped analysis fields include only contracts with the fields required for that calculation.

## 6. Retry and Rate-Limit Policy

This request causes a live upstream vendor call. Treat it as an expensive, rate-limited dependency.

- Deduplicate concurrent requests for the same normalized `symbol` and `date` in RS.
- Avoid polling. Request only when RS has a concrete data need.
- On `429`, use bounded exponential backoff with jitter.
- Retry `502` and `504` at most two times with bounded backoff.
- Do not retry `400`, `401`, `403`, `405`, or `413` unchanged.
- Record request timestamp, symbol, date, HTTP status, and upstream error code in RS logs.

Suggested retry delays: 1 second, then 3 seconds. The final production policy may be tightened by Savant based on Alpha Vantage quota.

## 7. Failure Responses

```json
{
  "ok": false,
  "error": "Rate limit exceeded",
  "code": "RATE_LIMITED",
  "timestamp": "2026-07-20T23:00:00.000Z"
}
```

| Endpoint code or response | RS behavior |
|---|---|
| `BAD_REQUEST` | Fix `symbol` or `date`; do not retry unchanged. |
| Authentication middleware response (`401` / `403`) | Verify service account, IAM invoker role, email allowlist, and OIDC audience. The response contains `error` and `message`, not an endpoint `code`. |
| `FORBIDDEN` (`403`) | A valid Firebase identity was presented instead of the required service-account identity. Use the required service-account OIDC token. |
| `RESPONSE_TOO_LARGE` | Record the symbol/date and contact Savant; do not repeatedly retry. |
| `RATE_LIMITED` | Delay and retry according to the response guidance. |
| `UPSTREAM_ERROR` / `UPSTREAM_TIMEOUT` | Retry with bounded backoff. |
| `INTERNAL_ERROR` | Retry once or twice; report persistent errors. |

## 8. Onboarding Checklist

1. Send Savant the RS environment and service account email.
2. Receive the deployed endpoint URL and confirmed request limits.
3. Ensure RS can mint an OIDC token containing the service-account email.
4. Mint the token for the supplied endpoint URL unless Savant validates another target-accepted audience, and confirm that value is in Savant's shared allowed-audience list.
5. Run one approved symbol/date acceptance request.
6. Verify RS safely parses nullable string-valued numeric contract fields.
7. Enable production traffic gradually and monitor `429`, `413`, `502`, and `504` responses.

## 9. What RS Must Not Assume

- No Firestore-backed archive exists for raw chains in the initial release.
- No Pub/Sub data-ready event signals options availability.
- No request is guaranteed to be cached.
- Omitted `date` relies on Alpha Vantage's provider-default behavior.
- A valid request can return no usable contracts or an upstream error.
- Response fields and contract coverage originate with Alpha Vantage and can be absent.

## 10. Related Documents

- `historical-options-discovery.md` — service availability, auth model, limits, and onboarding.
- `historical-options-prd.md` — product scope, reliability controls, and rollout requirements.
- `../partner-integration.md` — shared partner authentication and IAM guidance.
