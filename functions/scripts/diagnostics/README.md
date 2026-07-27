# Diagnostics & Repair Scripts

**Created**: February 14, 2026  
**Last Updated**: July 27, 2026

This directory contains scripts for diagnosing issues with time-series data, repairing metadata inconsistencies, and debugging data quality problems. These tools help identify gaps, corruption, or missing data in the Firestore time-series collections and provide mechanisms to fix discovered issues.

## Scripts

### diagnose-timeseries.ts
**Purpose**: Deep diagnostic tool for comprehensive analysis of time-series shard integrity, data quality, and structural issues.

**Parameters**:
- `SYMBOL` (env): Specific symbol to diagnose (optional, default: all tracked symbols)
- `ENDPOINT` (env): Specific endpoint to analyze (optional)
- `YEAR` (env): Specific year to analyze (optional)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Detailed bar integrity analysis (OHLCV validation)
- Date ordering consistency checks
- Gap detection and missing data reports
- Timestamp and date format validation
- Structural integrity of year shards
- JSON report with all findings

**Use Cases**:
- Comprehensive data quality audits for time-series collections
- Investigating data corruption or integrity issues
- Validating data structure compliance across year shards
- Pre-production data validation before deploying changes
- Debugging specific data anomalies or inconsistencies

**Reasons for Using**:
- Deep analysis capabilities catch subtle data issues
- Well-structured validation rules ensure thorough checking
- Clear error reporting helps identify root causes
- Performance metrics handle large datasets efficiently
- Essential for maintaining high data quality standards

**Usage**:
```bash
# Specific symbol
$env:SYMBOL="AAPL"; npx ts-node -r tsconfig-paths-register diagnostics/diagnose-timeseries.ts

# All symbols
npx ts-node -r tsconfig-paths-register diagnostics/diagnose-timeseries.ts
```

### repair-timeseries-metadata.ts
**Purpose**: Repairs top-level time-series metadata documents by scanning year shards and recomputing aggregate statistics.

**Parameters**:
- `SYMBOL` (env): Specific symbol to repair (optional, default: all tracked symbols)
- `ENDPOINT` (env): Specific endpoint to repair (optional)
- `DRY_RUN` (env): Set to "0" to actually write changes (default: "1")
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Repaired metadata documents with correct values:
  - `histStartTs` - earliest timestamp across all year shards
  - `histEndTs` - latest timestamp across all year shards
  - `count` - total number of bars across all year shards
- Logs all changes made
- Returns repair summary

**Use Cases**:
- Repairing corrupted metadata after data migrations or updates
- Fixing inconsistent aggregate statistics (count, timestamps)
- Validating metadata accuracy after bulk operations
- Recovering from metadata calculation errors
- Ensuring metadata consistency across all time-series documents

**Reasons for Using**:
- Automatic recomputation ensures accurate metadata
- Dry-run mode allows safe preview of changes
- Handles both individual symbols and full-universe repairs
- Essential for maintaining data integrity and consistency
- Supports operational recovery from metadata issues

**Process**: Scans all year shards for the symbol/endpoint, aggregates data, and updates the top-level metadata document.

**Usage**:
```bash
# Specific symbol
$env:SYMBOL="AAPL"; npx ts-node -r tsconfig-paths-register diagnostics/repair-timeseries-metadata.ts

# All symbols
npx ts-node -r tsconfig-paths-register diagnostics/repair-timeseries-metadata.ts
```

### find-incomplete-sa-timeseries.ts
**Purpose**: Scans tracked symbols for missing or incomplete split-adjusted time-series data and generates detailed reports for remediation.

**Parameters**:
- `SYMBOL` (env): Specific symbol to check (optional, default: all tracked symbols)
- `DEEP_SA_CHECK` (env): Set to "1" for thorough analysis (default: "0")
- `OUTPUT_FILE` (env): Path for output JSON (default: find-incomplete-sa-timeseries.output.json)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- JSON report with incomplete symbols and specific issues
- Lists missing intervals, date ranges, and data gaps
- Categorizes issues by severity and type
- Generates actionable remediation recommendations

**Use Cases**:
- Identifying symbols with incomplete or missing time-series data
- Generating remediation reports for data gaps
- Monitoring data completeness across the symbol universe
- Planning backfill operations for incomplete data
- Validating data ingestion success rates

**Reasons for Using**:
- Comprehensive analysis identifies all data gaps
- Categorizes issues by severity and type for prioritization
- Generates actionable reports for remediation teams
- Supports both basic and deep analysis modes
- Essential for maintaining complete data coverage

**Related Scripts**: 
- `backfill-symbol-data-from-report.ts` (creates minimal symbol-data docs)
- `retrigger-on-symbol-added-from-report.ts` (re-fires onSymbolAdded)

