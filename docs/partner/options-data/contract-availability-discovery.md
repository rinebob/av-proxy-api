# Partner Contract Availability V1 — Discovery Document

**Status:** Deployed; serving the full options-enabled symbol universe; read-ceiling hardening committed and pending deploy  
**Audience:** Partner engineering and administrative teams  
**Last updated:** 2026-10-31

---

## Overview

`partnerContractAvailabilityV1` is a server-to-server HTTPS endpoint that answers, in one GET: **which option contracts for a symbol actually have historical time-series data**, and **which dates have corpus data**. It reads the `options-file-index/{symbol}/ts-contracts` Firestore catalog (the canonical index written by the time-series pipeline) and lists the GCS corpus objects under `historical-options/v1/{symbol}/`.

This is a **read-only, on-demand** API. It does not call Alpha Vantage; it serves pre-materialized catalog and corpus metadata maintained by the internal pipeline. It is a discovery/availability surface — the companion to the per-contract time-series endpoint (`partnerHistoricalOptionsContractV2`), which serves the actual series for a contract discovered here.

Unlike a contract catalog, entries include **expired contracts** while their time-series data remains — the correct source for "what can I actually fetch."

---

## Availability

| Item | Status |
|---|---|
| `partnerContractAvailabilityV1` Cloud Function | Deployed |
| `ts-contracts` catalog | Populated for all options-enabled symbols (nightly pipeline) |
| Corpus dates listing | Implemented (on-demand GCS object listing) |
| Symbol universe | All symbols with `optionsEnabled = true` (not a fixed allowlist) |
| Read-ceiling hardening (25k scanned-doc bound, Task #251) | Committed; pending deploy |

---

## Deployed Endpoint

| Property | Value |
|---|---|
| Function name | `partnerContractAvailabilityV1` |
| HTTP method | `GET` |
| Request URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerContractAvailabilityV1` |
| Direct Cloud Run URL | `https://partnercontractavailabilityv1-lsluydmucq-uc.a.run.app` |
| Authentication | Google OIDC ID token from an allowlisted service account |
| Data sources | Firestore `options-file-index` catalog + GCS `av-hist-options-corpus-bucket` |
| Request scope | One `symbol` + any combination of contract filters |
| Data delivery | Synchronous JSON response |
| Browser support | No. Server-to-server only. |

---

## Authentication Model

The endpoint uses the same dual-auth middleware as existing partner endpoints.

- Cloud Run IAM requires the caller to have `roles/run.invoker` on the deployed function.
- Application authorization requires the service account email to be in the `ALLOWED_SERVICE_ACCOUNT_EMAILS` secret.
- The caller sends `Authorization: Bearer <Google OIDC ID token>`.
- The ID token must include an `email` claim and uses the deployed endpoint URL as its audience. That audience must also be in `EXPECTED_GOOGLE_AUDIENCE`.
- A Firebase user identity token is rejected with `403 FORBIDDEN` — **service-account tokens only**.
- Never place service account credentials or token-minting capability in browser code.

The full SA setup guide — invoker grants, allowlisting, token verification, and failure modes — lives in [`partner-auth-and-audience.md`](../partner-auth-and-audience.md).

### Minting and calling (server-to-server)

The caller's backend mints a Google OIDC ID token whose audience is the
endpoint URL and whose `email` is the allowlisted service account, then
sends it as a bearer token. With `gcloud` impersonation:

```bash
SA="your-partner-sa@your-project.iam.gserviceaccount.com"
URL="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerContractAvailabilityV1"

TOKEN="$(gcloud auth print-identity-token \
  --impersonate-service-account="${SA}" \
  --audiences="${URL}" \
  --include-email)"

curl -H "Authorization: Bearer ${TOKEN}" "${URL}?symbol=QQQ&type=call&expirationLte=2026-06-30"
```

From application code (no `gcloud`), use a Google auth library's
`idTokenProvider`/`IdTokenClient` against the SA credentials with
`targetAudience = URL` — e.g. `google-auth-library` on Node or
`google.auth.transport.requests` on Python.

Sanity-check a minted token before debugging auth failures:

```bash
curl -s "https://oauth2.googleapis.com/tokeninfo?id_token=${TOKEN}"
# aud should equal the endpoint URL; email should be the allowlisted SA
```

---

## Request Parameters

| Parameter | Required | Format | Description |
|---|---:|---|---|
| `symbol` | Yes | Ticker symbol | Equity symbol, case-insensitive. Must be options-enabled. |
| `expirationGte` | No | `YYYY-MM-DD` | Inclusive lower bound on contract expiration. |
| `expirationLte` | No | `YYYY-MM-DD` | Inclusive upper bound on contract expiration. |
| `expirations` | No | Comma-separated `YYYY-MM-DD`, max 30 | Explicit expiration list. **Overrides** `expirationGte`/`expirationLte`. |
| `strikeGte` | No | Non-negative number | Inclusive lower bound on strike. |
| `strikeLte` | No | Non-negative number | Inclusive upper bound on strike. |
| `strikeStep` | No | Positive number | Strike must be an exact multiple (evaluated in integer cents — `0.05` steps work). |
| `type` | No | `call`, `put`, `C`, or `P` | Option type filter; absent = both. |
| `firstObservedGte` | No | `YYYY-MM-DD` | Inclusive lower bound on the contract's first observed date. |
| `firstObservedLte` | No | `YYYY-MM-DD` | Inclusive upper bound on the contract's first observed date. |

Unknown query parameters are ignored. Range pairs are validated (`gte <= lte`); `expirations` overrides the expiration range entirely.

### Filter precedence

When several range dimensions are present, one runs server-side as the primary range (`expiration` > `firstObserved` > `strike`) and the rest filter in memory — results are identical regardless; this only affects read cost.

---

## Response Semantics

A successful response contains:

- `ok: true`
- `symbol`
- `contracts` — catalog entries sorted by expiration asc → strike asc → `contractId` asc
- `count` — number of entries in `contracts`
- `truncated` — `true` when the 2,000-contract cap was hit **or** the server's read ceiling stopped the scan; either way more matches may exist
- `corpusDates` — `YYYY-MM-DD` dates with a corpus object for the symbol, sorted ascending
- `corpusDateCount`

Example response:

```json
{
  "ok": true,
  "symbol": "COST",
  "contracts": [
    {
      "contractId": "COST260515C00900000",
      "expiration": "2026-05-15",
      "strike": 900,
      "type": "call",
      "firstObserved": "2026-01-05",
      "firstObservedDow": "Mon",
      "lastObserved": "2026-05-15",
      "lastObservedDow": "Fri",
      "observationCount": 90,
      "expectedObservationCount": 89,
      "contractLengthDays": 130,
      "contractLengthBucket": "6mo",
      "latestDelta": 0.48,
      "latestIv": 0.21
    }
  ],
  "count": 2000,
  "truncated": true,
  "corpusDates": ["2025-01-02", "2025-01-03", "2025-01-06"],
  "corpusDateCount": 533
}
```

### Contract entry fields

| Field | Type | Description |
|---|---|---|
| `contractId` | string | OCC-format contract identifier (e.g. `QQQ260116C00450000`). |
| `expiration` | string `YYYY-MM-DD` | Contract expiration. |
| `strike` | number | Strike price in dollars. |
| `type` | `'call' \| 'put'` | Option type. |
| `firstObserved` | string `YYYY-MM-DD` | First trading date with data for this contract. |
| `firstObservedDow` | string | Day of week for `firstObserved`. |
| `lastObserved` | string `YYYY-MM-DD` | Most recent trading date with data. |
| `lastObservedDow` | string | Day of week for `lastObserved`. |
| `observationCount` | number | Total daily observations. |
| `expectedObservationCount` | number | Trading days `firstObserved`→`expiration` (approximation). |
| `contractLengthDays` | number | Calendar days `firstObserved`→`expiration`. |
| `contractLengthBucket` | string | Length label (e.g. `3mo`, `1yr`). |
| `latest` | object? | Snapshot of most recent observation (absent on backfilled expired contracts). |
| `latestDelta` | number? | Delta from latest observation. |
| `latestIv` | number? | IV from latest observation. |

---

## Limits and Expected Behavior

- Symbols: any symbol with `optionsEnabled = true`. Others return `404 OPTIONS_NOT_ENABLED`.
- `contracts` is capped at **2,000** entries; `truncated: true` signals more matches may exist. Narrow with filters (expiration window, strike band, type) to untruncate.
- `truncated` is also set when the server-side **read ceiling** (25,000 scanned documents) stops a wide-range scan — an honest "more may exist" rather than a silent partial result.
- `expirations` accepts at most **30** dates per request; use the range params for larger sets.
- Wide unfiltered queries on very large symbols are the slow path — expect tens of seconds; keep ranges narrow for interactive use.
- Function timeout: **60 seconds**. Memory: **512 MiB**. Max instances: **20**.

---

## Error Handling

| HTTP | Code | Meaning / Consumer action |
|---|---|---|
| 200 | (none) | Success. |
| 400 | `BAD_REQUEST` | Missing/invalid `symbol`; malformed date/number params; `gte > lte` on any range; `expirations` over 30 dates or non-date values; invalid `type`/`strikeStep`. Correct the request. |
| 401 / 403 | (auth middleware) | Invalid or missing ID token, `aud` mismatch, email not allowlisted, or IAM invoker denied. |
| 403 | `FORBIDDEN` | A Firebase identity token was presented instead of a service-account ID token. |
| 404 | `OPTIONS_NOT_ENABLED` | Symbol is not in the options-enabled universe. |
| 405 | `METHOD_NOT_ALLOWED` | Only `GET` is supported. |
| 500 | `INTERNAL_ERROR` | Retry once or twice; report persistent failures with the response timestamp. |

---

## Integration Readiness Checklist

Before onboarding, partners should provide:

1. Environment name and service account email.
2. Confirmation that the caller is a backend service, not browser code.
3. Expected request volume, burst rate, and typical filter patterns.
4. Acceptance that `truncated` results require narrower filters — there is no paging cursor.
5. Agreement that `corpusDates` describes corpus coverage, not per-contract observation dates (use `firstObserved`/`lastObserved`/`observationCount` per entry).

Savant will provide:

1. The deployed endpoint URL.
2. IAM invoker access and application allowlisting.
3. A known-good `symbol` + filter set for acceptance testing.
4. Environment-specific operational limits.

---

## Related Documents

- `historical-options-contract-v2-discovery.md` — the per-contract time-series endpoint this discovery feed pairs with.
- `partner-auth-and-audience.md` — dual-auth model and audience configuration.
- `partner-endpoint-inventory.md` — full partner endpoint index.
- `docs/topics/213-options-data/213-237-238-PRD-…md` — product requirements (Thread #237).
- `docs/topics/213-options-data/213-242-251-CODE-REVIEW-…md` — read-ceiling implementation review (Task #251).
