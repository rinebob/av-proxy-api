# Alpha Vantage Proxy API - Test Scripts

Test scripts for the Alpha Vantage Proxy API.

## test-symbol-search.ts

Tests the SYMBOL_SEARCH endpoint against both emulator and production environments.

### Key Features

- Test against local emulator or production
- Compare raw vs processed API responses
- Automatic best symbol selection for Firestore
- Detailed request/response logging

### Symbol Selection Logic

1. Prefers US-based symbols with highest match score
2. Falls back to highest scoring global symbol if no US match
3. Saves selected symbol to Firestore with metadata

### Prerequisites

1. Node.js (v14+)
2. Firebase CLI installed and authenticated
3. Alpha Vantage API key in `.env.alpha-vantage-proxy-api`

### Setup

1. Create `.env.alpha-vantage-proxy-api` in `functions`:

```env
LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY=your_alpha_vantage_api_key
GCLOUD_PROJECT=your-firebase-project-id
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key
```

2. Install dependencies:
```bash
cd functions
npm install
```

### Usage

```bash
# Basic usage (emulator)
npx ts-node scripts/test-symbol-search.ts "walmart"

# Production test
npx ts-node scripts/test-symbol-search.ts --prod "walmart"

# Debug mode (shows raw responses)
npx ts-node scripts/test-symbol-search.ts --debug "walmart"
```

### Output

1. **RAW ALPHA VANTAGE RESPONSE**
   - Direct API response with all matches

2. **FIREBASE FUNCTION RESPONSE**
   - Processed response with selected symbol
   - Includes selection reason

For each section, you'll see:
- Request URL
- HTTP Status
- Duration
- Response body

### Troubleshooting

- **No matches**: Check API key and network
- **API errors**: Verify rate limits and key permissions
- **Firestore issues**: Ensure emulator is running for local tests

### Notes
- The script automatically handles URL encoding of search terms
- In production mode, the script makes actual API calls to your deployed Firebase functions
- The debug flag (`--debug`) shows the raw API responses for comparison
- All matches are returned in the API response, but only the best match is saved to Firestore
- Test script automatically handles symbol deduplication
- Results are cached based on TTL
- Firestore writes are idempotent

---

## test-save-tracked-symbol.ts

Tests the `saveTrackedSymbol` callable function by sending a test symbol object and verifying that it is correctly saved to Firestore. This script is designed to run against the local Firebase emulator.

### Key Features

-   Tests the `saveTrackedSymbol` cloud function directly.
-   Uses `axios` to simulate a client-side request to the local function emulator.
-   Constructs a sample `TrackedSymbol` object for the test.
-   Verifies that the data is successfully written to the Firestore emulator.
-   Provides clear logging for the function call and the Firestore verification step.

### Prerequisites

The prerequisites are the same as for `test-symbol-search.ts`. Ensure you have Node.js, Firebase CLI, and a configured `.env.alpha-vantage-proxy-api` file.

### Setup

Setup is the same as for `test-symbol-search.ts`.

### Usage

The script requires a symbol to be passed as a command-line argument.

```bash
# Basic usage (runs against the emulator)
npx ts-node scripts/test-save-tracked-symbol.ts GOOGL

# With debug flag (currently for logging purposes)
npx ts-node scripts/test-save-tracked-symbol.ts MSFT --debug
```

**Note:** The `--prod` flag is recognized but not implemented for this script. It will default to running against the emulator.

### Output

The script provides the following output:

1.  **Function Response**: The JSON response from the `saveTrackedSymbol` function call.
2.  **Firestore Verification**: A confirmation message and the full document data as it was saved in Firestore.

### Troubleshooting

-   **Connection Refused**: Ensure the Firebase emulators (especially Functions and Firestore) are running. You can start them with `firebase emulators:start`.
-   **Authentication Errors**: The script sends a mock `Authorization` header. If your function's security rules are stricter, you may need to provide a valid test token.
-   **Document Not Found**: Check the Firestore emulator UI to see if any data was written and verify the collection/document names match.

---

## test-refresh-dispatcher.ts

Tests the Alpha Vantage v2 refresh dispatcher end-to-end against the local Firebase emulators. It ensures a symbol exists in `tracked_symbols`, forces a refresh cycle via `runRefreshAlphaVantageDataV2({ force: true })`, and verifies expected Firestore writes for Daily Adjusted time-series.

### Key Features

- Ensures the provided symbol exists under `tracked_symbols/`
- Forces a refresh cycle regardless of TTL using the v2 manager
- Verifies the top-level `time-series/av-daily-adjusted` document exists and prints `metadata.lastUpdated`, `metadata.nextRefreshAt`, and `ttlSeconds`
- Designed for the local emulator workflow with `local-dev.env.alpha-vantage-proxy-api`

### Prerequisites

1. Firebase emulators running (Functions + Firestore)
2. `local-dev.env.alpha-vantage-proxy-api` present at `functions/local-dev.env.alpha-vantage-proxy-api` with at least:

```env
LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY=your_dev_av_key
GCLOUD_PROJECT=alpha-vantage-proxy-api
```

3. Build and copy shared packages so `@shared/*` imports resolve:

```bash
# From repo root
npm run build:shared
npm --prefix functions run copy-shared
```

### Script Path

- `functions/scripts/test-refresh-dispatcher.ts`

### Usage

Run from the `functions/` directory. You can optionally pass a symbol (defaults to `AAPL`).

```powershell
# From repo root
npm run build:shared
npm --prefix functions run copy-shared

# Then from functions/
cd functions

# AAPL by default
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/test-refresh-dispatcher.ts

# Specific symbol (e.g., MSFT)
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/test-refresh-dispatcher.ts MSFT
```

### What it does

- Loads emulator env and `.env.alpha-vantage-proxy-api`
- Adds the symbol to `tracked_symbols/{SYMBOL}` if missing
- Invokes `runRefreshAlphaVantageDataV2({ force: true })` to trigger all due AV refreshers immediately
- Reads `symbol-data/{SYMBOL}/time-series/av-daily-adjusted` and prints key metadata

Internals and imports used:
- `setupEmulator()` from `functions/scripts/scripts-util`
- `runRefreshAlphaVantageDataV2` from `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager`
- `getSymbolTimeSeriesDocPath` for canonical Firestore paths
- `@shared/alpha-vantage`, `@shared/core`, `@shared/firestore` enums and types

### Output / Verification

You should see logs like:

- "[dispatcher] adding <SYMBOL> to tracked_symbols..." or already present
- "[dispatcher] running runRefreshAlphaVantageDataV2({ force: true })..."
- Refresh result object
- "✅ Found Daily Adjusted metadata for <SYMBOL>"
- `lastUpdated=... nextRefreshAt=... ttlSeconds=...`

If the Daily Adjusted doc is missing, you'll see:

- `❌ Daily Adjusted doc not found for <SYMBOL>: <docPath>`

### Troubleshooting

- Cannot resolve `@shared/...` imports:
  - Ensure you ran `npm run build:shared` at the repo root and `npm --prefix functions run copy-shared`.
  - Invoke ts-node with `-r tsconfig-paths/register -r module-alias/register`.
- Emulator writes missing:
  - Confirm Firestore and Functions emulators are running.
  - Verify `.env.alpha-vantage-proxy-api` exists at `functions/.env.alpha-vantage-proxy-api` and includes `LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY`.
- AV key or networking issues:
  - For emulator, set `LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY`.
  - Optionally prefer IPv4 with `NODE_OPTIONS=--dns-result-order=ipv4first`.

### Notes

- This script is for local validation of the refresh manager. In production, the refresh is scheduled via `AV_REFRESH_MANAGER_SCHEDULE` and writes TTL/refresh metadata per endpoint.
- The verification step currently checks the top-level `time-series/av-daily-adjusted` doc; sharded bar writes are handled by the respective handlers.

---

## Testing Scripts for Cloud Functions

This directory contains scripts for testing various Cloud Functions locally.

## Testing with the Firebase Shell

The Firebase Functions shell provides an interactive environment to test your functions without deploying them.

**Starting the Shell:**

```bash
firebase functions:shell
```

**Important Note on Environment Variables:**

The Firebase shell can be inconsistent when loading environment variables from `.env` files (e.g., `.env.alpha-vantage-proxy-api`). Even if the shell reports that it has loaded the file, the variables may not be available within the `process.env` object of your function's runtime.

If you encounter errors related to missing API keys, you must set the environment variable manually within the shell session.

**Example: Testing the Benzinga News Refresh Function**

The following steps detail how to manually trigger the `fetchAndPersistBenzingaNews` function.

1.  **Start the Shell**:
    ```bash
    firebase functions:shell
    ```

2.  **Set the API Key**: Manually set the required API key in the shell's environment. **The quotes around the key are critical.**

    ```javascript
    // In the firebase > prompt
    process.env.BENZINGA_WIIM_API_KEY = "your_actual_benzinga_api_key"
    ```

3.  **Load the Function Module**: Use `require` to load the compiled JavaScript module for the function you want to test.

    ```javascript
    // In the firebase > prompt
    const bzNews = require("../lib/v2/benzinga/data-refresher/bz-news-request-manager")
    ```
    The shell will respond with `undefined`, which indicates the module was loaded successfully.

4.  **Execute the Function**: Call the desired function using `await`.

    ```javascript
    // In the firebase > prompt
    await bzNews.fetchAndPersistBenzingaNews()
    ```

    You should now see the function's log output, and if successful, the corresponding data will be written to the Firestore emulator.

---

## Lock down HTTPS function invokers (IAM)

Use Cloud Run IAM to restrict who can invoke your HTTPS Cloud Functions (Gen2). Remove public access (allUsers) and grant `roles/run.invoker` only to the identities you control (e.g., your frontend app’s service account or a CI/CD SA).

