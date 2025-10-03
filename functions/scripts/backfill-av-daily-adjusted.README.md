# Backfill: Alpha Vantage Time Series (Daily/Weekly/Monthly Adjusted)

This script rebuilds Alpha Vantage time-series data in Firestore for tracked symbols by delegating to existing handlers. It is designed to be safe, resilient, and non-invasive to production code.

File: `functions/scripts/backfill-av-daily-adjusted.ts`

## What it does

- Fetches time-series data via the existing handler(s):
  - Daily Adjusted
  - Weekly Adjusted (optional)
  - Monthly Adjusted (optional)
- Writes the normalized CompactBar schema to sharded year docs (daily/weekly) or the `all` doc (monthly).
- Updates top-level time-series metadata and `latestBarTimestamp` for console visibility.
- Optionally deletes existing series subtree(s) before re-seeding (FULL backfill) — only after a quick network probe passes.

## Why this exists

- To normalize existing time-series with the latest bar shape and metadata rules.
- To safely rebuild data without changing production code.
- To provide strong resilience against transient network issues during bulk runs.

## Safety, Probes, and Resilience

- Probe before delete:
  - The script makes a quick Alpha Vantage `SYMBOL_SEARCH` request with a short timeout to confirm reachability before any destructive deletes.
  - If the probe ultimately fails (after retries) and `ALLOW_NONDESTRUCTIVE_ON_PROBE_FAIL=1`, the script attempts a non-destructive backfill (no deletes) to avoid blocking on temporary blips.

- Layered retries:
  - Request-level: the script retries transient network errors for each AV fetch.
  - Symbol-level: if any endpoint fails after its own retries, it retries the entire symbol (all requested endpoints) with backoff and jitter.
  - Final sweep: at the end, it retries any symbols that still failed.

- IPv4 preference:
  - Recommend running with `NODE_OPTIONS=--dns-result-order=ipv4first` to avoid flaky IPv6 routes.

All of this logic lives in the script only and does not modify production runtime behavior.

## Data written

- Storage paths (examples):
  - `symbol-data/{SYMBOL}/time-series/av-daily-adjusted/years/{YYYY}`
  - `symbol-data/{SYMBOL}/time-series/av-weekly-adjusted/years/{YYYY}`
  - `symbol-data/{SYMBOL}/time-series/av-monthly-adjusted/all/data`
- Each bar includes: `t, d, o, h, l, c, v, ac, dv, sc, pc, ch, cp`
- Top-level `time-series` doc updates metadata: `symbol, interval, histStartDate/End, histStartTs/EndTs, ttlSeconds, nextRefreshAt, lastUpdated, vendor, endpoint`, and `latestBarTimestamp`.

## Environment variables

Required for PROD runs:
- `ALPHAVANTAGE_API_KEY` — your Alpha Vantage production key

Required for Emulator runs:
- `FIRESTORE_EMULATOR_HOST=localhost:8080`
- `FUNCTIONS_EMULATOR=true` (for clearer logs)
- `LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY` — AV key used in emulator

Recommended networking:
- `NODE_OPTIONS=--dns-result-order=ipv4first` — prefer IPv4 DNS resolution

Script toggles and controls:
- `DRY_RUN` — `1` prints planned actions without writing
- `SYMBOLS` — comma-separated subset (omit for ALL tracked symbols), e.g. `SYMBOLS=AAPL,MSFT`
- `INCLUDE_WEEKLY` — `1` to include weekly adjusted
- `INCLUDE_MONTHLY` — `1` to include monthly adjusted
- `DELAY_MS` — delay between symbols (default 2500)

Request-level retries (script-only, not prod code):
- `SCRIPT_HTTP_MAX_RETRIES` — attempts for transient network errors (default `3`)
- `SCRIPT_HTTP_RETRY_BASE_MS` — base backoff in ms (default `1000`)

Probe (reachability) before delete:
- `PROBE_MAX_RETRIES` — attempts (default `3`)
- `PROBE_RETRY_BASE_MS` — base backoff in ms (default `1500`)
- `ALLOW_NONDESTRUCTIVE_ON_PROBE_FAIL` — `1` to attempt non-destructive backfill if probe fails (default `1`); set to `0` to require the probe to pass before deletes

Symbol-level retries:
- `SYMBOL_MAX_ATTEMPTS` — attempts for the whole symbol flow (default `3`)
- `SYMBOL_RETRY_BASE_MS` — base backoff in ms between symbol attempts (default `30000`)

