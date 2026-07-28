---
description: Post-code deployment steps required for every new or renamed partner HTTPS Cloud Function endpoint
---

# Deploy Partner Endpoint — Required Post-Code Steps

Every new or renamed partner HTTPS Cloud Function endpoint (e.g., `partnerContractCatalogV2`, `partnerListContractsV2`) requires these steps **after the code is written and committed** but **before telling the partner it's ready**. These steps are in addition to `firebase deploy`.

## Prerequisites

- `gcloud` CLI authenticated with access to `alpha-vantage-proxy-api` project
- The function name (e.g., `partnerContractCatalogV2`)
- The partner service account email(s) that need access

## Steps

### 1. Update `EXPECTED_GOOGLE_AUDIENCE` Secret

The `EXPECTED_GOOGLE_AUDIENCE` secret in Secret Manager is a comma-separated list of accepted audience URLs. Every new endpoint's function URL must be appended.

```bash
# Read the current value
gcloud secrets versions access latest --secret=EXPECTED_GOOGLE_AUDIENCE --project=alpha-vantage-proxy-api

# Append the new endpoint URL to the existing comma-separated list, then update:
echo "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net,<existing_urls>,https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/NEW_FUNCTION_NAME" | gcloud secrets versions add EXPECTED_GOOGLE_AUDIENCE --data-file=- --project=alpha-vantage-proxy-api
```

### 2. Grant `roles/run.invoker` on the Cloud Run Service

The underlying Cloud Run service for the new Gen2 function must allow the partner SA to invoke it.

```bash
gcloud run services add-iam-policy-binding NEW_FUNCTION_NAME \
  --region us-central1 \
  --project alpha-vantage-proxy-api \
  --member "serviceAccount:PARTNER_SA_EMAIL" \
  --role roles/run.invoker
```

Repeat for each partner SA that needs access. Also grant to the CF admin robot SA:

```bash
gcloud run services add-iam-policy-binding NEW_FUNCTION_NAME \
  --region us-central1 \
  --project alpha-vantage-proxy-api \
  --member "serviceAccount:service-29825344315@gcf-admin-robot.iam.gserviceaccount.com" \
  --role roles/run.invoker
```

### 3. Deploy Firestore Composite Indexes

If the endpoint queries Firestore with composite filters (equality + range + orderBy), the required composite indexes must be deployed **before** the endpoint will work for filtered queries. Indexes are defined in `firestore.indexes.json` but are not deployed automatically.

**Before deploying, check for existing indexes to avoid 409 conflicts.** Firestore auto-creates composite indexes when it receives a query that needs one (even if the query fails). These auto-created indexes will cause `firebase deploy` to abort with a 409 "index already exists" error if they're also defined in `firestore.indexes.json`.

```bash
# List all existing composite indexes
gcloud firestore indexes composite list --project=alpha-vantage-proxy-api --database='(default)' --format="table(name,fields,queryScope,state)"
```

Compare the existing indexes against the definitions in `firestore.indexes.json`. **Remove any already-existing index definitions from `firestore.indexes.json`** before deploying — the Firebase CLI aborts on the first 409 and won't create the remaining indexes.

Once duplicates are removed:

```bash
firebase deploy --only firestore:indexes --project "alpha-vantage-proxy-api"
```

Answer **N** when prompted to delete existing indexes not in the file — those are already deployed and deleting them could break other endpoints.

Indexes on large collections (100K+ docs) may take several minutes to build. Queries will fail with 500 until the index state is `READY`. Check build progress:

```bash
gcloud firestore indexes composite list --project=alpha-vantage-proxy-api --database='(default)' --filter="state:CREATING"
```

When that returns empty, all indexes are `READY`.

### 4. Deploy the Function

```bash
firebase deploy --only "functions:NEW_FUNCTION_NAME" --project "alpha-vantage-proxy-api"
```

The function must be redeployed after the secret is updated so the new revision mounts the latest secret value.

### 5. Verify

Mint a test token and call the endpoint:

```bash
TOKEN="$(gcloud auth print-identity-token \
  --audiences="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/NEW_FUNCTION_NAME" \
  --impersonate-service-account="PARTNER_SA_EMAIL" \
  --include-email)"

curl -i -H "Authorization: Bearer ${TOKEN}" \
  "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/NEW_FUNCTION_NAME?symbol=QQQ"
```

Expect HTTP 200. If you get 403 "Google ID token audience mismatch", the secret wasn't updated or the function wasn't redeployed. If you get 403 IAM, the invoker binding is missing.

### 6. Update Documentation

Update `docs/partner/partner-auth-and-audience.md` to include the new endpoint URL in the recommended audience list and the deploy/invoker examples.

## Common Partner Service Accounts

- `rel-str-caller@rel-str.iam.gserviceaccount.com`
- `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
- `maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com`
- `service-29825344315@gcf-admin-robot.iam.gserviceaccount.com` (CF admin robot)
