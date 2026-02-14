# HTTP Wrappers & Emulator Development Scripts

**Created**: February 14, 2026  
**Last Updated**: February 14, 2026

This directory contains HTTP wrapper scripts and development tools for testing functions in the Firebase emulator environment. These scripts provide direct HTTP access to functions for isolated testing, debugging, and development workflows without going through the full pipeline.

## Scripts

### av-timeseries-http.ts
**Purpose**: HTTP wrapper for per-interval time-series refresh (Daily, Weekly, Monthly) that calls handlers directly for isolated testing of specific intervals.

**Environment**: Emulator-only

**Parameters**:
- `SYMBOL` (env): Target symbol for refresh (optional, default: "AAPL")
- `INTERVAL` (env): Time series interval (daily|weekly|monthly, default: "daily")
- `ENDPOINT` (env): Alpha Vantage endpoint (default: "TIME_SERIES_DAILY_ADJUSTED")
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Calls time-series handlers directly
- Returns HTTP response with refresh results
- Logs processing details and any errors
- Writes to appropriate Firestore collections

**Use Cases**:
- Testing individual time-series interval updates in isolation
- Debugging specific interval processing logic
- Validating data writes for Daily, Weekly, Monthly intervals
- Testing handler functions without full pipeline overhead
- Developing and debugging time-series features

**Reasons for Using**:
- Direct handler access bypasses pipeline complexity
- Isolated testing focuses on specific functionality
- Faster iteration for development and debugging
- Supports testing with custom symbols and intervals
- Essential for time-series feature development

**Features**: 
- Calls handlers directly for testing individual interval writes
- Useful for isolated testing of specific intervals
- Bypasses full pipeline for focused testing

**Usage**:
```bash
# Start emulator first, then:
npx ts-node -r tsconfig-paths-register emulator/av-timeseries-http.ts
```

### av-timeseries-http.README.md
**Purpose**: Comprehensive documentation for the time-series HTTP wrapper including endpoint details, configuration options, and troubleshooting guide.

**Parameters**: N/A (documentation file)

**Output**: N/A (documentation file)

**Content**: 
- Detailed usage instructions for each interval
- HTTP endpoint specifications
- Request/response format documentation
- Common error scenarios and solutions

### av-refresh-http.ts
**Purpose**: HTTP wrapper for `runRefreshAlphaVantageDataV2` that provides direct HTTP access to the refresh manager for testing.

**Status**: 🔧 Needs refactor - uses old single-refresh-manager pattern

**Environment**: Emulator-only

**Parameters**:
- `SYMBOL` (env): Target symbol for refresh (optional, default: "AAPL")
- `FORCE` (env): Force refresh regardless of schedule (default: "true")
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Calls old refresh manager via HTTP
- Returns refresh results and status
- Logs processing details
- May not exercise current production path

**Use Cases**:
- Quick testing of refresh functionality
- Validating refresh manager behavior
- Debugging refresh logic with specific symbols
- Testing refresh responses and error handling
- Development testing of refresh features

**Reasons for Using**:
- Simple HTTP interface for easy testing
- Quick feedback on refresh operations
- Supports custom symbol and force refresh options
- Useful for development and debugging
- Note: Doesn't exercise current production path

**Current Limitation**: Doesn't exercise the current A/B/C job pipeline.
**Use Case**: Quick emulator testing (though doesn't match production path).

**Usage**:
```bash
npx ts-node -r tsconfig-paths-register emulator/av-refresh-http.ts
```

### av-refresh-http.README.md
**Purpose**: Documentation for the refresh HTTP wrapper.

**Status**: 🔧 Stale - needs updating to reflect current architecture

**Parameters**: N/A (documentation file)

**Output**: N/A (documentation file)

**Content**: Usage instructions and endpoint details (needs refresh for current architecture).

### dev-refresh-loop.ts
**Purpose**: Long-running emulator loop for continuous PRE intraday snapshots and testing of PRE phase data updates.

**Status**: 🔧 Needs refactor - phase enum issue

**Parameters**:
- `SYMBOLS` (env): Comma-separated symbols to monitor (optional, default: "AAPL")
- `INTERVAL_MS` (env): Loop interval in milliseconds (default: 60000)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Output**:
- Continuously calls PRE phase refresh
- Logs each refresh cycle and results
- Monitors symbol data changes
- Provides real-time feedback on PRE updates

**Use Cases**:
- Continuous monitoring of PRE phase data updates
- Testing PRE phase refresh behavior over time
- Developing PRE phase specific features
- Monitoring intraday data pipeline performance
- Testing long-running refresh operations

**Reasons for Using**:
- Automated monitoring provides continuous feedback
- Configurable intervals support different testing needs
- Real-time logs show refresh patterns
- Essential for PRE phase feature development
- Note: Needs enum fix for proper operation

**Current Limitation**: Passes `__phase: 'pre'` as string instead of `TradingPhase.PRE` enum.
**Planned Fix**: Update to use proper TradingPhase enum.

**Use Case**: Continuous testing of PRE phase data updates and monitoring of intraday snapshot behavior.

**Usage**:
```bash
npx ts-node -r tsconfig-paths-register emulator/dev-refresh-loop.ts
```
