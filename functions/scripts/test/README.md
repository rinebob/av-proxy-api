# Test Scripts

**Created**: February 14, 2026  
**Last Updated**: February 14, 2026

This directory contains scripts for testing various components, endpoints, and functionality of the system. These test scripts help validate individual features, debug issues, and ensure proper operation of different services and APIs.

## Scripts

### test-bz-calendar-refresh.ts
**Purpose**: Tests Benzinga calendar refresh job functionality and validates proper operation of the calendar data update process.

**Parameters**: None (uses default configuration)

**Output**:
- Calls `runBenzingaCalendarRefreshJob` function
- Logs job execution status and results
- Returns success/failure status
- Reports any errors encountered during refresh

**Use Cases**:
- Validating Benzinga calendar refresh functionality
- Testing calendar data update processes
- Debugging calendar refresh issues
- Validating Benzinga API integration
- Testing calendar refresh job scheduling

**Reasons for Using**:
- Simple test with minimal dependencies
- Validates critical calendar functionality
- Provides quick feedback on job status
- Essential for Benzinga data pipeline testing
- Helps ensure calendar data accuracy

**Features**: Simple and working test with minimal dependencies.

**Usage**:
```bash
npx ts-node -r tsconfig-paths-register test/test-bz-calendar-refresh.ts
```

### test-init-timeseries.ts
**Purpose**: Tests `initializeTimeSeriesIfMissing` function for proper time-series document creation and initialization.

**Status**: 🔧 Needs refactor - uses non-adjusted endpoints

**Parameters**:
- `SYMBOL` (CLI): Symbol to test (required)
- `INTERVAL` (CLI): Time series interval (required)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Calls time-series initialization function
- Creates or validates time-series documents
- Logs initialization results
- Returns success/failure status

**Use Cases**:
- Testing time-series document creation for new symbols
- Validating initialization logic for different intervals
- Debugging time-series setup issues
- Testing document structure and metadata
- Validating endpoint mapping and configuration

**Reasons for Using**:
- Tests fundamental time-series functionality
- Validates document creation without full data
- Helps debug initialization failures
- Supports multiple interval testing
- Essential for time-series setup validation

**Current Limitation**: Uses `TIME_SERIES_DAILY` instead of `TIME_SERIES_DAILY_ADJUSTED`.
**Planned Fix**: Update to use adjusted endpoints for consistency with production.

**Usage**:
```bash
# Default symbol (AAPL)
npx ts-node -r tsconfig-paths-register test/test-init-timeseries.ts AAPL daily

# Custom symbol and interval
npx ts-node -r tsconfig-paths-register test/test-init-timeseries.ts MSFT weekly
```

### test-refresh-dispatcher.ts
**Purpose**: Tests the refresh dispatcher functionality and validates the A/B/C job pipeline operation.

**Status**: 🔧 Needs refactor - tests old refresh manager

**Parameters**:
- `SYMBOL` (CLI): Symbol to test (optional, default: "AAPL")
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Forces refresh cycle for specified symbol
- Verifies daily adjusted metadata
- Logs refresh process and results
- Returns validation status

**Use Cases**:
- Testing refresh dispatcher functionality in isolation
- Validating refresh cycle for specific symbols
- Debugging refresh metadata updates
- Testing refresh process without full pipeline
- Validating refresh dispatcher configuration

**Reasons for Using**:
- Isolated testing focuses on dispatcher logic
- Validates metadata updates and verification
- Supports custom symbol testing
- Helps debug refresh issues
- Note: Tests old architecture, not current pipeline

**Current Limitation**: Tests old `runRefreshAlphaVantageDataV2` refresh manager, not current A/B/C job pipeline.
**Features**: 
- Forces refresh cycle
- Verifies daily adjusted metadata
- Uses `setupEmulator()` and loads environment

**Usage**:
```bash
# Default symbol (AAPL)
npx ts-node -r tsconfig-paths-register -r module-alias/register test/test-refresh-dispatcher.ts

# Specific symbol
npx ts-node -r tsconfig-paths-register -r module-alias/register test/test-refresh-dispatcher.ts MSFT
```

