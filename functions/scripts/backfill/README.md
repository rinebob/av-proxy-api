# Backfill & Data Maintenance Scripts

**Created**: February 14, 2026  
**Last Updated**: February 14, 2026

This directory contains scripts for backfilling historical market data from Alpha Vantage and maintaining data integrity in the Firestore database. These scripts handle bulk data ingestion, failure recovery, and manual data corrections for Daily, Weekly, and Monthly time-series data.

## Scripts

### backfill-av-daily-adjusted.ts
**Purpose**: Primary backfill script for Daily, Weekly, and Monthly data from Alpha Vantage with comprehensive error handling and retry logic.

**Parameters**:
- `SYMBOLS` (env): Comma-separated list of symbols (default: all tracked symbols)
- `INCLUDE_WEEKLY` (env): Set to "1" to include weekly data (default: 1)
- `INCLUDE_MONTHLY` (env): Set to "1" to include monthly data (default: 1)
- `MARKET_DATE` (env): Target date for backfill (default: today ET)
- `SCRIPT_HTTP_MAX_RETRIES` (env): Max retries for network errors (default: 3)
- `SCRIPT_HTTP_RETRY_BASE_MS` (env): Base delay for retry backoff (default: 1000ms)
- `PROBE_MAX_RETRIES` (env): Max retries for connectivity probe (default: 3)
- `ALLOW_NONDESTRUCTIVE_ON_PROBE_FAIL` (env): Allow backfill on probe failure (default: 1)

**Output**:
- Writes to `symbol-data/{symbol}/sa-time-series/{endpoint}/{year}` collections
- Logs progress, errors, and retry attempts
- Health metrics for monitoring

**Use Cases**:
- Initial data population for new symbols
- Historical data backfill after adding new symbols to the universe
- Re-populating data after database corruption or data loss
- Bulk data refresh for multiple symbols and intervals
- Testing data ingestion pipeline with large datasets

**Reasons for Using**:
- Comprehensive error handling with retry logic ensures reliable data ingestion
- Supports multiple time intervals (Daily, Weekly, Monthly) in single execution
- Health metrics integration provides monitoring visibility
- Probe connectivity prevents failed runs due to API issues

**Usage**: 
```bash
# From functions/ directory
$env:SYMBOLS="AAPL,MSFT"; $env:INCLUDE_WEEKLY="1"; $env:INCLUDE_MONTHLY="1"; \
npx ts-node -r tsconfig-paths/register backfill/backfill-av-daily-adjusted.ts
```
**Features**: 
- Retry logic with exponential backoff
- Health metrics integration
- Probe connectivity before starting
- Well-documented in `docs/backfill/backfill-and-split-toolkit.md`

### backfill-av-daily-adjusted.README.md
**Purpose**: Comprehensive documentation for the backfill script including configuration options, troubleshooting guide, and best practices.

**Parameters**: N/A (documentation file)

**Output**: N/A (documentation file)

**Content**: Detailed usage instructions, environment variable explanations, error scenarios, and performance tuning tips.

### enqueue-full-backfill-jobs.ts
**Purpose**: Enqueues full backfill jobs through the v2 job pipeline using Cloud Tasks for reliable distributed processing.

**Parameters**:
- `SYMBOLS` (env): Comma-separated list of symbols (default: all tracked symbols)
- `TS_TIME_SERIES_TASKS_ENABLED` (env): Enable time-series tasks (default: true)
- `INCLUDE_WEEKLY` (env): Include weekly intervals (default: 1)
- `INCLUDE_MONTHLY` (env): Include monthly intervals (default: 1)
- `MARKET_DATE` (env): Target market date (default: today ET)

**Output**:
- Creates Cloud Tasks for each symbol/endpoint combination
- Returns task creation summary
- Logs enqueued job details

