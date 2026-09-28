# check-company-overview.ts

**Purpose**: Audits all tracked symbols for missing Alpha Vantage company overview data in Firestore, and optionally fetches the missing data from the AV API.

**Firestore path checked**: `symbol-data/{SYMBOL}/company-overview/av-company-overview`

## Parameters

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--fetch` | No | (off) | Fetch company overview for missing symbols via AV API |
| `--dry-run` | No | (off) | Log what would be fetched; make no API calls |
| `--symbols X,Y` | No | All tracked | Only check/fetch a subset of symbols |
| `--delay-ms N` | No | `1000` | Inter-request delay in ms (AV rate limit safety) |

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `GCLOUD_PROJECT` | **Yes** | Must be set to `alpha-vantage-proxy-api` for prod Firestore access |
| `ALPHAVANTAGE_API_KEY` | **Yes** (fetch only) | AV API key. Not needed for audit-only runs. Fetch from Secret Manager: `$(gcloud secrets versions access latest --secret=ALPHAVANTAGE_API_KEY --project=alpha-vantage-proxy-api)` |

## Usage

Run from the `functions/` directory.

### Audit only (read-only)

Check which tracked symbols are missing company-overview data. No API calls, no writes.

```bash
# MINGW64 / Git Bash
GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-company-overview.ts

# PowerShell
$env:GCLOUD_PROJECT="alpha-vantage-proxy-api"; npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-company-overview.ts
```

### Audit + fetch missing data

Fetches company overview from Alpha Vantage for each missing symbol, saves to Firestore, and denormalizes companyInfo into the tracked-symbols doc. Requires the AV API key.

```bash
# MINGW64 / Git Bash
GCLOUD_PROJECT=alpha-vantage-proxy-api ALPHAVANTAGE_API_KEY=$(gcloud secrets versions access latest --secret=ALPHAVANTAGE_API_KEY --project=alpha-vantage-proxy-api) npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-company-overview.ts --fetch

# PowerShell
$env:GCLOUD_PROJECT="alpha-vantage-proxy-api"; $env:ALPHAVANTAGE_API_KEY=$(gcloud secrets versions access latest --secret=ALPHAVANTAGE_API_KEY --project=alpha-vantage-proxy-api); npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-company-overview.ts --fetch
```

### Dry-run fetch

Shows which symbols would be fetched without making any API calls.

```bash
GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-company-overview.ts --fetch --dry-run
```

### Subset of symbols

Only check/fetch specific symbols instead of all tracked symbols. Useful after an audit run — copy the comma-separated missing list and pass it via `--symbols`.

```bash
GCLOUD_PROJECT=alpha-vantage-proxy-api ALPHAVANTAGE_API_KEY=$(gcloud secrets versions access latest --secret=ALPHAVANTAGE_API_KEY --project=alpha-vantage-proxy-api) npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-company-overview.ts --fetch --symbols "AAOI,ACMR,ADPT"
```

### Two-step workflow (audit then fetch)

Step 1: Run audit-only to get the missing list (no API key needed):

```bash
GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-company-overview.ts
```

Step 2: Copy the comma-separated missing list from the output, then fetch with the API key:

```bash
GCLOUD_PROJECT=alpha-vantage-proxy-api ALPHAVANTAGE_API_KEY=$(gcloud secrets versions access latest --secret=ALPHAVANTAGE_API_KEY --project=alpha-vantage-proxy-api) npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-company-overview.ts --fetch --symbols "AAOI,ACMR,..."
```

## Output

### Audit phase (always)

- Total tracked symbols, count with company-overview, count missing
- **Symbols with company-overview data** (comma-separated) — full list of symbols that have CO docs; use this as the "has data" list for partner notifications
- **Missing symbols** (vertical list + comma-separated) — symbols without CO docs; the comma-separated line is ready to copy into `--symbols` for a fetch run
- Re-run hint with the exact `--fetch --symbols "..."` command pre-filled

### Fetch phase (with `--fetch`)

- Per-symbol fetch results:
  - `✓ fetched` — AV returned data, saved to Firestore
  - `○ no data` — AV returned empty response (likely ETF/index), no doc written
  - `✗ ERROR` — fetch failed
- **Fetch summary** with three counts:
  - **Fetched with data** — symbols that now have CO data (comma-separated output for RS notification)
  - **No data (ETF/index)** — symbols where AV returned empty (comma-separated output for ETF marking)
  - **Failed** — errors with details

## How it works

- **Audit**: Reads all doc IDs from `tracked-symbols` collection, then checks each for a doc at `symbol-data/{SYMBOL}/company-overview/av-company-overview`.
- **Fetch**: Uses `AlphaVantageHandlerFactory.createHandler(OVERVIEW).fetch({ symbol })` — the same handler used by the refresh manager. This:
  - Calls the Alpha Vantage `OVERVIEW` endpoint
  - Transforms and saves the response to `symbol-data/{SYMBOL}/company-overview/av-company-overview`
  - Writes back stable company info (name, sector, industry, etc.) to the `tracked-symbols` doc
  - Records a health-metrics entry with `trigger=BACKFILL_SCRIPT`
  - Does NOT publish `partner-symbol-added` notifications (that only happens in the onboarding Cloud Task)
- **Empty responses**: ETFs and indexes typically return empty from AV's OVERVIEW endpoint. These are tracked separately — no Firestore doc is written, and the symbol is reported as "no data" in the summary. These symbols will still appear as "missing" in future audits.
- **Rate limiting**: Enforces a configurable delay (default 1000ms) between AV API calls to respect the 75 req/min limit.

## Use Cases

- Identifying tracked symbols that were added but never had their company overview fetched
- Backfilling company overview data after bulk symbol imports
- Verifying data completeness before partner endpoint consumption
- Identifying ETF/index symbols that will never have company overview data (for Firestore type marking)
- Producing the list of symbols with company-overview data to send to partner applications
