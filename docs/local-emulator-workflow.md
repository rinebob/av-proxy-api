# Local Emulator Workflow (HTTP-first)

This doc describes a simple, repeatable workflow to run all Firebase emulators and trigger the Alpha Vantage data refresh over HTTP (no Functions shell required).

## Prerequisites
- Firebase CLI installed and logged in
- Node 22 (matches Functions runtime)
- Windows PowerShell (commands below assume Windows)

## Start all emulators
- From the repo root:
  - npm run emulators:safe
- You should see the banner with Functions on 127.0.0.1:5001 and the function list including:
  - us-central1-refreshAlphaVantageDataV2Http

Emulator UI: http://127.0.0.1:4000/

## Environment configuration
The Functions emulator reads env files from `functions/`.
- Use `functions/.env.alpha-vantage-proxy-api` and/or `functions/.env.local`.
- Keep contents minimal and free of reserved keys like `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT`.

Example safe contents (functions/.env.alpha-vantage-proxy-api):
```
FUNCTIONS_EMULATOR=true
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
PUBSUB_EMULATOR_HOST=127.0.0.1:8086
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY=IXUJMB1Q6OMCUBR0
```

Notes:
- The emulator may generate `functions/.env.local` on first run for param prompts; it’s OK to keep (or delete).
- If env parsing fails, run with `--debug` to locate the offending key.

## Build Functions (optional during dev)
- From repo root or another terminal:
  - cd functions
  - npm run build
- When using `dev:functions:emu`, TS builds watch automatically.

## Seed tracked symbols (HTTP)
Add symbols you want tracked by the refresh:
- PowerShell:
```
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:5001/alpha-vantage-proxy-api/us-central1/saveTrackedSymbol" -ContentType "application/json" -Body '{"symbol":"AAPL"}'
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:5001/alpha-vantage-proxy-api/us-central1/saveTrackedSymbol" -ContentType "application/json" -Body '{"symbol":"GOOGL"}'
```

## Trigger refresh over HTTP
- PowerShell:
```
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:5001/alpha-vantage-proxy-api/us-central1/refreshAlphaVantageDataV2Http"
```
Expected JSON:
```
{"ok":true,"durationMs":1234,"symbolsUpdatedCount":2}
```

## Pub/Sub topic auto-create in emulator
The publisher auto-creates `partner-data-ready` in the emulator if missing and retries once.
- Code: `functions/src/v2/partner/data-ready.handler.ts` in `publishToPubSub()`

## Firestore paths (time series)
- Canonical path (new): `symbol-data/{symbol}/time-series/{vendor-endpoint}`
- The refresher writes time-series only to the canonical path to avoid legacy duplicates like `daily-adjusted`.

## Known constraints
- HISTORICAL_OPTIONS is currently skipped to avoid Firestore 1MB document size limits until a sharded/GCS strategy is implemented.

## Useful scripts
- Start emulators (safe): `npm run emulators:safe`
- Stop emulators: `npm run emulators:stop`
- Clean emulator data: `npm run emulators:clean`
- Functions dev (watch + emulators): `npm run dev:functions:emu`
