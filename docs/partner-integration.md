# Partner Integration Guide (Server-to-Server)

This guide explains how Savant partner backends should call the Partner Time Series API endpoint (`partnerTimeSeriesV2`) securely using Google OIDC service account tokens.

> Read order: Start with `docs/partner-discovery.md` for concepts, data shapes, and auth. Then use this integration guide for step-by-step setup and request examples.

> Note: This document targets the Partner Time Series endpoint only. As additional partner endpoints are introduced, we will publish separate guides or expand this document with dedicated sections.

## Internal vs. Partner Endpoints

- Internal browser-facing endpoints (e.g., `alphaVantageApiV2`, `benzingaApiV2`, `listSymbolsV2`) are for SavantApi.com internal use only. They are publicly invokable to allow browser preflight, but strictly restricted by an Origin allowlist in code and must not be used by partners.
- Partner endpoints (e.g., `partnerTimeSeriesV2`) are server-to-server, protected via dual-auth (Google OIDC ID tokens or Firebase ID tokens) with allowlisted service account emails. These services typically have public invoker removed at Cloud Run.

See also `functions/scripts/lockdown-invokers.ps1` (now opt-in and partner-only) for the policy on Cloud Run invoker bindings.

## 1) Get your service account allowlisted
- Provide your service account email(s) to us. We will add them to the function env var:
  - `ALLOWED_SERVICE_ACCOUNT_EMAILS="partner-sa@partner-proj.iam.gserviceaccount.com,another-sa@partner-proj.iam.gserviceaccount.com"`
- We use dual-auth middleware (`authenticateRequestEither`) to verify Google OIDC tokens and allow only allowlisted emails.

## 2) Determine the audience (aud)
- Use the deployed HTTPS function URL as the audience. Example:
  - `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2`
- Your OIDC ID token must be minted with this audience so we can validate it correctly.

## 3) Obtain a Google OIDC ID token in your backend

### cURL (for testing)
```bash
curl -G \
  -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences=https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2)" \
  "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2" \
  --data-urlencode "symbol=AAPL" \
  --data-urlencode "interval=DAILY" \
  --data-urlencode "range=1y"
```

### Node.js (google-auth-library)
```ts
import { GoogleAuth } from 'google-auth-library';

async function callPartnerApi() {
  const audience = 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2';
  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  const client = await auth.getIdTokenClient(audience);
  const url = `${audience}?symbol=AAPL&interval=DAILY&range=1y`;
  const resp = await client.request({ url, method: 'GET' });
  console.log(resp.data);
}

callPartnerApi().catch(console.error);
```

Placeholders to replace:
- `alpha-vantage-proxy-api`: Your GCP project ID (e.g., `alpha-vantage-proxy-api`).
- `partnerTimeSeriesV2`: The deployed function name. If you change it, update audience and URLs accordingly.
- Query params (`symbol`, `interval`, `range`): Replace with your desired values.

## 4) Request parameters
- `symbol` (required): e.g., `AAPL`
- `interval` (required): `DAILY` | `WEEKLY` | `MONTHLY`
- `range` (optional): `ytd` | `1y` | `3y` | `5y` | `max`
- `from` (optional): ISO date `YYYY-MM-DD` or epoch ms
- `to` (optional): ISO date `YYYY-MM-DD` or epoch ms
- `limit` (optional): Truncate to the last N bars after filtering (omit to receive all available)

Defaults:
- DAILY: last 1 year
- WEEKLY: last 5 years
- MONTHLY: all

Examples:
- Last 3 years of weekly bars: `?symbol=MSFT&interval=WEEKLY&range=3y`
- YTD monthly bars: `?symbol=NVDA&interval=MONTHLY&range=ytd`
- Explicit range: `?symbol=GOOGL&interval=DAILY&from=2024-01-01&to=2024-12-31`
- Limit to last 100 daily bars: `?symbol=AAPL&interval=DAILY&limit=100`

