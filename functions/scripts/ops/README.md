# Operations Scripts

**Created**: February 14, 2026  
**Last Updated**: February 14, 2026

This directory contains scripts for operational tasks, security management, and maintenance procedures. These tools handle cleanup operations, security lockdowns, and data management tasks that require careful execution with proper safety controls.

## Scripts

### cleanup-weekly-2026.ts
**Purpose**: Deletes split-adjusted WEEKLY 2026 shards to clean up problematic data and free storage space.

**Status**: ⚠️ One-Off - Was a one-time cleanup task

**Parameters**:
- `SYMBOLS` (env): Comma-separated list of symbols (optional, default: all tracked symbols)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)
- `DRY_RUN` (env): Set to "0" to actually delete (default: "1")

**Output**:
- Deletes `symbol-data/{symbol}/sa-time-series/av-weekly/2026` documents
- Logs deletion operations and statistics
- Returns summary of documents deleted
- Reports any errors encountered

**Safety Features**: 
- Defaults to emulator unless explicitly disabled
- Dry run mode available for safe preview
- Detailed logging of all operations

**Use Cases**:
- Cleaning up corrupted or problematic weekly data shards
- Freeing storage space by removing unnecessary data
- Recovering from data ingestion errors in specific time periods
- Testing data deletion procedures before production use
- Managing data lifecycle for specific time periods

**Reasons for Using**:
- Targeted cleanup removes only problematic data
- Dry run mode ensures safe operation
- Detailed logging provides operation audit trail
- Defaults to emulator for safe testing
- Can be generalized for other time periods if needed

**Use Case**: Could be generalized into a "cleanup-weekly-shard" script with year parameter if needed again.

**Usage**:
```bash
# Dry run (safe)
npx ts-node -r tsconfig-paths-register ops/cleanup-weekly-2026.ts

# Production (destructive)
$env:USE_EMULATOR_SCRIPTS="off"; $env:DRY_RUN="0"; \
npx ts-node -r tsconfig-paths-register ops/cleanup-weekly-2026.ts

# Specific symbols only
$env:SYMBOLS="AAPL,MSFT"; npx ts-node -r tsconfig-paths-register ops/cleanup-weekly-2026.ts
```

### wipe-raw-timeseries.ts
**Purpose**: Deletes legacy `time-series` (raw) collection that contains non-split-adjusted historical data.

**Status**: ⚠️ One-Off - The raw collection has already been wiped in production

**Parameters**:
- `SYMBOLS` (env): Comma-separated list of symbols (optional, default: all tracked symbols)
- `USE_EMULATOR_SCRIPTS` (env): Use emulator vs production (default: on)
- `DRY_RUN` (env): Set to "0" to actually delete (default: "1")

**Output**:
- Deletes `time-series/{symbol}` documents and subcollections
- Does NOT touch `sa-time-series` (split-adjusted)
- Logs deletion operations and batch sizes
- Returns summary of collections and documents deleted

**Safety Features**: 
- Dry run mode for safe preview
- Batch deletion for performance
- Explicit protection of split-adjusted data
- Can target specific symbols or all tracked symbols

**Use Cases**:
- Removing legacy raw data collections after migration
- Cleaning up accidental raw data recreation
- Testing data deletion procedures and safety measures
- Recovering from data corruption in raw collections
- Validating that split-adjusted data is properly protected

**Reasons for Using**:
- Batch deletion ensures efficient cleanup
- Dry run mode prevents accidental data loss
- Explicit protection of split-adjusted data
- Supports both targeted and full-universe operations
- Essential for legacy data management

**Use Case**: Only useful if raw data somehow reappears or for testing cleanup procedures.

**Usage**:
```bash
# Dry run
npx ts-node -r tsconfig-paths-register ops/wipe-raw-timeseries.ts

# Production (destructive)
$env:USE_EMULATOR_SCRIPTS="off"; npx ts-node -r tsconfig-paths-register ops/wipe-raw-timeseries.ts

# Specific symbols
$env:SYMBOLS="AAPL,MSFT"; npx ts-node -r tsconfig-paths-register ops/wipe-raw-timeseries.ts
```

### lockdown-invokers.ps1
**Purpose**: PowerShell script to lock down Cloud Run HTTPS function invokers by removing public access and granting specific service account permissions for enhanced security.

**Parameters**:
- `ProjectId` (string): GCP project ID (required)
- `Region` (string): Deployment region (required)
- `InvokerServiceAccount` (string): Service account to grant access (required)
- `Services` (string): Comma-separated list of services (required)

**Output**:
- Removes `allUsers` access from specified Cloud Run services
- Grants `roles/run.invoker` to specified service account
- Logs all IAM policy changes
- Returns success/failure status for each service

**Functionality**:
- Removes public access (`allUsers`)
- Grants `roles/run.invoker` to specified service account
- Supports multiple services in single execution
- Provides detailed logging of security changes

**Use Cases**:
- Implementing principle of least privilege for Cloud Run services
- Securing partner endpoints from public access
- Locking down internal services after development
- Implementing proper access control for production deployments
- Managing service-to-service communication securely

**Reasons for Using**:
- Removes public access to prevent unauthorized usage
- Grants specific permissions only to required service accounts
- Supports multiple services in single operation
- Detailed logging provides security audit trail
- Essential for production security hardening

**Use Case**: Security operations to restrict access to external/partner HTTP services and implement principle of least privilege.

**Usage**:
```powershell
# Example usage
.\lockdown-invokers.ps1 -ProjectId "my-project" -Region "us-central1" `
  -InvokerServiceAccount "partner@my-project.iam.gserviceaccount.com" `
  -Services "partnerListTrackedSymbolsV2,partnerTimeSeriesV2"
```

### lockdown-invokers.README.md
**Purpose**: Comprehensive documentation for the lockdown script including security considerations, prerequisites, and troubleshooting guide.

**Parameters**: N/A (documentation file)

**Output**: N/A (documentation file)

**Content**: 
- Detailed usage instructions and examples
- Security best practices and considerations
- IAM permissions requirements
- Common issues and troubleshooting steps
- Rollback procedures and recovery options