**Use Cases**:
- Queueing large-scale backfill jobs without overwhelming the system
- Distributing backfill work across multiple workers via Cloud Tasks
- Scheduling periodic full-universe refreshes
- Testing job pipeline functionality without direct API calls
- Managing backfill operations for specific market dates

**Reasons for Using**:
- Cloud Tasks provide automatic retries and fault tolerance
- Better resource utilization through distributed processing
- Can handle large symbol universes efficiently
- Integrates with current v2 job pipeline architecture

**Architecture**: Uses `enqueueFullBackfillJobsForEndpoint` from the current v2 job pipeline with automatic retries and rate limiting.

**Usage**:
```bash
# All symbols, all intervals
npx ts-node -r tsconfig-paths-register backfill/enqueue-full-backfill-jobs.ts

# Subset of symbols
$env:SYMBOLS="AAPL,MSFT"; npx ts-node -r tsconfig-paths-register backfill/enqueue-full-backfill-jobs.ts
```
**Architecture**: Uses `enqueueFullBackfillJobsForEndpoint` from the current v2 job pipeline

### finalize-one-daily-bar.ts
**Purpose**: Fetches and upserts a single daily bar from Alpha Vantage, useful for manual data corrections or testing individual symbol updates.

**Parameters**:
- `SYMBOL` (env): Target symbol for bar update (required)
- `DATE` (env): Specific date for the bar (optional, default: latest)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Upserts single bar to `symbol-data/{symbol}/sa-time-series/av-daily-adjusted/{year}`
- Logs API response and write result
- Returns success/failure status

**Use Cases**:
- Fixing corrupted or missing daily bars for specific dates
- Testing API connectivity for individual symbols
- Manual data correction after identifying bad data points
- Validating API response format for new symbols
- Quick data refresh for critical symbols without full backfill

**Reasons for Using**:
- Targeted fix for specific data issues without full reprocessing
- Fast response time for single-bar corrections
- Useful for manual data quality interventions
- Provides immediate feedback on API status

**Use Case**: Manual corrections when specific dates have bad data, or testing API connectivity for individual symbols.

**Usage**:
```bash
$env:SYMBOL="AAPL"; npx ts-node -r tsconfig-paths-register backfill/finalize-one-daily-bar.ts
```

### find-backfill-failures.ts
**Purpose**: Queries backfill-runs collection for permanent failures and generates detailed failure reports.

**Status**: 🔧 Needs refactor - currently has hardcoded run IDs

**Current Parameters**:
- Hardcoded run IDs: "2026-01-24-SAT-A-DAILY-2100-RETRY-1", "2026-01-24-SAT-B-DAILY-2100-RETRY-1"

**Planned Parameters** (after refactor):
- `--run-ids` (CLI): Comma-separated list of run IDs to analyze
- `--symbol` (CLI): Filter by specific symbol
- `--status` (CLI): Filter by failure status

**Output**:
- Lists failed symbols with error details
- Shows retry counts and timestamps
- Generates summary statistics
- Outputs in JSON format for further processing

**Use Cases**:
- Investigating why specific backfill runs failed
- Identifying patterns in backfill failures across symbols
- Monitoring backfill job health and success rates
- Generating reports for operational reviews
- Debugging systematic issues with data ingestion

**Reasons for Using**:
- Provides detailed failure analysis to identify root causes
- Helps distinguish between one-off failures and systematic issues
- Enables data-driven decisions about retry strategies
- Supports operational monitoring and alerting

**Current Limitation**: Hardcoded run IDs (2026-01-24-SAT-...). Should accept run IDs as CLI arguments or environment variables.

**Planned Fix**: Accept run IDs as CLI arguments or environment variables.

**Usage**:
```bash
# Current (with hardcoded IDs)
npx ts-node -r tsconfig-paths-register backfill/find-backfill-failures.ts

# Future (after refactor)
npx ts-node -r tsconfig-paths-register backfill/find-backfill-failures.ts --run-ids="id1,id2,id3"
```
