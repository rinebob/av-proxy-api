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
- Canonical path: `symbol-data/{symbol}/sa-time-series/{vendor-endpoint}` (e.g., `av-daily-adjusted`)
- The legacy `time-series` collection has been wiped in production; all writes go to `sa-time-series`.

## Known constraints
- HISTORICAL_OPTIONS is currently skipped to avoid Firestore 1MB document size limits until a sharded/GCS strategy is implemented.

## Useful scripts
- Start emulators (safe): `npm run emulators:safe`
- Stop emulators: `npm run emulators:stop`
- Clean emulator data: `npm run emulators:clean`
- Functions dev (watch + emulators): `npm run dev:functions:emu`

For detailed guidance on **manual backfill and split maintenance scripts** (e.g., `backfill-data.ts`, `sync-splits.ts`, `verify-data.ts`), see:

- `planning/backfill-and-split-toolkit.md`

---

## Time-Series Maintenance Scripts on the Emulator

Once the emulators are running and you have seeded `tracked-symbols`, you can exercise the same time-series maintenance flows locally that you use in production.

### Configure env for scripts (emulator)

From the repo root in PowerShell:

```powershell
# Enable script-level emulator wiring
$env:USE_EMULATOR_SCRIPTS = "1"

# AV key for emulator-based scripts
$env:LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY = "<YOUR_AV_KEY>"
Remove-Item Env:ALPHAVANTAGE_API_KEY -ErrorAction SilentlyContinue
```

`functions/scripts/scripts-util.setupEmulator()` will ensure:

- `FIRESTORE_EMULATOR_HOST=localhost:8080`
- `FUNCTIONS_EMULATOR=true`
- `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`

### Backfill, Diagnose, Repair (Emulator)

Typical sequence (from repo root):

```powershell
# 1) Backfill recent window via v2 writers
$env:BACKFILL_INTERVALS       = "DAILY,WEEKLY,MONTHLY"
$env:BACKFILL_FROM            = "2025-10-01"
$env:BACKFILL_TO              = "2025-12-17"
$env:BACKFILL_LOOKBACK_YEARS  = "0"

npx ts-node -r tsconfig-paths/register -r module-alias/register `
  functions/scripts/backfill-data.ts

# 2) Diagnose structural and metadata issues
npx ts-node -r tsconfig-paths/register -r module-alias/register `
  functions/scripts/diagnose-timeseries.ts `
    --interval WEEKLY `
    --from 1995-01-01 `
    --to   2025-12-31

npx ts-node -r tsconfig-paths/register -r module-alias/register `
  functions/scripts/diagnose-timeseries.ts `
    --interval DAILY `
    --from 2025-10-01 `
    --to   2025-12-17

npx ts-node -r tsconfig-paths/register -r module-alias/register `
  functions/scripts/diagnose-timeseries.ts `
    --interval MONTHLY `
    --from 2018-01-01 `
    --to   2025-12-31

# 3) Repair top-level metadata from stored bars
npx ts-node -r tsconfig-paths/register -r module-alias/register `
  functions/scripts/repair-timeseries-metadata.ts

# 4) Re-run diagnostics to confirm Total issues: 0
```

This mirrors the recommended production workflow but operates entirely against the local emulator, making it safe for experimentation and regression checks.

