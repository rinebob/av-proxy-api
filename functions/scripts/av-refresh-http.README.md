# AV Refresh HTTP (Emulator Helper)

This script replaces the former emulator-only HTTP Cloud Function wrapper. It lets you trigger the Alpha Vantage v2 refresh manager logic locally against the Firebase emulators without deploying an HTTPS function.

- Script path: `functions/scripts/av-refresh-http.ts`
- Scope: AV non–time-series refresh manager (`runRefreshAlphaVantageDataV2`) and related helpers
- Environment: Local emulator only (Functions + Firestore)

## What it does

- Initializes emulator env and shared module aliases
- Invokes the v2 AV refresh manager (`runRefreshAlphaVantageDataV2`) to refresh any stale, non–time-series endpoints for all tracked symbols
- Accepts a `--force` flag to bypass freshness gating
- Logs concise summaries and any errors

## Prerequisites

1. Firebase emulators running (Functions + Firestore)
2. Repo shared libs built and copied so `@shared/*` imports resolve:
   ```bash
   npm run build:shared       # from repo root
   npm --prefix functions run copy-shared
   ```
3. Local env file present at `functions/.env.alpha-vantage-proxy-api` with the emulator AV key:
   ```env
   LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY=your_dev_av_key
   GCLOUD_PROJECT=alpha-vantage-proxy-api
   ```

## Usage

Run from the `functions/` directory with `ts-node`:

```bash
# From repo root
npm run build:shared
npm --prefix functions run copy-shared

# From functions/
cd functions

# Refresh only stale docs
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/av-refresh-http.ts

# Force refresh regardless of TTL
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/av-refresh-http.ts --force
```

## Options

- `--force`  Forces refresh even if `metadata.nextRefreshAt` is in the future

## Notes

- This script is for local development and testing only.
- The original HTTPS emulator wrapper exports were removed from `functions/src/index.ts` to avoid accidental deployment.
- Time-series endpoints (daily/weekly/monthly) are handled by dedicated schedulers and handler flows and are not refreshed by this script.
