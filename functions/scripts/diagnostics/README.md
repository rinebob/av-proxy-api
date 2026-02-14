# Diagnostics & Repair Scripts

**Created**: February 14, 2026  
**Last Updated**: February 14, 2026

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
