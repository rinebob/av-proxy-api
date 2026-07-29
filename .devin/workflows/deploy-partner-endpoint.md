---
description: Post-code deployment steps required for every new or renamed partner HTTPS Cloud Function endpoint
---

# Deploy Partner Endpoint — Required Post-Code Steps

Every new or renamed partner HTTPS Cloud Function endpoint (e.g., `partnerContractCatalogV2`, `partnerListContractsV2`) requires these steps **after the code is written and committed** but **before telling the partner it's ready**. These steps are in addition to `firebase deploy`.

## Prerequisites

- `gcloud` CLI authenticated with access to `alpha-vantage-proxy-api` project
- The function name (e.g., `partnerContractCatalogV2`)
- The partner service account email(s) that need access

## Critical Gotchas (Learned the Hard Way)

1. **Cloud Run service names are lowercase.** The Firebase function name is camelCase (e.g., `partnerSpreadTimeSeries`), but the Cloud Run service name is all lowercase (e.g., `partnerspreadtimeseries`). Always use the lowercase name for `gcloud run services` commands. Verify with:
   ```powershell
   gcloud run services list --project=alpha-vantage-proxy-api --region=us-central1 --filter="metadata.name:partnerfunctionnamelowercase" --format="value(metadata.name)"
   ```

2. **`gcloud run services update-env-vars` does NOT exist.** Use `gcloud run services update` with `--set-env-vars` instead.

3. **`OPTIONS_TIME_SERIES_BUCKET` env var is NOT set automatically by Firebase deploy.** It must be set manually via `gcloud run services update` after the first deploy. The value is `av-options-time-series-bucket`.

4. **`rel-str-caller@rel-str.iam.gserviceaccount.com` does NOT exist.** Skip it when granting IAM bindings. Only these SAs exist and need invoker access:
   - `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
   - `maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com`
   - `service-29825344315@gcf-admin-robot.iam.gserviceaccount.com` (CF admin robot)

5. **PowerShell `curl` is aliased to `Invoke-WebRequest`, not real curl.** Use `curl.exe` for curl syntax, or use `Invoke-RestMethod` with PowerShell-native syntax. Do NOT use `Out-File -Encoding utf8` to write JSON bodies — it adds a BOM that breaks JSON parsing. Use `[System.IO.File]::WriteAllText()` instead.

6. **POST endpoints need a JSON body, not query params.** The verify step for POST endpoints must send a body. Use `Invoke-RestMethod` with `-Method POST -Body $json`.

## Steps

### 1. Update `EXPECTED_GOOGLE_AUDIENCE` Secret

The `EXPECTED_GOOGLE_AUDIENCE` secret in Secret Manager is a comma-separated list of accepted audience URLs. Every new endpoint's function URL must be appended.

```powershell
# Read the current value
gcloud secrets versions access latest --secret=EXPECTED_GOOGLE_AUDIENCE --project=alpha-vantage-proxy-api

# Append the new endpoint URL to the existing comma-separated list, then update:
echo "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net,<existing_urls>,https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/NEW_FUNCTION_NAME" | gcloud secrets versions add EXPECTED_GOOGLE_AUDIENCE --data-file=- --project=alpha-vantage-proxy-api
```

### 2. Grant `roles/run.invoker` on the Cloud Run Service

The underlying Cloud Run service for the new Gen2 function must allow the partner SAs to invoke it. **Use the lowercase service name** (see Gotcha #1).

```powershell
# Verify the lowercase service name first
gcloud run services list --project=alpha-vantage-proxy-api --region=us-central1 --filter="metadata.name:newfunctionname" --format="value(metadata.name)"

# Grant for each SA (see Gotcha #4 — only these 3 exist):
gcloud run services add-iam-policy-binding NEW_FUNCTION_NAME_LOWERCASE --region us-central1 --project alpha-vantage-proxy-api --member "serviceAccount:rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com" --role roles/run.invoker

gcloud run services add-iam-policy-binding NEW_FUNCTION_NAME_LOWERCASE --region us-central1 --project alpha-vantage-proxy-api --member "serviceAccount:maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com" --role roles/run.invoker