**Usage**:
```bash
# Basic scan
npx ts-node -r tsconfig-paths-register diagnostics/find-incomplete-sa-timeseries.ts

# Deep check (more thorough)
$env:DEEP_SA_CHECK="1"; npx ts-node -r tsconfig-paths-register diagnostics/find-incomplete-sa-timeseries.ts
```

### debug-av-request.ts
**Purpose**: Quick and focused Alpha Vantage API connectivity test for debugging network issues, API key problems, or endpoint availability.

**Parameters**:
- `SYMBOL` (env): Symbol to test (optional, default: "AAPL")
- `ENDPOINT` (env): AV endpoint to test (optional, default: "GLOBAL_QUOTE")
- `API_KEY` (env): API key to use (optional, uses environment default)

**Output**:
- Raw API response from Alpha Vantage
- Connection status and timing information
- Error details if request fails
- Simple success/failure indicator

**Use Cases**:
- First-line troubleshooting for API connectivity issues
- Validating API key configuration and permissions
- Testing network connectivity to Alpha Vantage endpoints
- Debugging environment-specific API access problems
- Quick health check before running larger scripts

**Reasons for Using**:
- Minimal dependencies provide fast, focused testing
- Clear success/failure indicators for quick diagnosis
- Helps isolate API issues from application logic problems
- Essential first step in debugging data ingestion failures
- Supports both production and emulator environments

**Use Case**: First-line debugging tool for API connectivity issues before running more complex scripts.

**Features**: Simple and focused on connectivity testing with minimal dependencies.

**Usage**:
```bash
npx ts-node -r tsconfig-paths-register diagnostics/debug-av-request.ts
```

---

## Options Time-Series Data Quality Scripts

The following scripts were built to investigate data quality in the historical options time-series JSONL files stored in GCS. They form a pipeline: **scan** → **classify** → **check alternatives** → **audit coverage**.

### Shared Modules

These are not run directly but provide shared logic to the scripts above.

#### data-quality-detect.ts
**Purpose**: Core anomaly detection library. Exports pure functions that take parsed observations and return anomaly arrays. Used by `scan-data-quality.ts`.

**Exported functions**:
- `detectZeroDrops` — flags `l` (last) transitions from ≥ threshold to ~0
- `detectMarkZeroDrops` — flags `m` (mark) transitions from ≥ threshold to ~0, with optional ITM filtering
- `detectStaleData` — flags runs where `l` and `m` are unchanged for N+ days
- `detectStructuralIssues` — flags duplicate dates, out-of-order dates, negative prices, missing `l`/`m`, post-expiration observations
- `detectObservationGaps` — flags files with fewer observations than expected weekday count
- `detectBsAnomalies` — flags Black-Scholes implied underlying deviations (computationally expensive, off by default)
- `runAllDetections` — runs all detections and concatenates results
- `parseObsLine` — parses a single JSONL line into a `ParsedObs`

**Key types**: `ParsedObs`, `Anomaly`, `AnomalyType` (union), `AnomalyBase`, `DetectConfig`

#### data-quality-utils.ts
**Purpose**: Math and date utilities for the detection library.

**Exported functions**:
- `normCDF` — standard normal CDF (Abramowitz & Stegun approximation)
- `normInv` — inverse standard normal CDF (Beasley-Springer-Moro approximation)
- `estimateUnderlying` — estimates underlying price from option delta via Black-Scholes
- `countWeekdays` — counts trading days (weekdays minus US market holidays 2019–2026)

#### underlying-closes.service.ts
**Purpose**: Shared service for fetching and looking up underlying daily close prices from Firestore. Used by `scan-data-quality.ts` and `classify-zero-drops.ts`.

**Exported functions**:
- `fetchUnderlyingCloses(symbol, years)` — loads daily adjusted close prices from Firestore year-sharded docs, returns `Map<ISO date, close price>`
- `lookupUnderlyingClose(closeMap, date)` — looks up close for a date, falls back to nearest preceding trading day (up to 5 days back)

**Exported types**: `UnderlyingCloses` (Map of symbol → date → close)

#### csv-utils.ts
**Purpose**: Shared CSV parsing utility.

**Exported functions**:
- `parseCsvLine(line)` — parses a CSV line with quoted field support

---

### scan-data-quality.ts
**Purpose**: Main scan orchestrator. Downloads each JSONL file from GCS, parses all observations, runs detection checks, and writes anomalies to a CSV file. Supports a `--mark-only` mode that scans exclusively for mark (`m`) zero-drop anomalies with ITM filtering.

