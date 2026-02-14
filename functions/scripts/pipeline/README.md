# Pipeline Operations Scripts

**Created**: February 14, 2026  
**Last Updated**: February 14, 2026

This directory contains scripts for interacting with the A/B/C job pipeline, performing operational interventions, and managing pipeline state. These tools enable manual intervention in automated processes, debugging pipeline issues, and maintaining operational continuity.

## Scripts

### seed-b-retry-symbols.ts
**Purpose**: Seeds retrySymbols array on a realtime B run document for manual intervention when specific symbols need to be retried due to failures or special processing requirements.

**Parameters**:
- `RUN_ID` (env): Target realtime run ID (required, format: "YYYY-MM-DD-B-DAILY-HHMM-STATUS")
- `SYMBOLS` (env): Comma-separated list of symbols (optional, default: all tracked symbols)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Updates `REALTIME_RUNS/{runId}` document
- Sets `retrySymbols` field with specified symbols
- Logs seeding operation and symbol count
- Returns success/failure status

**Use Case**: Manual intervention in the A/B/C pipeline when certain symbols fail processing or need special handling.

**Use Cases**:
- Recovering from failed B run processing for specific symbols
- Re-processing symbols that encountered transient errors
- Testing symbol processing logic with specific subsets
- Manual intervention for data quality issues
- Debugging pipeline behavior with controlled symbol sets

**Reasons for Using**:
- Targeted retry avoids full reprocessing overhead
- Supports both individual and bulk symbol retry
- Enables precise control over pipeline operations
- Essential for operational incident response
- Helps maintain data processing continuity

**Example Run ID**: "2026-02-10-B-DAILY-2100-LIVE-POST"

**Usage**:
```bash
# Seed all symbols for a specific run
$env:RUN_ID="2026-02-10-B-DAILY-2100-LIVE-POST"; \
npx ts-node -r tsconfig-paths-register pipeline/seed-b-retry-symbols.ts

# Seed specific symbols only
$env:RUN_ID="2026-02-10-B-DAILY-2100-LIVE-POST"; \
$env:SYMBOLS="AAPL,MSFT,NVDA"; \
npx ts-node -r tsconfig-paths-register pipeline/seed-b-retry-symbols.ts
```

### infer-trigger-for-logs.ts
**Purpose**: Backfills `metadata.trigger` field on historical request logs by analyzing request patterns and inferring appropriate trigger values for missing entries.

**Status**: 🔧 Needs refactor - references old scheduler constants

**Parameters**:
- `--from` (CLI): Start date for log analysis (YYYY-MM-DD format)
- `--to` (CLI): End date for log analysis (YYYY-MM-DD format)
- `--limit` (CLI): Maximum number of logs to process (default: 1000)
- `--offset` (CLI): Number of logs to skip (default: 0)
- `--dryRun` (CLI): Set to "1" to preview changes without writing (default: "1")
- `--endpoint` (CLI): Filter by specific endpoint (optional)
- `--symbol` (CLI): Filter by specific symbol (optional)

**Output**:
- Updates `metadata.trigger` field on request logs
- Preserves existing trigger values
- Writes inferred values with "(inferred)" suffix
- Returns processing summary and statistics
- Logs all inferred triggers and reasoning

**Features**:
- Preserves existing trigger values
- Supports filtering by date, limit, offset, endpoint, and symbol
- Dry run mode for safe preview
- Detailed logging of inference logic

**Use Cases**:
- Backfilling missing trigger metadata for historical logs
- Debugging request patterns and scheduler behavior
- Analyzing API usage patterns and frequencies
- Supporting compliance and audit requirements
- Improving log analytics and monitoring

**Reasons for Using**:
- Preserves existing trigger values to avoid data loss
- Dry run mode enables safe preview of changes
- Comprehensive filtering supports targeted analysis
- Detailed logging provides audit trail
- Essential for log analytics and troubleshooting

**Current Limitation**: References old scheduler names (AV_REFRESH_MANAGER_SCHEDULE, TS_DAILY_PRE_CLOSE_SCHEDULE, etc.).
**Planned Fix**: Update to current A/B/C scheduler names.

**Usage**:
```bash
# Dry run (recommended first)
npx ts-node -r tsconfig-paths-register ./pipeline/infer-trigger-for-logs.ts \
  --from=2024-01-01 --to=2025-10-01 --limit=1000 --dryRun=1

# Actual update
npx ts-node -r tsconfig-paths-register ./pipeline/infer-trigger-for-logs.ts \
  --from=2024-01-01 --to=2025-10-01 --limit=1000 --endpoint=TIME_SERIES_DAILY_ADJUSTED --symbol=AAPL
```
