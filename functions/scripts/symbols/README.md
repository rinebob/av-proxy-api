# Symbol Universe & Import Scripts

**Created**: February 14, 2026  
**Last Updated**: February 14, 2026

This directory contains scripts for managing the symbol universe, importing data from external sources like ETF holdings, and onboarding new symbol collections. These tools handle bulk symbol operations, crosswalk generation, and universe enrichment for comprehensive market coverage.

## Scripts

### run-bulk-import.ts
**Purpose**: Calls production bulkImportSymbolsV2 callable function in batches from a JSON file for onboarding new symbol universes.

**Parameters**:
- `--file` (CLI): Path to JSON file with BulkImportItem[] (required)
- `--clientId` (CLI): Client identifier for tracking (required)
- `--chunkSize` (CLI): Batch size for API calls (optional, default: 200)
- `BULK_IMPORT_URL` (env): Production endpoint URL (required)
- `BULK_IMPORT_AUTH_BEARER` (env): Optional auth token for API calls

**Output**:
- Creates tracked symbols in Firestore
- Returns bulk import results with success/failure counts
- Logs processing progress and any errors
- Generates summary statistics

**Use Cases**:
- Onboarding new symbol universes from external data providers
- Bulk importing ETF constituents or index components
- Adding new market segments or asset classes
- Expanding coverage to international markets
- Migrating symbol lists from legacy systems

**Reasons for Using**:
- Batch processing handles large symbol lists efficiently
- Authenticated access ensures secure production operations
- Detailed logging tracks import progress and failures
- Supports chunked processing for memory efficiency
- Essential for scaling symbol universe management

**Use Case**: Onboarding new symbol universes from external data sources.

**Usage**:
```bash
# From functions/ directory
$env:BULK_IMPORT_URL="https://.../bulkImportSymbolsV2"; \
$env:BULK_IMPORT_AUTH_BEARER="<token>"; \
npx ts-node -r tsconfig-paths-register -P scripts/tsconfig.json \
  symbols/run-bulk-import.ts --file ../bulk-import.enriched_spy-qqq.json --clientId XL_UNIVERSE_SPY_QQQ
```

### import-etf-holdings.ts
**Purpose**: Ingests State Street ETF holdings text files into Firestore etf-holdings collection for universe enrichment.

**Parameters**:
- `ETF_TICKER` (CLI): ETF symbol to import (required)
- `INPUT_FILE_PATH` (CLI): Path to holdings text file (required)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)

**Input Format**: Text files with columns:
- ticker (string) - Stock symbol
- identifier (string) - Security identifier
- sedol (string) - SEDOL code
- weight (number) - Weight percentage (e.g., 2.242670)
- sector (string|null) - Sector classification
- sharesHeld (number) - Number of shares
- currency (string) - Local currency

**Output**:
- Upserts to `etf-holdings/{ETF}` collection in Firestore
- Logs import statistics and any parsing errors
- Returns success/failure status with record counts

**Use Cases**:
- Building comprehensive ETF holdings database
- Creating crosswalks between ETFs and their constituents
- Enriching symbol universe with ETF coverage data
- Supporting portfolio analysis and ETF research
- Maintaining up-to-date ETF holdings information

**Reasons for Using**:
- Standardized format ensures consistent data structure
- Automatic type conversion prevents data errors
- Direct Firestore integration for immediate availability
- Supports multiple ETF providers and formats
- Essential for ETF-based investment strategies

**Usage**:
```bash
# Example: Import XBI holdings
npx ts-node -r tsconfig-paths-register -P scripts/tsconfig.json \
  symbols/import-etf-holdings.ts XBI backfill/data/XBI.txt
```

### enrich-bulk-import-with-etfs.ts
**Purpose**: Builds secondary universe JSON from ETF holdings crosswalk for comprehensive symbol coverage.

**Status**: ⚠️ One-Off - Was used during initial universe setup

**Parameters**: None (uses configuration in script)

**Input Sources**: 
- Firestore collection: `etf-holdings/{ETF}`
- Primary JSON: `bulk-import.enriched_spy-qqq.json`

**Output**:
- Creates `bulk-import.enriched_XL-non-spy-qqq.json`
- Contains symbols from ETF holdings not in primary universe
- Logs enrichment statistics and processing summary

**Use Cases**:
- Expanding symbol universe with ETF-derived symbols
- Creating secondary universes for specialized strategies
- Enhancing coverage beyond primary market indices
- Supporting sector-specific or factor-based investing
- Building comprehensive market coverage

**Reasons for Using**:
- Leverages existing ETF holdings for symbol discovery
- Identifies gaps in current symbol coverage
- Creates complementary universes for different strategies
- Automated crosswalk generation saves manual effort
- Essential for comprehensive market coverage

**Process**: Cross-references ETF holdings with existing universe to identify additional symbols for comprehensive coverage.

**Usage**:
```bash
npx ts-node -r tsconfig-paths-register -P scripts/tsconfig.json \
  symbols/enrich-bulk-import-with-etfs.ts
```

### generate-ts-master-order.ts
**Purpose**: Generates ts-master-order.ts file containing optimized symbol processing order from enriched JSON universe data.

**Status**: ⚠️ One-Off - Was used during initial setup

**Parameters**: None (uses hardcoded file paths)

**Input Files**: 
- `bulk-import.enriched_spy-qqq.json`
- `bulk-import.enriched_XL-non-spy-qqq.json`

**Output**:
- Creates `functions/src/v2/alpha-vantage/data/ts-master-order.ts`
- Contains `TIME_SERIES_MASTER_SYMBOL_ORDER` array
- Includes auto-generated header with source information
- Logs generation statistics and symbol counts

**Use Cases**:
- Optimizing symbol processing order for performance
- Creating deterministic processing sequences
- Supporting parallel processing with consistent ordering
- Ensuring reproducible results across different runs
- Managing large-scale symbol processing workflows

**Reasons for Using**:
- Optimized order improves processing efficiency
- TypeScript constant provides compile-time safety
- Auto-generated header ensures traceability
- Supports performance tuning and optimization
- Essential for large-scale data processing

**Process**: Merges and deduplicates symbols from universe files, sorts them, and generates TypeScript constant for optimized processing order.

**Usage**:
```bash
npx ts-node -r tsconfig-paths-register symbols/generate-ts-master-order.ts
```