## Usage examples

### Emulator: AAPL only, daily only, not a dry run
```powershell
$env:FIRESTORE_EMULATOR_HOST="localhost:8080"; `
$env:FUNCTIONS_EMULATOR="true"; `
Remove-Item Env:ALPHAVANTAGE_API_KEY -ErrorAction SilentlyContinue; `
$env:LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY="<dev-key>"; `
$env:DRY_RUN="0"; `
$env:SYMBOLS="AAPL"; `
$env:INCLUDE_WEEKLY="0"; `
$env:INCLUDE_MONTHLY="0"; `
$env:DELAY_MS="2000"; `
$env:SCRIPT_HTTP_MAX_RETRIES="6"; `
$env:SCRIPT_HTTP_RETRY_BASE_MS="2000"; `
$env:PROBE_MAX_RETRIES="3"; `
$env:PROBE_RETRY_BASE_MS="1500"; `
$env:ALLOW_NONDESTRUCTIVE_ON_PROBE_FAIL="1"; `
npx ts-node -r tsconfig-paths/register ./scripts/backfill-av-daily-adjusted.ts
```

### PROD: All symbols, all intervals, not a dry run
```powershell
Remove-Item Env:FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue; `
Remove-Item Env:FUNCTIONS_EMULATOR -ErrorAction SilentlyContinue; `
Remove-Item Env:SYMBOLS -ErrorAction SilentlyContinue; `
$env:GOOGLE_CLOUD_PROJECT="alpha-vantage-proxy-api"; `
$env:GCLOUD_PROJECT="alpha-vantage-proxy-api"; `
$env:ALPHAVANTAGE_API_KEY="<prod-key>"; `
$env:NODE_OPTIONS="--dns-result-order=ipv4first"; `
$env:DRY_RUN="0"; `
$env:INCLUDE_WEEKLY="1"; `
$env:INCLUDE_MONTHLY="1"; `
$env:DELAY_MS="2000"; `
$env:SCRIPT_HTTP_MAX_RETRIES="6"; `
$env:SCRIPT_HTTP_RETRY_BASE_MS="2000"; `
$env:SYMBOL_MAX_ATTEMPTS="3"; `
$env:SYMBOL_RETRY_BASE_MS="30000"; `
$env:PROBE_MAX_RETRIES="3"; `
$env:PROBE_RETRY_BASE_MS="1500"; `
$env:ALLOW_NONDESTRUCTIVE_ON_PROBE_FAIL="1"; `
npx ts-node -r tsconfig-paths/register ./scripts/backfill-av-daily-adjusted.ts
```

### PROD: Single symbol (WMT), all intervals, not a dry run
```powershell
$env:GOOGLE_CLOUD_PROJECT="alpha-vantage-proxy-api"; `
$env:GCLOUD_PROJECT="alpha-vantage-proxy-api"; `
$env:ALPHAVANTAGE_API_KEY="<prod-key>"; `
$env:NODE_OPTIONS="--dns-result-order=ipv4first"; `
$env:DRY_RUN="0"; `
$env:SYMBOLS="WMT"; `
$env:INCLUDE_WEEKLY="1"; `
$env:INCLUDE_MONTHLY="1"; `
$env:DELAY_MS="2000"; `
$env:SCRIPT_HTTP_MAX_RETRIES="6"; `
$env:SCRIPT_HTTP_RETRY_BASE_MS="2000"; `
$env:SYMBOL_MAX_ATTEMPTS="3"; `
$env:SYMBOL_RETRY_BASE_MS="30000"; `
$env:PROBE_MAX_RETRIES="3"; `
$env:PROBE_RETRY_BASE_MS="1500"; `
$env:ALLOW_NONDESTRUCTIVE_ON_PROBE_FAIL="1"; `
npx ts-node -r tsconfig-paths/register ./scripts/backfill-av-daily-adjusted.ts
```

## Logging

You’ll see logs for:
- Preflight (target, endpoints, scope, dry-run flag, delay)
- Probe attempts and retries
- Deletes (when applicable)
- Handler fetch start/success/error per endpoint
- Bars written and durations
- Symbol-level retries and final sweep summary

## Notes

- For PROD runs, ensure your Alpha Vantage key has access to the required endpoints (e.g., Daily Adjusted on your plan).
- This script intentionally does not change any production code. All resilience is contained within the script.
