# Partner Integration Guide (Server-to-Server)

This guide explains how Savant partner backends should call the Partner Time Series API endpoint (`partnerTimeSeriesV2`) securely using Google OIDC service account tokens.

> Read order: Start with `docs/partner-discovery.md` for concepts, data shapes, and auth. Then use this integration guide for step-by-step setup and request examples.

> Note: This document targets the Partner Time Series endpoint only. As additional partner endpoints are introduced, we will publish separate guides or expand this document with dedicated sections.

## Operational Checklist (Quick Start)
- Remove `allUsers` invoker on Cloud Run; require authentication
- Grant `roles/run.invoker` to partner service accounts only
- Set partner auth config in Secret Manager (not plain env vars) and deploy:
  - `ALLOWED_SERVICE_ACCOUNT_EMAILS`
  - `EXPECTED_GOOGLE_AUDIENCE`
- Partner mints Google OIDC ID token with exact `aud` URL (the deployed service URL) and `--include-email`
- Test with curl; expect 200 for allowlisted SA, 403 for anonymous

## Internal vs. Partner Endpoints

- Internal browser-facing endpoints (e.g., `alphaVantageApiV2`, `benzingaApiV2`, `listSymbolsV2`) are for SavantApi.com internal use only. They are publicly invokable to allow browser preflight, but strictly restricted by an Origin allowlist in code and must not be used by partners.
- Partner endpoints (e.g., `partnerTimeSeriesV2`) are server-to-server, protected via dual-auth (Google OIDC ID tokens or Firebase ID tokens) with allowlisted service account emails. These services typically have public invoker removed at Cloud Run (IAM lockdown).

### IAM Lockdown and Allowlisting (Required)

Partner endpoints must be locked down at IAM and in application code.

- IAM (Cloud Run) controls who can invoke the HTTPS service
- App code (dual-auth) verifies the token and allowlists emails via `ALLOWED_SERVICE_ACCOUNT_EMAILS`

The calling principal must pass BOTH checks.

#### A) Cloud Console (UI) steps
1. Open Google Cloud Console → Cloud Run → Service `partnerTimeSeriesV2` (region `us-central1`).
2. Security tab → Ingress and Authentication:
   - Ensure Authentication is set to “Require authentication” (not “Allow unauthenticated invocations”).
3. Permissions tab → Principals:
   - Remove `allUsers` if present for role `Cloud Run Invoker`.
   - Click “Grant access” and add each partner service account email with role `Cloud Run Invoker (roles/run.invoker)`.
     - Example: `rel-str-caller@rel-str.iam.gserviceaccount.com`
4. Save changes and deploy a new revision if prompted.

#### B) gcloud (CLI) steps
Set variables:
```bash
PROJECT_ID=alpha-vantage-proxy-api
REGION=us-central1
SERVICE=partnerTimeSeriesV2
PARTNER_SA="rel-str-caller@rel-str.iam.gserviceaccount.com"
```

Remove public invoker (if present):
```bash
gcloud run services remove-iam-policy-binding "$SERVICE" \
  --region="$REGION" \
  --member=allUsers \
  --role=roles/run.invoker \
  --project="$PROJECT_ID"
```

Grant invoker to a partner service account:
```bash
gcloud run services add-iam-policy-binding "$SERVICE" \
  --region="$REGION" \
  --member="serviceAccount:$PARTNER_SA" \
  --role=roles/run.invoker \
  --project="$PROJECT_ID"
```

List and verify policy:
```bash
gcloud run services get-iam-policy "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID"
```

#### C) Application allowlist and audience (Secret Manager)
- Use Secret Manager for partner auth configuration (do not set plain env vars for these keys):
  - `ALLOWED_SERVICE_ACCOUNT_EMAILS`: comma-separated partner SA emails
  - `EXPECTED_GOOGLE_AUDIENCE`: exact base URL of the deployed service (used for `aud` validation)
- The function declares these secrets in code and reads them at runtime.
- Example (one-time setup):
```bash
firebase functions:secrets:set ALLOWED_SERVICE_ACCOUNT_EMAILS
firebase functions:secrets:set EXPECTED_GOOGLE_AUDIENCE
# Then redeploy the function so the revision mounts secrets
firebase deploy --only functions:partnerTimeSeriesV2
```

