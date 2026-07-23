# RS Usage Guide: Historical Options Contract V2 Partner API

**Status:** Deployed; 2019–2024 QQQ time series complete; 2025 QQQ backfill in progress; TQQQ pending  
**Audience:** Relative Strength (RS) backend engineers  
**Last updated:** 2026-07-23

---

## 1. Purpose

Use `partnerHistoricalOptionsContractV2` to request one historical options time series for a single `QQQ` or `TQQQ` contract. The response is read from GCS, not fetched live from Alpha Vantage, so treat it as a fast but bounded lookup.

This endpoint is **not** part of the `partner-data-ready` Pub/Sub ingestion flow and is not driven by `partnerHistoricalOptionsV2` (the raw-chain endpoint). It is a dedicated read path for the per-contract GCS corpus. Coverage begins at 2019-01-01 for QQQ; 2019–2024 are fully backfilled, and 2025 is in progress. TQQQ is on the allowlist but not yet backfilled.

---

## 2. Security Requirements

Call this API only from the RS backend.

- Do not call it from browser code.
- Do not distribute service account keys or OIDC tokens to users.
- Use a service account that Savant has granted `roles/run.invoker` and added to `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
- Mint a Google OIDC ID token per the flow below.
- Use the endpoint URL supplied by Savant for both the request and the token audience unless Savant has validated another configured audience for that target.

---

## 3. Endpoint

| Property | Value |
|---|---|
| Function | `partnerHistoricalOptionsContractV2` |
| Method | `GET` |
| Content type | `application/json` response |
| Authentication | `Authorization: Bearer <Google OIDC ID token>` |
| Required query parameters | `symbol`, `contractID` |
| Optional query parameters | `startDate` (`YYYY-MM-DD`), `endDate` (`YYYY-MM-DD`) |
| Unknown query parameters | Ignored |

Set the URL after onboarding:

```bash
CONTRACT_URL="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsContractV2"
```

The URL above is the deployed endpoint. Savant will provide a known-good `symbol` and `contractID` for the RS acceptance test.

---

## 4. Request Examples

### cURL / Google Cloud CLI

```bash
CONTRACT_URL="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsContractV2"
TOKEN="$(gcloud auth print-identity-token --audiences="${CONTRACT_URL}" --include-email)"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${TOKEN}" \
  "${CONTRACT_URL}?symbol=QQQ&contractID=QQQ260117C00050000&startDate=2026-01-01&endDate=2026-01-15"
```

Request the full available history for a contract by omitting `startDate` and `endDate`:

```bash
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${TOKEN}" \
  "${CONTRACT_URL}?symbol=TQQQ&contractID=TQQQ260117P00025000"
```

### Node.js backend example

```ts
import { GoogleAuth } from 'google-auth-library';

const audience = 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsContractV2';
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
const client = await auth.getIdTokenClient(audience);

const url = new URL(audience);
url.searchParams.set('symbol', 'QQQ');
url.searchParams.set('contractID', 'QQQ260117C00050000');
url.searchParams.set('startDate', '2026-01-01');
url.searchParams.set('endDate', '2026-01-15');

const response = await client.request({ url: url.toString(), method: 'GET' });
const payload = response.data;
```

---

## 5. contractID format

The contractID follows OCC symbology:

```text
{SYMBOL}{YYMMDD}{C|P}{8-DIGIT-STRIKE}
```

- `SYMBOL` — underlying symbol (`QQQ` or `TQQQ`).
- `YYMMDD` — expiration date.
- `C` or `P` — call or put.
- `8-digit strike` — strike price multiplied by 1,000 and zero-padded.

Examples:

- `QQQ260117C00050000` — QQQ call expiring 2026-01-17, strike `50`.
- `TQQQ260117P00025000` — TQQQ put expiring 2026-01-17, strike `25`.

The value passed for `contractID` must start with the `symbol` value. If the contractID cannot be parsed, the endpoint attempts to read the GCS object's metadata for `expiration`, `type`, and `strike`.

---

## 6. Response Handling

Successful responses use this envelope:

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

### Field reference

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

All contract fields are optional. Numeric values are strings. RS must parse them with validation and represent unavailable or invalid values as missing rather than as zero.

---

## 7. Retry and Rate-Limit Policy

This endpoint reads from GCS, so it is not rate-limited by Alpha Vantage. It is still bounded by Cloud Run concurrency and a 10 MiB response size limit.

- Deduplicate concurrent requests for the same `symbol`/`contractID`/`startDate`/`endDate` in RS.
- Avoid polling. Request only when RS has a concrete data need.
- On `429` (Cloud Run concurrency or internal rate limiting), use bounded exponential backoff with jitter.
- On `500`, retry at most two times with bounded backoff.
- Do not retry `400`, `401`, `403`, `405`, or `413` unchanged.
- Record request timestamp, symbol, contractID, date range, HTTP status, and error code in RS logs.

Suggested retry delays: 1 second, then 3 seconds.

---

## 8. Failure Responses

```json
{
  "ok": false,
  "error": "Serialized response exceeds the 10 MiB size limit",
  "code": "RESPONSE_TOO_LARGE",
  "timestamp": "2026-07-22T23:00:00.000Z"
}
```

| Endpoint code or response | RS behavior |
|---|---|
| `BAD_REQUEST` | Fix `symbol`, `contractID`, `startDate`, or `endDate`; verify `contractID` starts with `symbol` and that the symbol is `QQQ` or `TQQQ`. Do not retry unchanged. |
| Authentication middleware response (`401` / `403`) | Verify service account, IAM invoker role, email allowlist, and OIDC audience. The response contains `error` and `message`, not an endpoint `code`. |
| `FORBIDDEN` (`403`) | A valid Firebase identity was presented instead of the required service-account identity. Use a service-account OIDC token. |
| `NOT_FOUND` (`404`) | The GCS object for the contract does not exist. Verify the `contractID` and `symbol` or contact Savant. |
| `RESPONSE_TOO_LARGE` (`413`) | Narrow `startDate`/`endDate` or contact Savant. Do not repeatedly retry. |
| `INTERNAL_ERROR` (`500`) | Retry once or twice; report persistent errors with the response timestamp. |

---

## 9. Onboarding Checklist

1. Send Savant the RS environment and service account email.
2. Receive the deployed endpoint URL and confirmed request limits.
3. Ensure RS can mint an OIDC token containing the service-account email.
4. Mint the token for the supplied endpoint URL unless Savant validates another target-accepted audience.
5. Run one approved `symbol`/`contractID` acceptance request with a known-good contract.
6. Verify RS safely parses nullable string-valued numeric contract fields.
7. Enable production traffic gradually and monitor `413`, `429`, and `500` responses.

---

## 10. What RS Must Not Assume

- Only `QQQ` and `TQQQ` symbols are supported.
- No live Alpha Vantage call is made per request.
- No Pub/Sub data-ready event signals contract availability.
- No request is cached beyond GCS.
- Omitted `startDate`/`endDate` returns the full stored history for the contract.
- A valid request can return no observations if the date filter excludes all stored data.
- Response fields and contract coverage originate with the GCS corpus and can be absent.

---

## 11. Related Documents

- `historical-options-contract-v2-discovery.md` — availability, auth model, limits, and onboarding.
- `historical-options-time-series-prd.md` — GCS corpus and contract time-series product requirements.
- `qqq-tqqq-options-corpus-implementation-plan.md` — corpus architecture, storage contract, and test plan.
- `../partner-integration.md` — shared partner authentication and IAM guidance.