## 5) Expected response
```json
{
  "ok": true,
  "symbol": "AAPL",
  "interval": "DAILY",
  "provider": "av",
  "endpointDocId": "av-daily-adjusted",
  "rangeUsed": { "from": 1704768000000, "to": 1725849600000, "preset": "1y" },
  "availableYears": [2023, 2024],
  "count": 252,
  "bars": [{ "t": 1725494400000, "o": 220.1, "h": 222.3, "l": 219.8, "c": 221.5, "v": 51234567 }],
  "timestamp": "2025-09-09T00:00:00.000Z",
  "truncated": false
}
```

## 6) Troubleshooting
- 401/403 errors:
  - Verify you’re sending `Authorization: Bearer <id_token>` (ID token, not access token)
  - Ensure the `aud` matches the function URL
  - Confirm your service account email is allowlisted in `ALLOWED_SERVICE_ACCOUNT_EMAILS`
- 404 Not Found:
  - Verify `symbol` exists and data has been initialized; reach out if you need us to initialize new symbols
- 400 Bad Request:
  - Check `interval`, `range`, and date formats
- Additional note:
  - Internal endpoints (SavantApi.com internal use only) are blocked for partner use by an Origin allowlist and should not be targeted by partner backends.

## 7) Notes for copying to other partner projects
- Keep the server-to-server flow (backend-to-backend). Do not call from browsers.
- Rotate service account keys and constrain IAM permissions to least privilege.
- We can add multiple SA emails if you have separate environments (dev/stage/prod).

## 8) Deploy & Allowlist Checklist

1. Add partner service account email(s) to the allowlist env var on the deployed service:
   - Variable name: `ALLOWED_SERVICE_ACCOUNT_EMAILS`
   - Value (comma-separated): `maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com,rel-str-caller@rel-str.iam.gserviceaccount.com`
   - Location: Cloud Run > Service for `partnerTimeSeriesV2` > Edit & deploy new revision > Environment variables
2. Deploy a new revision so the function picks up the variable.
3. Partner backend: mint a Google OIDC ID token with `aud` = function URL and include email.
4. Call the `partnerTimeSeriesV2` endpoint with `Authorization: Bearer <id_token>`.

## 9) Windows PowerShell quick commands

Set variables:
```powershell
$AUD = "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2"
$SA  = "rel-str-caller@rel-str.iam.gserviceaccount.com"
$QUERY = "?symbol=AAPL&interval=DAILY&range=1y"
```

Mint ID token with email (service account impersonation):
```powershell
$ID_TOKEN = gcloud auth print-identity-token `
  --impersonate-service-account="$SA" `
  --audiences="$AUD" `
  --include-email
```

Verify token (should include an `email` claim for the SA):
```powershell
curl.exe "https://oauth2.googleapis.com/tokeninfo?id_token=$ID_TOKEN"
```

Call the `partnerTimeSeriesV2` endpoint (PowerShell):
```powershell
# Older PowerShell may require -UseBasicParsing; alternatively, use curl.exe
Invoke-WebRequest -Method GET -Uri "$AUD$QUERY" -Headers @{ Authorization = "Bearer $ID_TOKEN" }
```

Call the `partnerTimeSeriesV2` endpoint (curl.exe explicitly):
```powershell
$Curl = "$env:SystemRoot\System32\curl.exe"
& $Curl -G -H "Authorization: Bearer $ID_TOKEN" "$AUD" `
  --data-urlencode "symbol=AAPL" `
  --data-urlencode "interval=DAILY" `
  --data-urlencode "range=1y"
```

Troubleshooting tips:
- If you get 403, ensure `ALLOWED_SERVICE_ACCOUNT_EMAILS` on `partnerTimeSeriesV2` includes the SA and that the token has an `email` claim.
- If `print-identity-token` fails, ensure your user has `roles/iam.serviceAccountTokenCreator` on the SA or use a key-based activation for local testing.
- The `aud` must exactly equal the function URL above.