#### D) Partner token minting (Google OIDC)
- The partner backend should mint an ID token with:
  - `aud` (audience) equal to the exact deployed service URL (Cloud Run domain), for example:
    - `https://partnertimeseriesv2-<hash>-uc.a.run.app`
  - `--include-email` so the `email` claim is present

Examples:
```bash
# As a quick test from your side (impersonating a partner SA you’ve granted invoker):
gcloud auth print-identity-token \
  --impersonate-service-account="rel-str-caller@rel-str.iam.gserviceaccount.com" \
  --audiences="https://partnertimeseriesv2-<hash>-uc.a.run.app" \
  --include-email
```

#### E) Verification and common failure modes
- Anonymous request → 403/401 (IAM) if unauthenticated invocations are not allowed (expected)
- Valid ID token but SA not granted `roles/run.invoker` → 403 (IAM denied)
- SA has invoker but `email` not in `ALLOWED_SERVICE_ACCOUNT_EMAILS` → 403 (app-level deny)
- `aud` mismatch → 401/403 (token rejected); ensure the audience is the exact service URL
- Missing `email` claim → 401/403; ensure `--include-email` was used when minting tokens

## 1) Get your service account allowlisted
- Provide your service account email(s) to us. We will add them to the Secret Manager key:
  - `ALLOWED_SERVICE_ACCOUNT_EMAILS="partner-sa@partner-proj.iam.gserviceaccount.com,another-sa@partner-proj.iam.gserviceaccount.com"`
- We use dual-auth middleware (`authenticateRequestEither`) to verify Google OIDC tokens and allow only allowlisted emails.

## 2) Determine the audience (aud)
- Use the deployed Cloud Run service URL as the audience. Example:
  - `https://partnertimeseriesv2-<hash>-uc.a.run.app`
- Your OIDC ID token must be minted with this audience so we can validate it correctly.

## 3) Obtain a Google OIDC ID token in your backend

### cURL (for testing)
```bash
curl -G \
  -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences=https://partnertimeseriesv2-<hash>-uc.a.run.app --include-email)" \
  "https://partnertimeseriesv2-<hash>-uc.a.run.app" \
  --data-urlencode "symbol=AAPL" \
  --data-urlencode "interval=DAILY" \
  --data-urlencode "range=1y"
```

### Node.js (google-auth-library)
```ts
import { GoogleAuth } from 'google-auth-library';

async function callPartnerApi() {
  const audience = 'https://partnertimeseriesv2-<hash>-uc.a.run.app';
  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  const client = await auth.getIdTokenClient(audience);
  const url = `${audience}?symbol=AAPL&interval=DAILY&range=1y`;
  const resp = await client.request({ url, method: 'GET' });
  console.log(resp.data);
}

callPartnerApi().catch(console.error);
```

Placeholders to replace:
- `<hash>`: The generated hash segment in your Cloud Run URL.
- `partnerTimeSeriesV2`: The deployed function logical name. If you change it, update audience and URLs accordingly.
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
  "bars": [
    {
      "t": 1725494400000,
      "d": "2024-09-05",
      "o": 220.1,
      "h": 222.3,
      "l": 219.8,
      "c": 221.5,
      "v": 51234567,
      "ac": 221.5,
      "dv": 0,
      "sc": 1,
      "ch": 1.4,
      "cp": 0.64,
      "ic": null,
      "ipc": null
    }
  ],
  "timestamp": "2025-09-09T00:00:00.000Z",
  "truncated": false,
  "processingTimeMs": 37
}
```

Notes:
- `bars[].t` is epoch ms (UTC). `bars[].d` is an optional human-readable UTC date `YYYY-MM-DD` present on newer writes.
- Required adjusted fields for AV adjusted series: `ac` (adjusted close), `dv` (dividend), `sc` (split coefficient).
- `ch`/`cp` are derived day-over-day change metrics; `ic`/`ipc` are intraday change metrics present on pre-close snapshots.
- Ascending time order. Missing days (holidays) are naturally absent.
- `availableYears` mirrors our year-sharded storage for non-intraday intervals.

## 6) Troubleshooting
- 401/403 errors:
  - Verify you’re sending `Authorization: Bearer <id_token>` (ID token, not access token)
  - Ensure the `aud` matches the function URL
  - Confirm your service account email is allowlisted in `ALLOWED_SERVICE_ACCOUNT_EMAILS` (Secret Manager)
  - If IAM denies invoker, request allowlisting or check your Cloud Run permissions
- 404 Not Found:
  - Verify `symbol` exists and data has been initialized; reach out if you need us to initialize new symbols
- 400 Bad Request:
  - Check `interval`, `range`, and date formats
- Additional note:
  - Internal endpoints (SavantApi.com internal use only) are blocked for partner use by an Origin allowlist and should not be targeted by partner backends.

## 7) Logs & Debugging
- Set log verbosity temporarily:
```bash
gcloud run services update partnerTimeSeriesV2 \
  --region=us-central1 \
  --project=alpha-vantage-proxy-api \
  --set-env-vars=LOG_LEVEL=debug