**Parameters** (all run from `functions/` directory):

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `OPTIONS_TIME_SERIES_BUCKET` | Yes | — | GCS bucket name |
| `SYMBOLS` | No | `QQQ,TQQQ` | Comma-separated symbols to scan |
| `MAX_FILES` | No | unlimited | Limit files scanned (for testing) |
| `CONCURRENCY` | No | `30` | Concurrent file downloads |
| `SAMPLE_EVERY` | No | `1` | Scan every Nth file (10 = 10% sample) |
| `ENABLE_BS_CHECK` | No | `false` | Enable Black-Scholes anomaly detection |
| `DATA_START_DATE` | No | — | Dataset start date for early-start detection (e.g., `2023-01-01`) |
| `PREVIOUS_THRESHOLD` | No | `1.0` | Min `l` before drop to flag zero drop |
| `ZERO_THRESHOLD` | No | `0.05` | Max `l` after drop to flag zero drop |
| `MARK_PREVIOUS_THRESHOLD` | No | `5.0` | Min `m` before drop to flag mark zero drop |
| `MARK_ZERO_THRESHOLD` | No | `0.001` | Max `m` after drop to flag mark zero drop |
| `STALE_THRESHOLD` | No | `10` | Consecutive same `l`+`m` days to flag stale |
| `STALE_MIN_PRICE` | No | `0.10` | Skip stale detection when `l` < this |
| `OBS_DEFICIENCY_PCT` | No | `20` | Min % missing to flag observation gap |
| `OBS_GAP_MIN_DAYS` | No | `5` | Min absolute missing days to flag observation gap |

**Flags**:
- `--resume-from=<contractId>` — skip all contract IDs ≤ this value (lexicographic). Useful for resuming interrupted scans.
- `--append-csv=<path>` — append to existing CSV instead of creating a new one.
- `--mark-only` — scan only for mark (`m`) zero-drop anomalies with ITM filtering. Loads underlying close prices from Firestore at startup. Skips GCS metadata fetch for performance.

**Anomaly types detected** (full mode):
- `ZERO_DROP_RECOVERY` — `l` drops to ~0 then recovers after N days
- `TRAILING_ZEROS` — `l` drops to ~0 and stays zero to end of file
- `MARK_ZERO_DROP_RECOVERY` — `m` drops to ~0 then recovers (mark-only mode)
- `MARK_TRAILING_ZEROS` — `m` drops to ~0 and stays zero (mark-only mode)
- `STALE_DATA` — `l` and `m` unchanged for 10+ consecutive days
- `DUPLICATE_DATE` — same date appears more than once
- `OUT_OF_ORDER` — dates not chronologically sorted
- `NEGATIVE_PRICE` — any price field < 0
- `MISSING_LAST` — observation without `l` field
- `MISSING_MARK` — observation without `m` field
- `POST_EXPIRATION` — observation after contract expiration
- `OBSERVATION_GAP` — actual obs < 80% of expected weekdays
- `BS_ANOMALY` — Black-Scholes implied underlying deviates >30% from median

**Output**: CSV file in `scripts/diagnostics/output/data-quality-<timestamp>.csv` with one row per anomaly.

**Usage**:
```bash
# Full scan (all detections)
npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/scan-data-quality.ts

# Mark-only scan (ITM-filtered mark zero-drops)
npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/scan-data-quality.ts --mark-only

# Limited test run
$env:MAX_FILES="5000"; npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/scan-data-quality.ts

# Resume interrupted scan
npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/scan-data-quality.ts --resume-from=QQQ231215C00400000

# Mark-only with custom thresholds
$env:MARK_PREVIOUS_THRESHOLD="10"; $env:MARK_ZERO_THRESHOLD="0.01"; `
npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/scan-data-quality.ts --mark-only
```

**Performance notes**:
- Full scan of ~359K files takes several hours. Use `--resume-from` to restart interrupted scans.
- `--mark-only` mode skips GCS metadata fetch (saves ~359K API calls) and loads underlying closes from Firestore once at startup.
- Use `SAMPLE_EVERY=10` for a quick 10% sample to validate configuration.

---

### classify-zero-drops.ts
**Purpose**: Post-scan classifier. Reads an anomaly CSV from `scan-data-quality.ts`, fetches underlying close prices from Firestore, determines moneyness (ITM/OTM), and classifies each anomaly as `LEGITIMATE_EXPIRATION`, `SUSPICIOUS_PHANTOM`, or `AMBIGUOUS`.

**Classification heuristics**:
- **LEGITIMATE_EXPIRATION**: OTM option near expiration (≤5 DTE) with trailing zeros — expected behavior for worthless options.
- **SUSPICIOUS_PHANTOM**: ITM option with significant `l` value that drops to zero with many days to expiration — likely data corruption.
- **AMBIGUOUS**: Cannot classify due to missing underlying data or borderline moneyness.

**Parameters**:

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `INPUT_CSV` | Yes | — | Path to anomaly CSV from `scan-data-quality.ts` |
| `SYMBOLS` | No | `QQQ,TQQQ` | Symbols to fetch underlying data for |
| `RISK_FREE_RATE` | No | `0.04` | Reserved for future BS pricing |

**Output**: CSV file in `scripts/diagnostics/output/classified-anomalies-<timestamp>.csv` with all original columns plus `classification`, `underlyingClose`, and `moneyness`. Console summary prints counts per classification.

**Usage**:
```bash
$env:INPUT_CSV="./scripts/diagnostics/output/data-quality-2026-07-26T12-00-00.csv"; `
npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/classify-zero-drops.ts
```

