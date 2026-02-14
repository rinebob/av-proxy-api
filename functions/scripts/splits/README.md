# Split Management Scripts

**Created**: February 14, 2026  
**Last Updated**: February 14, 2026

This directory contains scripts for managing stock split history data and verifying the integrity of split-adjusted time-series data. These scripts handle fetching split events from Alpha Vantage, applying known patches, and ensuring split adjustments are correctly applied across Daily, Weekly, and Monthly data.

## Scripts

### sync-splits.ts
**Purpose**: Fetches split history from Alpha Vantage SPLITS endpoint and writes to Firestore symbol-data collection with automatic patch application.

**Parameters**:
- `SYMBOL` (env): Single symbol to process (optional, default: all tracked symbols)
- `SYMBOLS` (env): Comma-separated list of symbols (optional)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Writes to `symbol-data/{symbol}.splitHistory` collection
- Applies GOOGL patch for known data issues
- Logs fetched splits and patch applications
- Returns processing summary

**Features**:
- Includes GOOGL patch for known data issues
- Rate limiting for API calls (5 requests/second)
- Processes single symbols, lists, or all tracked symbols
- Automatic sorting by date

**Use Cases**:
- Initial split history population for new symbols
- Updating split data after corporate actions or stock splits
- Maintaining accurate split-adjusted historical data
- Applying known patches for problematic symbols (e.g., GOOGL)
- Validating split data integrity across the symbol universe

**Reasons for Using**:
- Ensures accurate split-adjusted pricing for historical analysis
- Automatic rate limiting prevents API quota exhaustion
- Includes critical patches for known data issues
- Supports both individual and bulk processing
- Essential for maintaining data quality in split-adjusted datasets

**Usage**:
```bash
# Single symbol
$env:SYMBOL="AAPL"; npx ts-node -r tsconfig-paths-register splits/sync-splits.ts

# All symbols
npx ts-node -r tsconfig-paths-register splits/sync-splits.ts
```

### manage-splits.ts
**Purpose**: Multi-command tool for managing split history with diagnostic and operational capabilities.

**Status**: 🔧 Needs refactor - currently diagnostic-only

**Parameters**:
- `command` (CLI): One of [clean, patch, remove, fetch, analyze]
- `symbol` (CLI): Target symbol for operations
- `date` (CLI): Date for patch/remove operations (YYYY-MM-DD)
- `factor` (CLI): Split factor for patch operations
- `--commit` (CLI): Actually write changes (planned feature)

**Current Output** (diagnostic mode):
- Logs what "WOULD" be done without persisting changes
- Shows split analysis and validation results

**Planned Output** (with --commit):
- Persists split changes to Firestore
- Returns operation results

**Commands**:
- `clean` - Removes duplicate splits
- `patch` - Updates or adds a split for a symbol on a specific date
- `remove` - Removes a split
- `fetch` - Fetches splits from Alpha Vantage
- `analyze` - Analyzes split data for issues

**Use Cases**:
- Cleaning up duplicate or corrupted split entries
- Applying manual split corrections for known data issues
- Removing incorrect split data that affects pricing
- Adding missing split events that weren't captured automatically
- Analyzing split data patterns and consistency

**Reasons for Using**:
- Diagnostic mode allows safe preview of changes before execution
- Comprehensive split management in single tool
- Helps maintain data integrity without full reprocessing
- Supports both automated and manual split data management
- Essential for data quality control and remediation

**Current Limitation**: All write operations are commented out (logs "WOULD" but doesn't persist).
**Planned Fix**: Restore actual write operations behind a `--commit` flag.

**Usage**:
```bash
# Current (diagnostic only)
npx ts-node -r tsconfig-paths-register splits/manage-splits.ts clean AAPL

# Future (after refactor)
npx ts-node -r tsconfig-paths-register splits/manage-splits.ts clean AAPL --commit
```

### verify-data.ts
**Purpose**: Comprehensive data integrity verification for splits and price spikes across Daily, Weekly, and Monthly time-series shards.

**Parameters**:
- `SYMBOL` (env): Specific symbol to verify (optional, default: all tracked symbols)
- `DATE` (env): Specific date to inspect (optional, format: YYYY-MM-DD)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Reports split adjustment consistency across intervals
- Identifies price spikes and anomalies
- Shows data gaps and missing bars
- Returns verification status and issues found
- Logs detailed analysis for each symbol

**Use Cases**:
- Regular data integrity audits for split-adjusted data
- Investigating pricing anomalies that may indicate split issues
- Validating that split adjustments are correctly applied across intervals
- Monitoring data quality after split events or corporate actions
- Generating reports for data quality reviews

**Reasons for Using**:
- Comprehensive verification across Daily, Weekly, Monthly data
- Identifies both split adjustment issues and price spikes
- Helps ensure data consistency for accurate financial analysis
- Core audit tool for maintaining high data quality standards
- Supports both targeted and full-universe verification

**Scope**: Daily, Weekly, Monthly shards with split-adjusted data
**Use Case**: Core audit tool for ensuring split-adjusted data consistency and identifying data quality issues.

**Usage**:
```bash
# Specific symbol
$env:SYMBOL="AAPL"; npx ts-node -r tsconfig-paths-register splits/verify-data.ts

# All symbols
npx ts-node -r tsconfig-paths-register splits/verify-data.ts

# Inspect specific bar
$env:SYMBOL="AAPL"; $env:DATE="2024-01-02"; npx ts-node -r tsconfig-paths-register splits/verify-data.ts
```