```
- Read recent logs:
```bash
gcloud run services logs read partnerTimeSeriesV2 \
  --region us-central1 \
  --project alpha-vantage-proxy-api \
  --limit 200
```
- Look for structured events like `reader.start`, `reader.yearsToRead`, `reader.year.loaded`, `reader.postFilter`.
- Set back to info when done:
```bash
gcloud run services update partnerTimeSeriesV2 \
  --region=us-central1 \
  --project=alpha-vantage-proxy-api \
  --set-env-vars=LOG_LEVEL=info
```

## 8) Notes for copying to other partner projects
- Keep the server-to-server flow (backend-to-backend). Do not call from browsers.
- Rotate service account keys and constrain IAM permissions to least privilege.
- We can add multiple SA emails if you have separate environments (dev/stage/prod).

## 9) Deploy & Allowlist Checklist

1. Add partner service account email(s) to the allowlist Secret Manager key on the deployed service:
   - Key: `ALLOWED_SERVICE_ACCOUNT_EMAILS`
   - Value (comma-separated): `maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com,rel-str-caller@rel-str.iam.gserviceaccount.com`
2. Set audience Secret Manager key:
   - Key: `EXPECTED_GOOGLE_AUDIENCE`
   - Value: your deployed service URL (e.g., `https://partnertimeseriesv2-<hash>-uc.a.run.app`)
3. Deploy a new revision so the function mounts the secrets.
4. Partner backend: mint a Google OIDC ID token with `aud` = service URL and include email (`--include-email`).
5. Call the `partnerTimeSeriesV2` endpoint with `Authorization: Bearer <id_token>`.

## 10) TTLs and Schedules (Reference)

- TTLs are defined on endpoint configuration objects (defaults), not in scheduler code:
  - AV: `@shared/alpha-vantage` (`AV_ENDPOINT_CONFIGS`, `AV_TIME_SERIES_ENDPOINT_CONFIGS`)
- Cron schedules are defined in `functions/src/v2/common/function-schedules.ts` and control when refresh jobs run; they do not define TTLs.
- Partners do not need to trigger refresh; reads come from Firestore.

## 11) Audit & Monitoring
- View Cloud Run → Logs for `partnerTimeSeriesV2` to audit invocations and denials
- Suggested Cloud Logging filter (adjust project/region/service as needed):
```
resource.type="cloud_run_revision"
resource.labels.service_name="partnerTimeSeriesV2"
severity>=WARNING OR httpRequest.status=403 OR httpRequest.status=401
```
- Use “Extract fields” or a structured log sink to alert on repeated denials

## 12) Multi-Environment Guidance
- Repeat IAM lockdown and allowlisting per environment (dev/stage/prod)
- Use distinct partner SA principals per environment (e.g., `rel-str-caller-dev`, `rel-str-caller-prod`)
- Keep `ALLOWED_SERVICE_ACCOUNT_EMAILS` scoped to the env; avoid mixing environments

## 13) Onboarding / Offboarding Process
- Onboard:
  - Grant `roles/run.invoker` to partner SA on the service
  - Add SA email to `ALLOWED_SERVICE_ACCOUNT_EMAILS` (Secret Manager) and deploy
  - Provide audience URL and token minting instructions; validate with a test curl
- Offboard:
  - Remove SA from `ALLOWED_SERVICE_ACCOUNT_EMAILS` and deploy
  - Remove `roles/run.invoker` from the service
  - Optionally set up an alert when a removed SA attempts invocation
