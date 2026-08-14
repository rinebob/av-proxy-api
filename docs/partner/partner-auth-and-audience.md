# Partner Authentication and Audience (Gen2 Cloud Functions)

This document explains how partner HTTPS endpoints are secured and how to call them successfully with Google OIDC ID tokens. It focuses on 2nd‑gen Cloud Functions fronted by Cloud Run.

- Audience: Savant partner backends and internal maintainers
- Scope: All partner HTTPS endpoints. See `docs/partner/partner-endpoint-inventory.md` for the full list.

## Key Concepts

- __IAM Lockdown (Cloud Run front door)__
  - Remove `allUsers` from `roles/run.invoker`.
  - Grant `roles/run.invoker` only to allowlisted service accounts.
  - Cloud Functions (Gen2) calls into an underlying Cloud Run service; both the CF front door and the Run service must be invokable.

- __Dual-Auth in Code (authenticateRequestEither)__
  - Accepts either Firebase ID token or Google OIDC ID token.
  - For Google OIDC, we verify with tokeninfo and allow only when the `email` claim is in `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
  - We also enforce an audience (`aud`) check via `EXPECTED_GOOGLE_AUDIENCE`.

- __Per-Function Audience__
  - The Cloud Functions front door commonly expects the token `aud` to be the specific function URL (not just the base host).
  - Example function URLs:
    - `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListTrackedSymbolsV2`
    - `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2`
  - As a result, tokens minted with `aud` equal to the function URL are the most reliable.

- __Multi‑Audience Support (backend)__
  - Our middleware accepts multiple audiences by reading a comma-separated list from Secret Manager key `EXPECTED_GOOGLE_AUDIENCE`.
  - Recommended value: a comma-separated list of the base host plus each deployed function URL. See `docs/partner/partner-endpoint-inventory.md` for the full list of function URLs.
  - Example (subset):
    - `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net,https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListTrackedSymbolsV2,https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2,...`
  - This lets us support both the base host and per-function URLs at once, while the CF front door still typically requires the per-function URL.

## Required Configuration (Prod)

- __Secret Manager (mounted in functions)__
  - `ALLOWED_SERVICE_ACCOUNT_EMAILS`: comma-separated SAs allowed by the application.
  - `EXPECTED_GOOGLE_AUDIENCE`: comma-separated list of accepted audiences (see above).

- __IAM Bindings__
  - Cloud Run services (underlying Gen2 functions): grant `roles/run.invoker` to:
    - Partner SA(s), e.g., `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
    - The Google-managed CF admin SA: `service-29825344315@gcf-admin-robot.iam.gserviceaccount.com`
    - Internal caller SA(s), e.g., `maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com`

## Partner Token Minting (Server-to-Server)

- __Use per-function audience__

```bash
PROJECT="alpha-vantage-proxy-api"
REGION="us-central1"
HOST="https://${REGION}-${PROJECT}.cloudfunctions.net"
FN_LIST="partnerListTrackedSymbolsV2"
FN_TS="partnerTimeSeriesV2"
URL_LIST="${HOST}/${FN_LIST}"
URL_TS="${HOST}/${FN_TS}"
PARTNER_SA="rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com"

# partnerListTrackedSymbolsV2
TOKEN_LIST="$(gcloud auth print-identity-token \
  --audiences="${URL_LIST}" \
  --impersonate-service-account="${PARTNER_SA}" \
  --include-email)"
curl -i -H "Authorization: Bearer ${TOKEN_LIST}" \
  "${URL_LIST}?activeOnly=true&limit=500"

# partnerTimeSeriesV2
TOKEN_TS="$(gcloud auth print-identity-token \
  --audiences="${URL_TS}" \
  --impersonate-service-account="${PARTNER_SA}" \
  --include-email)"
curl -i -H "Authorization: Bearer ${TOKEN_TS}" \
  "${URL_TS}?symbol=AAPL&interval=daily"
```

- __Sanity-check a token__
```bash
# jq-free: print raw JSON
curl -s "https://oauth2.googleapis.com/tokeninfo?id_token=${TOKEN_TS}"
# aud should equal URL_TS; email should be the partner SA

# Optional (if jq is installed):
# curl -s "https://oauth2.googleapis.com/tokeninfo?id_token=${TOKEN_TS}" | jq .

# Windows PowerShell (format as table)
# (Invoke-RestMethod "https://oauth2.googleapis.com/tokeninfo?id_token=$env:TOKEN_TS") | Format-List
```

## Common Failure Modes

- __401 from Google Frontend (HTML)__
  - The CF front door rejected the token before our code. Most often the `aud` doesn’t match the function URL, or IAM forbids invocation.

- __403 JSON "Google ID token audience mismatch."__
  - The request reached our code, but our configured `EXPECTED_GOOGLE_AUDIENCE` list didn’t include your `aud`.
  - Fix: update the secret to include that audience, or mint with one of the accepted audiences.

- __403 JSON "Invalid or unauthorized Google ID token."__
  - Email claim is missing (no `--include-email`) or the email isn’t in `ALLOWED_SERVICE_ACCOUNT_EMAILS`.

- __403 IAM__
  - The partner SA lacks `roles/run.invoker` on the underlying service.

## Deployment & Ops Checklist

1. __Set secrets__
```bash
firebase functions:secrets:set ALLOWED_SERVICE_ACCOUNT_EMAILS
firebase functions:secrets:set EXPECTED_GOOGLE_AUDIENCE
```
2. __Deploy functions__
```bash
# Deploy all partner endpoints (see docs/partner/partner-endpoint-inventory.md for the full list)
firebase deploy --only "functions:partnerTimeSeriesV2,functions:partnerIntradaySnapshotV2,functions:partnerCompanyOverviewV2,functions:partnerListTrackedSymbolsV2,functions:partnerMarketHolidays,functions:partnerHistoricalOptionsV2,functions:partnerHistoricalOptionsContractV2,functions:partnerListContractsV2,functions:partnerContractCatalogV2,functions:partnerSpreadTimeSeries,functions:partnerSpreadTimeSeriesBatch,functions:partnerDataReadyPublishV2" --project "alpha-vantage-proxy-api"
```
3. __Grant invoker on Cloud Run services__
```bash
# Repeat for each partner endpoint service (see docs/partner/partner-endpoint-inventory.md)
gcloud run services add-iam-policy-binding partnerTimeSeriesV2 \
  --region us-central1 --project alpha-vantage-proxy-api \
  --member "serviceAccount:rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com" \
  --role roles/run.invoker

gcloud run services add-iam-policy-binding partnerListTrackedSymbolsV2 \
  --region us-central1 --project alpha-vantage-proxy-api \
  --member "serviceAccount:rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com" \
  --role roles/run.invoker
```
4. __Test with per-function audiences__ (see commands above)

## Notes

- For high-QPS scenarios, we may switch from `tokeninfo` to cached JWKS verification in the future.
- Do not call these endpoints from browsers; this is strictly backend-to-backend.
