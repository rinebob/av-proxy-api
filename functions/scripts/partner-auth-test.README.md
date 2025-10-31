# partner-auth-test (Smoke Test)

TypeScript-based smoke test for calling partner Gen2 Cloud Functions with Google OIDC ID tokens minted via `gcloud` (service account impersonation).

- Script: `functions/scripts/partner-auth-test.ts`
- Runs on Windows (PowerShell/CMD), macOS, Linux
- No extra deps beyond Node 20+ and gcloud; use `ts-node` for quick runs or compile first

## Prerequisites

- Node.js 20+
- Google Cloud CLI (`gcloud`) with permissions to impersonate the target service account (roles/iam.serviceAccountTokenCreator)
- The service account has `roles/run.invoker` on the partner functions

## Run (ts-node)

From the `functions/` directory:

```bash
# Install ts-node if not installed
npx ts-node --version

# Quick run (Windows Git Bash, macOS, Linux)
SA=maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com \
  npx ts-node scripts/partner-auth-test.ts --verbose --check-tokeninfo

# rel-str example
SA=rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com \
  npx ts-node scripts/partner-auth-test.ts
```

Windows Git Bash tip (discover GCLOUD automatically):
```bash
# Find gcloud via Windows and convert path for Git Bash
unset GCLOUD
export GCLOUD="$(cygpath -u "$(cmd //c where gcloud | tr -d '\r' | head -n 1)")"
echo "GCLOUD=$GCLOUD"

# Do not wrap GCLOUD in quotes; the script will quote as needed
export SA=maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com
npx ts-node scripts/partner-auth-test.ts --verbose
```

PowerShell example:
```powershell
$env:SA="maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com"
npx ts-node scripts/partner-auth-test.ts --verbose --check-tokeninfo
```

## Run (compiled)

Compile scripts (already used by deploy prebuild):
```bash
npm run build  # compiles functions + scripts
node lib/scripts/partner-auth-test.js --sa maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com --verbose --check-tokeninfo
```

Windows PowerShell tip:
```powershell
$env:GCLOUD="C:\Program Files\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$env:SA="maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com"
node lib/scripts/partner-auth-test.js --sa $env:SA --verbose
```

## Options / Env

- `--sa EMAIL` (required) or `SA` env: service account to impersonate
- `--project ID` or `PROJECT` (default: `alpha-vantage-proxy-api`)
- `--region NAME` or `REGION` (default: `us-central1`)
- `--symbol TICKER` or `SYMBOL` (default: `AAPL`)
- `--interval daily|weekly|monthly` or `INTERVAL` (default: `daily`)
- `--limit N` or `LIMIT` (default: `500`)
- `--activeOnly true|false` or `ACTIVE_ONLY` (default: `true`)
- `--verbose` or `VERBOSE=1`
- `--check-tokeninfo` or `CHECK_TOKENINFO=1`

Derived URLs (auto):
- `https://${REGION}-${PROJECT}.cloudfunctions.net/partnerListTrackedSymbolsV2`
- `https://${REGION}-${PROJECT}.cloudfunctions.net/partnerTimeSeriesV2`

## What it does

1) Mints per-function ID tokens with the function URL as `aud`
2) Optionally prints `tokeninfo` (jq-free)
3) Calls:
   - `partnerListTrackedSymbolsV2?activeOnly=...&limit=...`
   - `partnerTimeSeriesV2?symbol=...&interval=...`
4) Prints status (and body when `--verbose`)

## Troubleshooting

- 401 HTML from Google Frontend → Audience mismatch or IAM; ensure `aud` equals the function URL and SA has `roles/run.invoker`.
- 403 JSON `Google ID token audience mismatch.` → Request reached our code but audience not accepted; mint with the function URL.
- 403 JSON `Invalid or unauthorized Google ID token.` → Missing `email` claim or SA not allowlisted.

See also: `docs/partner-auth-and-audience.md` and `docs/partner-quickstart.md`.