### test-save-tracked-symbol.ts
**Purpose**: Tests `saveTrackedSymbol` callable function against emulator with comprehensive verification of Firestore updates.

**Parameters**:
- `SYMBOL` (CLI): Symbol to test (required)
- `--debug` (CLI): Enable debug logging (optional)
- `--prod` (CLI): Target production (recognized but not implemented)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Makes HTTP POST request to emulated callable function
- Verifies Firestore document creation/update
- Returns function response and verification status
- Logs detailed debug information when enabled

**Use Cases**:
- Testing tracked symbol creation and updates
- Validating callable function functionality
- Debugging symbol tracking issues
- Testing Firestore document operations
- Validating symbol metadata and configuration

**Reasons for Using**:
- Comprehensive test with verification
- Supports both emulator and production testing
- Detailed debug logging for troubleshooting
- Validates end-to-end symbol creation process
- Essential for symbol management testing

**Features**: Well-structured test with verification and comprehensive error handling.

**Usage**:
```bash
# Basic usage
npx ts-node -r tsconfig-paths-register test/test-save-tracked-symbol.ts GOOGL

# With debug flag
npx ts-node -r tsconfig-paths-register test/test-save-tracked-symbol.ts MSFT --debug
```

### test-symbol-search.ts
**Purpose**: Tests Alpha Vantage SYMBOL_SEARCH endpoint functionality and validates symbol search operations.

**Parameters**:
- `KEYWORDS` (CLI): Search keywords (required)
- `--prod` (CLI): Target production instead of emulator
- `--debug` (CLI): Show raw API responses
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Returns raw Alpha Vantage API response
- Returns processed function response with selected symbol
- Logs search results and selection reasoning
- Provides detailed debug information when enabled

**Use Cases**:
- Testing symbol search functionality and API responses
- Validating symbol selection logic and ranking
- Debugging search result processing
- Testing symbol search with different keywords
- Validating API integration and error handling

**Reasons for Using**:
- Well-documented with comprehensive examples
- Tests both raw API and processed responses
- Supports multiple testing modes (emulator/production/debug)
- Validates critical symbol discovery functionality
- Essential for symbol search feature testing

**Features**: Well-documented in main README.md with comprehensive usage examples.

**Usage**:
```bash
# Basic usage (emulator)
npx ts-node -r tsconfig-paths-register test/test-symbol-search.ts "walmart"

# Production test
npx ts-node -r tsconfig-paths-register test/test-symbol-search.ts --prod "walmart"

# Debug mode
npx ts-node -r tsconfig-paths-register test/test-symbol-search.ts --debug "walmart"
```

### test-time-series-refresh.ts
**Purpose**: Tests time-series refresh functions and validates refresh operations across different endpoints.

**Status**: 🔧 Needs refactor - doesn't exercise A/B/C job pipeline

**Parameters**:
- `SYMBOL` (CLI): Symbol to test (optional, default: "AAPL")
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Executes refresh functions with error catching
- Returns refresh results and status
- Logs processing details and any errors
- Provides health metrics information

**Use Cases**:
- Testing time-series refresh functions and endpoints
- Validating refresh operations across different symbols
- Debugging refresh failures and errors
- Testing refresh process with error handling
- Validating health metrics integration

**Reasons for Using**:
- Comprehensive error catching and reporting
- Supports custom symbol testing
- Includes helper for symbol tracking
- Provides detailed refresh status information
- Note: Tests old architecture, not current pipeline

**Current Limitation**: Tests `refreshForEndpoints` from old refresh manager. Doesn't exercise the A/B/C job pipeline.
**Features**: 
- Executes refresh functions with error catching
- Includes helper to ensure test symbol is tracked
- Provides comprehensive error reporting

**Usage**:
```bash
# Default symbol (AAPL)
npx ts-node -r tsconfig-paths-register test/test-time-series-refresh.ts

# Specific symbol
npx ts-node -r tsconfig-paths-register test/test-time-series-refresh.ts MSFT
```