---

### check-alt-fields.ts
**Purpose**: Sample checker. Downloads JSONL files for a small set of suspicious contracts and inspects whether `mark`, `bid`, and `ask` are non-zero on corrupted dates where `last` dropped to zero. This determines whether `last` can be repaired from existing fields without a third-party data source.

**What it checks**: For each corrupted date in each sampled contract, reads the JSONL observation and reports:
- Whether `m` (mark) is non-zero
- Whether `b` (bid) is non-zero
- Whether `a` (ask) is non-zero
- Whether mid-point `(bid + ask) / 2` is available
- Whether the date is "repairable" (has at least one non-zero alternative field)

**Parameters**:

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `INPUT_CSV` | Yes | — | Path to classified anomaly CSV |
| `OPTIONS_TIME_SERIES_BUCKET` | Yes | — | GCS bucket name |
| `SAMPLE_SIZE` | No | `20` | Number of suspicious contracts to sample |

**Output**: Console table with per-contract, per-date field availability. Summary statistics at the end showing what percentage of corrupted dates have viable alternative fields.

**Usage**:
```bash
$env:INPUT_CSV="./scripts/diagnostics/output/classified-anomalies-*.csv"; `
$env:OPTIONS_TIME_SERIES_BUCKET="av-options-time-series-bucket"; `
$env:SAMPLE_SIZE="20"; `
npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-alt-fields.ts
```

---

### audit-timeseries-coverage.ts
**Purpose**: Coverage audit. Generates a CSV report listing every `.jsonl` file in the GCS bucket with its contract metadata, observation count, and coverage metrics. Reads GCS custom metadata only — does not download file content.

**Columns in output CSV**:
- `contractId`, `expiration`, `strike`, `type`
- `firstObserved`, `lastObserved` (from GCS custom metadata)
- `obsCount`, `coverageDays` (trading days between first/last), `dataSpanDays` (calendar days)

**Parameters**:

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `OPTIONS_TIME_SERIES_BUCKET` | No | from env | GCS bucket name |
| `SYMBOLS` | No | `QQQ,TQQQ` | Comma-separated symbols |
| `MAX_FILES` | No | unlimited | Limit GCS listing (for testing) |
| `CONCURRENCY` | No | `50` | Concurrent `getMetadata()` calls |

**Output**: CSV file in `scripts/diagnostics/output/coverage-audit-<timestamp>.csv`.

**Usage**:
```bash
# Full audit
npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/audit-timeseries-coverage.ts

# Quick test
$env:MAX_FILES="100"; npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/audit-timeseries-coverage.ts
```

---

## Typical Workflow

1. **Run a scan**: Use `scan-data-quality.ts` to find anomalies across all time-series files.
2. **Classify anomalies**: Pipe the scan output through `classify-zero-drops.ts` to separate legitimate expirations from suspicious corruption.
3. **Check alternatives**: Use `check-alt-fields.ts` to see if corrupted fields can be repaired from existing data.
4. **Audit coverage**: Use `audit-timeseries-coverage.ts` to identify files with sparse or missing data.

### Mark-Only Workflow

When investigating mark (`m`) price integrity specifically:

1. Run `scan-data-quality.ts --mark-only` to scan only for mark zero-drops with ITM filtering.
2. The scan loads underlying closes from Firestore and only flags drops where the option is ITM at the drop date (OTM options legitimately go to zero).
3. If anomalies are found, use `classify-zero-drops.ts` and `check-alt-fields.ts` on the output.

### Findings (July 2026)

- **`l` (last) field**: Significant zero-drop corruption found across QQQ contracts. Classified as `SUSPICIOUS_PHANTOM` for ITM options.
- **`m` (mark) field**: Clean. Full scan of 359K files with `--mark-only` found zero anomalies. Mark is the canonical price value.
- **Repair feasibility**: `check-alt-fields.ts` confirmed that `mark`, `bid`, and `ask` remain healthy on dates where `last` is corrupted. Repair is possible but not needed since `mark` is the canonical value.
