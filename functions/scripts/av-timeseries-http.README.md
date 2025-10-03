# AV Time-Series HTTP (Emulator Helper)

This script replaces the former emulator-only HTTP Cloud Function wrapper for time-series runs. It allows you to invoke the v2 time-series handler flow locally against the Firebase emulators without deploying an HTTPS function.

- Script path: `functions/scripts/av-timeseries-http.ts`
- Scope: Alpha Vantage time-series endpoints (Daily Adjusted primary; Weekly/Monthly when specified)
- Environment: Local emulator only (Functions + Firestore)

## What it does

- Initializes emulator env and shared module aliases
- Invokes the v2 time-series writer flow via factory handlers
- Supports PRE and POST trading phases:
  - PRE (daily only): writes intraday snapshot fields (ip/io/it/ic/ipc) without finalizing the daily bar
  - POST: writes finalized bars (daily/weekly/monthly) and bumps freshness metadata on the parent doc

## Prerequisites

1. Firebase emulators running (Functions + Firestore)
2. Repo shared libs built and copied so `@shared/*` imports resolve:
   ```bash
   npm run build:shared       # from repo root
   npm --prefix functions run copy-shared
   ```
3. Local env file at `functions/.env.alpha-vantage-proxy-api` with the emulator AV key:
   ```env
   LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY=your_dev_av_key
   GCLOUD_PROJECT=alpha-vantage-proxy-api
   ```

## Usage

Run from the `functions/` directory with `ts-node`.

```bash
# From repo root
npm run build:shared
npm --prefix functions run copy-shared

# From functions/
cd functions

# POST-close daily run (finalized daily bar)
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/av-timeseries-http.ts --endpoint TIME_SERIES_DAILY_ADJUSTED --phase POST

# PRE-close daily run (intraday snapshot only)
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/av-timeseries-http.ts --endpoint TIME_SERIES_DAILY_ADJUSTED --phase PRE

# Weekly + Monthly post-close (example)
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/av-timeseries-http.ts --endpoint TIME_SERIES_WEEKLY_ADJUSTED --phase POST
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/av-timeseries-http.ts --endpoint TIME_SERIES_MONTHLY_ADJUSTED --phase POST
```

## Options

- `--endpoint` One of: `TIME_SERIES_DAILY_ADJUSTED`, `TIME_SERIES_WEEKLY_ADJUSTED`, `TIME_SERIES_MONTHLY_ADJUSTED`
- `--phase`    `PRE` or `POST` (default `POST`)
- `--symbol`   Optional; when omitted, runs for all tracked symbols

## Notes

- This script is for local development/testing only and must not be deployed as a Cloud Function.
- The original HTTPS emulator wrapper exports were removed from `functions/src/index.ts` to avoid accidental deployment.
- Bar storage follows the sharded schema: daily/weekly by year shards; monthly single `all` shard; parent doc holds metadata and `latestBarTimestamp`.