### Prerequisites
- gcloud CLI authenticated to the target project
- Know your Cloud Run region (e.g., `us-central1`)
- Service account email(s) that should be allowed to invoke

### Function service names
For Gen2, the Cloud Run service name typically matches the function name. You can confirm with:

```bash
PROJECT_ID="alpha-vantage-proxy-api"
REGION="us-central1"

gcloud run services list \
  --platform=managed \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="table(NAME,REGION)"
```

Target services in this repo:
- `alphaVantageApiV2`
- `benzingaApiV2`
- `listSymbolsV2`

### Remove public invoker (allUsers)
Run once per service:

```bash
PROJECT_ID="alpha-vantage-proxy-api"
REGION="us-central1"
SERVICE="alphaVantageApiV2" # alphaVantageApiV2 | benzingaApiV2 | listSymbolsV2

gcloud run services remove-iam-policy-binding "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --member="allUsers" \
  --role="roles/run.invoker" || true
```

### Grant invoker to specific identities
Grant to your app/backend service account(s):

```bash
PROJECT_ID="alpha-vantage-proxy-api"
REGION="us-central1"
SERVICE="alphaVantageApiV2"
INVOKER_SA="web-frontend@alpha-vantage-proxy-api.iam.gserviceaccount.com" # e.g. web-frontend@<alpha-vantage-proxy-api>.iam.gserviceaccount.com

gcloud run services add-iam-policy-binding "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:$INVOKER_SA" \
  --role="roles/run.invoker"
```

Repeat the grant for each allowed principal (service accounts, user emails, groups as needed).

### Verify effective policy

```bash
PROJECT_ID="alpha-vantage-proxy-api"
REGION="us-central1"
SERVICE="alphaVantageApiV2"

gcloud run services get-iam-policy "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format=json | jq '.bindings[] | select(.role=="roles/run.invoker")'
```

### Notes
- Application code-level auth (Firebase ID token) remains in place for defense-in-depth.
- After changing IAM on Cloud Run services, no redeploy is required; changes apply immediately.
- For browser clients, consider enabling Firebase App Check for additional protection.
- Keep IAM invoker allowlist minimal; remove `allUsers`.

---

## Dual-auth for internal HTTPS endpoints (Firebase ID or Google OIDC)

Internal gateways (e.g., `alphaVantageApiV2`, `benzingaApiV2`, `listSymbolsV2`) can accept either:
- Firebase ID token (standard app user auth), or
- Google OIDC token from an allowlisted service account (for internal automation), in addition to Cloud Run IAM.

### Configuration
- Set the allowlist of service accounts via an environment variable on each Cloud Run service:
  - Key: `allowed_service_account_emails`
  - Value: comma-separated emails (e.g., `maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com`)

Using gcloud (one-time per service):
```bash
PROJECT_ID="alpha-vantage-proxy-api"
REGION="us-central1"
VAL="maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com"

for SERVICE in alphavantageapiv2 benzingaapiv2 listsymbolsv2; do
  echo "Updating env var on $SERVICE ..."
  gcloud run services update "$SERVICE" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --update-env-vars allowed_service_account_emails="$VAL"
done
```

Or via Console:
- Cloud Run > Services > [service] > Edit > Variables & Secrets > Add variable
- Key: `allowed_service_account_emails`
- Value: `maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com`

### Deploy functions with dual-auth
```bash
firebase deploy --only functions:alphaVantageApiV2,functions:benzingaApiV2,functions:listSymbolsV2
```

### IAM (required)
Lock down HTTPS invokers to internal SAs only (see section above). Typical invoker: `maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com`.

### Curl test matrix (Google OIDC)
```bash
PROJECT_ID="alpha-vantage-proxy-api"
REGION="us-central1"
INVOKER_SA="maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com"

# Resolve service URL
SERVICE="alphavantageapiv2"
SERVICE_URL="$(gcloud run services describe "$SERVICE" \
  --region="$REGION" --project="$PROJECT_ID" \
  --format='value(status.url)')"

echo "$SERVICE => $SERVICE_URL"

# Anonymous call -> should be 403 (blocked by IAM)
curl -i "$SERVICE_URL"

# OIDC as service account -> IAM allows, app accepts SA if allowlisted
ID_TOKEN="$(gcloud auth print-identity-token \
  --audiences="$SERVICE_URL" \
  --impersonate-service-account="$INVOKER_SA")"

# Call with endpoint path (AV example)
curl -i -H "Authorization: Bearer $ID_TOKEN" \
  "$SERVICE_URL/GLOBAL_QUOTE?symbol=AAPL"
```

### Notes
- For emulator, add to `functions/.env.<project-id>`: `allowed_service_account_emails=...` and restart emulators.
- token verification for Google OIDC uses `tokeninfo` (suitable for low QPS internal calls).
- Keep IAM invoker allowlist minimal; remove `allUsers`.
