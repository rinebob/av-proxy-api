# Partner Quickstart: Calling Savant Partner APIs (Gen2 Cloud Functions)

This quickstart is for partner backend teams (e.g., rel-str) integrating with our HTTPS partner endpoints running on Google Cloud Functions (2nd gen).

Use this doc to mint a Google OIDC ID token and call each endpoint successfully.

- Endpoints covered:
  - `partnerListTrackedSymbolsV2`
  - `partnerTimeSeriesV2`
- Region/Project:
  - Project: `alpha-vantage-proxy-api`
  - Region: `us-central1`
- Deep dive guide: see `docs/partner-auth-and-audience.md`

## 0) Prerequisites

- You have a Google Cloud service account (SA) that we have allowlisted and granted Cloud Run invoker:
  - Example: `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
- You can run `gcloud` with permission to impersonate that SA (roles/iam.serviceAccountTokenCreator).

## 1) Function URLs (audience per endpoint)

For 2nd‑gen Cloud Functions, the ID token audience (`aud`) must be the exact Cloud Functions function URL you are calling:

```bash
PROJECT="alpha-vantage-proxy-api"
REGION="us-central1"
HOST="https://${REGION}-${PROJECT}.cloudfunctions.net"
FN_LIST="partnerListTrackedSymbolsV2"
FN_TS="partnerTimeSeriesV2"
URL_LIST="${HOST}/${FN_LIST}"
URL_TS="${HOST}/${FN_TS}"
```

## 2) Mint a Google OIDC ID token (per function)

Always include the email claim and set audience to the function URL.

```bash
# Partner service account to impersonate
PARTNER_SA="rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com"

# Token for partnerListTrackedSymbolsV2
TOKEN_LIST="$(gcloud auth print-identity-token \
  --audiences="${URL_LIST}" \
  --impersonate-service-account="${PARTNER_SA}" \
  --include-email)"

# Token for partnerTimeSeriesV2
TOKEN_TS="$(gcloud auth print-identity-token \
  --audiences="${URL_TS}" \
  --impersonate-service-account="${PARTNER_SA}" \
  --include-email)"
```

Optional: inspect token (jq-free and PowerShell options)
```bash
# jq-free (prints raw JSON)
curl -s "https://oauth2.googleapis.com/tokeninfo?id_token=${TOKEN_TS}"
# Expect: aud == ${URL_TS}, email == ${PARTNER_SA}

# Windows PowerShell
# (Invoke-RestMethod "https://oauth2.googleapis.com/tokeninfo?id_token=$env:TOKEN_TS") | Format-List
```

## 3) Call the endpoints

Tracked symbols (GET):
```bash
curl -i -H "Authorization: Bearer ${TOKEN_LIST}" \
  "${URL_LIST}?activeOnly=true&limit=500"
```

Time series (GET) — AAPL, daily, last 1y by default:
```bash
curl -i -H "Authorization: Bearer ${TOKEN_TS}" \
  "${URL_TS}?symbol=AAPL&interval=daily"
```

Notes:
- Query params supported by time series include `symbol`, `interval` (daily|weekly|monthly), optional `range` (ytd|1y|3y|5y|max), `from`, `to`, `limit`.
- Responses are JSON; time series returns up to the requested range with AV-adjusted fields.

## 4) Common errors and fixes

- 401 HTML from "Google Frontend":
  - Cause: Cloud Functions front door rejected the token (audience mismatch or IAM).
  - Fix: ensure `aud` equals the function URL you are calling; confirm your SA has `roles/run.invoker`.

- 403 JSON `Google ID token audience mismatch.`:
  - Cause: Request reached our code but audience didn’t match the accepted list.
  - Fix: mint with the function URL as `aud`. (We already accept both the base host and each function URL.)

- 403 JSON `Invalid or unauthorized Google ID token.`:
  - Cause: `email` claim missing or SA email not allowlisted.
  - Fix: include `--include-email`; ask us to allowlist your SA email.

## 5) Support

- Share the failing curl, HTTP status, and the output of:
  - `gcloud run services get-iam-policy partnerListTrackedSymbolsV2 --region us-central1 --project alpha-vantage-proxy-api`
  - `gcloud run services get-iam-policy partnerTimeSeriesV2 --region us-central1 --project alpha-vantage-proxy-api`
- Contact: Savant engineering via your existing Slack channel.

## 6) Tracked Symbols Response Shape

The tracked symbols endpoint returns an object with a `symbols` array and paging/meta fields.

Example:
```json
{
  "ok": true,
  "symbols": [
    {
      "symbol": "AAPL",
      "name": "Apple Inc",
      "type": "Equity",
      "region": "United States",
      "marketOpen": "09:30",
      "marketClose": "16:00",
      "timezone": "UTC-04",
      "currency": "USD",
      "matchScore": "1.0000",
      "_createdAt": "2025-09-08T18:21:23.465Z",
      "_lastUpdated": "2025-09-08T18:21:23.465Z",
      "_isActive": true,
      "_refreshEnabled": false
    }
  ],
  "total": 9,
  "limit": 500,
  "offset": 0,
  "timestamp": "2025-10-21T16:08:51.884Z",
  "processingTimeMs": 1504
}
```

Notes for integrators:
- `symbols` is always present (use this array; we do not return `items`).
- `symbol` is uppercased and normalized.
- We do not currently emit `supported` or `isBaseline`; if you default `supported` to `true` when omitted, that aligns with our output.
- Paging fields: `total`, `limit`, `offset` may be useful for future paging; today we commonly return all active symbols within the specified `limit`.
- Timestamps are ISO strings; `processingTimeMs` is a simple server-side metric for visibility.

For a deeper reference, see `docs/partner-integration.md`.