gcloud run services add-iam-policy-binding NEW_FUNCTION_NAME_LOWERCASE --region us-central1 --project alpha-vantage-proxy-api --member "serviceAccount:service-29825344315@gcf-admin-robot.iam.gserviceaccount.com" --role roles/run.invoker
```

### 3. Set Environment Variables (if needed)

If the function uses `OPTIONS_TIME_SERIES_BUCKET` (any endpoint that reads from GCS options time series), set it manually — Firebase deploy does NOT set it automatically.

```powershell
# Use 'gcloud run services update' with --set-env-vars (NOT 'update-env-vars' which doesn't exist)
gcloud run services update NEW_FUNCTION_NAME_LOWERCASE --region=us-central1 --project=alpha-vantage-proxy-api --set-env-vars "OPTIONS_TIME_SERIES_BUCKET=av-options-time-series-bucket"
```

### 4. Deploy Firestore Composite Indexes (if needed)

If the endpoint queries Firestore with composite filters (equality + range + orderBy), the required composite indexes must be deployed **before** the endpoint will work for filtered queries. Indexes are defined in `firestore.indexes.json` but are not deployed automatically.

**Before deploying, check for existing indexes to avoid 409 conflicts.** Firestore auto-creates composite indexes when it receives a query that needs one (even if the query fails). These auto-created indexes will cause `firebase deploy` to abort with a 409 "index already exists" error if they're also defined in `firestore.indexes.json`.

```powershell
# List all existing composite indexes
gcloud firestore indexes composite list --project=alpha-vantage-proxy-api --database='(default)' --format="table(name,fields,queryScope,state)"
```

Compare the existing indexes against the definitions in `firestore.indexes.json`. **Remove any already-existing index definitions from `firestore.indexes.json`** before deploying — the Firebase CLI aborts on the first 409 and won't create the remaining indexes.

Once duplicates are removed:

```powershell
npx firebase deploy --only firestore:indexes --project "alpha-vantage-proxy-api"
```

Answer **N** when prompted to delete existing indexes not in the file — those are already deployed and deleting them could break other endpoints.

Indexes on large collections (100K+ docs) may take several minutes to build. Queries will fail with 500 until the index state is `READY`. Check build progress:

```powershell
gcloud firestore indexes composite list --project=alpha-vantage-proxy-api --database='(default)' --filter="state:CREATING"
```

When that returns empty, all indexes are `READY`.

### 5. Redeploy the Function

The function must be redeployed after the secret is updated so the new revision mounts the latest secret value.

```powershell
npx firebase deploy --only "functions:NEW_FUNCTION_NAME" --project "alpha-vantage-proxy-api"
```

### 6. Verify

#### For GET endpoints:

```powershell
$TOKEN = gcloud auth print-identity-token --audiences="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/NEW_FUNCTION_NAME" --impersonate-service-account="maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com" --include-email 2>$null
curl.exe -i -H "Authorization: Bearer $TOKEN" "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/NEW_FUNCTION_NAME?symbol=QQQ"
```

#### For POST endpoints (use Invoke-RestMethod — see Gotcha #5):

```powershell
$TOKEN = gcloud auth print-identity-token --audiences="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/NEW_FUNCTION_NAME" --impersonate-service-account="maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com" --include-email 2>$null
$body = @{ key="value" } | ConvertTo-Json -Depth 5
$headers = @{'Authorization'="Bearer $TOKEN";'Content-Type'='application/json'}
Invoke-RestMethod -Uri "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/NEW_FUNCTION_NAME" -Method POST -Headers $headers -Body $body
```

Expect HTTP 200. If you get 403 "Google ID token audience mismatch", the secret wasn't updated or the function wasn't redeployed. If you get 403 IAM, the invoker binding is missing. If you get 500 with "OPTIONS_TIME_SERIES_BUCKET environment variable is not configured", see Step 3.

### 7. Update Documentation

Update `docs/partner/partner-auth-and-audience.md` to include the new endpoint URL in the recommended audience list and the deploy/invoker examples.

## Common Partner Service Accounts

- `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
- `maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com`
- `service-29825344315@gcf-admin-robot.iam.gserviceaccount.com` (CF admin robot)

## Deployed Endpoints

| Function Name | Cloud Run Service Name | URL |
|---|---|---|
| `partnerSpreadTimeSeries` | `partnerspreadtimeseries` | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerSpreadTimeSeries` |
| `partnerSpreadTimeSeriesBatch` | `partnerspreadtimeseriesbatch` | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerSpreadTimeSeriesBatch` |
