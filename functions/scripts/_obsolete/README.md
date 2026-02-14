# Obsolete Scripts

**Created**: February 14, 2026  
**Last Updated**: February 14, 2026

This directory contains scripts that are no longer relevant, have been superseded by newer implementations, or were one-time utilities that are no longer needed. These files are kept for historical reference but are safe to delete. Review each script's description before deletion to ensure no valuable logic is lost.

## Scripts

### backfill-symbol-data-from-report.ts
**Status**: ⚠️ One-Off - Remediation script
**Purpose**: Created minimal symbol-data documents for symbols identified in `find-incomplete-sa-timeseries.output.json`.

**Parameters**: None (uses hardcoded output file)

**Output**:
- Creates basic `symbol-data/{symbol}` documents
- Logs remediation operations
- Returns processing summary

**Use Cases**:
- Reference for similar remediation tasks in the future
- Understanding symbol-data document structure
- Learning from previous data integrity issues
- Template for creating minimal symbol documents
- Historical context for data remediation efforts

**Reasons for Keeping**:
- Provides example of remediation script patterns
- Documents approach to fixing missing symbol-data issues
- Useful reference for similar data recovery scenarios
- Historical context helps understand past issues
- May contain reusable logic for future needs

**Historical Context**: Was used to remediate missing symbol-data documents after data integrity issues were discovered.

### backfill-timeseries-window.ts
**Status**: ❌ Obsolete - Self-deprecated
**Purpose**: Legacy backfill script for processing time-series data windows.

**Parameters**: Various CLI parameters for window processing

**Output**: Processed time-series data (legacy format)

**Use Cases**:
- Reference for understanding legacy backfill architecture
- Learning from previous data processing approaches
- Historical analysis of data ingestion patterns
- Understanding why v2 pipeline was implemented
- Reference for potential legacy system maintenance

**Reasons for Obsolescence**:
- Explicitly marked `@deprecated` by original author
- 798 lines of legacy code with maintenance burden
- Superseded by v2 job pipeline with better architecture
- Legacy patterns no longer align with current system
- Removing reduces codebase complexity

**Deprecation**: Explicitly marked `@deprecated` in its own JSDoc.
**Superseded By**: v2 job pipeline with improved architecture.
**Size**: 798 lines of legacy code that should be removed.

### find-incomplete-sa-timeseries.output.json
**Status**: ⚠️ One-Off - Output artifact
**Purpose**: Empty JSON array output from a previous run of `find-incomplete-sa-timeseries.ts`.

**Parameters**: N/A (output file)

**Output**: Empty array `[]`

**Use Cases**:
- Historical record of diagnostic results
- Reference for empty result handling
- Understanding diagnostic script output format
- Template for future diagnostic report structures
- Historical context for data completeness analysis

**Reasons for Obsolescence**:
- Empty array indicates no issues were found
- Output artifact from completed diagnostic task
- No longer needed for current operations
- Can be safely deleted without losing information
- Takes up minimal storage space

**Content**: Result from a previous diagnostic run that found no issues.

### retrigger-on-symbol-added-from-report.ts
**Status**: ⚠️ One-Off - Remediation script
**Purpose**: Re-fired `onSymbolAdded` Cloud Function by deleting and recreating tracked-symbols documents.

**Parameters**: None (uses hardcoded output file)

**Output**:
- Deletes and recreates `tracked-symbols/{symbol}` documents
- Triggers `onSymbolAdded` function
- Logs retrigger operations

**Use Cases**:
- Reference for Cloud Function retriggering patterns
- Understanding tracked-symbols document lifecycle
- Template for manual function trigger simulation
- Learning from previous remediation approaches
- Historical context for data recovery procedures

**Reasons for Keeping**:
- Demonstrates Cloud Function retriggering technique
- Shows approach to forcing function execution
- Useful reference for similar remediation scenarios
- Documents pattern for delete/recreate operations
- May contain reusable logic for future needs

**Historical Context**: Was used to remediate symbols from the incomplete SA timeseries report by forcing reprocessing.

### script-env-vars.txt
**Status**: ❌ Obsolete - Security risk
**Purpose**: Contained hardcoded API keys and environment variables for script execution.

**Parameters**: N/A (configuration file)

**Output**: N/A (configuration file)

**Use Cases**:
- None - this file should be deleted immediately
- Reference for what NOT to do with credentials
- Example of security anti-patterns to avoid
- Understanding proper environment variable management
- Template for creating secure configuration examples

**Reasons for Obsolescence**:
- Contains hardcoded API keys posing major security risk
- Violates security best practices for credential management
- Could be exploited if accidentally committed to version control
- Should be replaced with secure configuration template
- Immediate deletion recommended

**Issue**: Contains hardcoded API keys (Alpha Vantage + Benzinga) posing security risk.
**Recommendation**: Should be deleted and replaced with `.env.example` template with placeholder values for security.

### test-firestore.ts
**Status**: ❌ Obsolete - Basic connectivity test
**Purpose**: Basic Firestore connectivity test with simple read/write operations.

**Parameters**: None (uses hardcoded test document)

**Output**:
- Tests Firestore connection
- Writes to `test/test` document
- Returns connection status

**Use Cases**:
- Reference for basic Firestore connectivity testing
- Understanding Firestore document operations
- Template for simple database validation
- Learning basic Firebase Admin SDK usage
- Historical context for early development testing

**Reasons for Obsolescence**:
- Exports `onRequest` function, not a standalone script
- Very basic connectivity test with limited value
- Better alternatives exist for comprehensive testing
- Doesn't follow current script patterns
- Uses hardcoded test document path

**Issue**: Exports an `onRequest` function, not a standalone script.
**Replacement**: Better alternatives exist for connectivity testing.

### test-symbol-add.ts
**Status**: ❌ Obsolete - Duplicate functionality
**Purpose**: Duplicated `test-save-tracked-symbol.ts` functionality with inline setup.

**Parameters**: Similar to `test-save-tracked-symbol.ts`

**Output**: Similar to `test-save-tracked-symbol.ts`

**Use Cases**:
- Reference for understanding duplicate functionality
- Learning why code deduplication is important
- Example of what NOT to do when creating tests
- Template for proper script structure
- Historical context for script organization

**Reasons for Obsolescence**:
- Duplicates functionality in `test-save-tracked-symbol.ts`
- Creates code maintenance burden
- Has its own inline `setupEmulator()` instead of using shared utility
- Violates DRY (Don't Repeat Yourself) principle
- Increases testing complexity without adding value

**Problem**: Has its own inline `setupEmulator()` instead of using `scripts-util.ts`, creating code duplication.
**Replacement**: Use `test-save-tracked-symbol.ts` instead.

### test-update-daily.ts
**Status**: ❌ Obsolete - Trivial test
**Purpose**: Minimal test that calls `handler.fetch({ symbol })` without proper configuration.

**Parameters**: Hardcoded symbol "AAPL"

**Output**: Basic API response with no meaningful validation

**Use Cases**:
- Reference for minimal API testing patterns
- Understanding basic Alpha Vantage API usage
- Template for simple connectivity validation
- Learning what constitutes inadequate testing
- Example of what NOT to do in test scripts

**Reasons for Obsolescence**:
- Minimal test that doesn't validate meaningful functionality
- Uses hardcoded symbol without configuration
- Doesn't test proper outputsize parameter
- No error handling or validation
- Provides little to no value for debugging

**Problem**: Doesn't test any meaningful path or use proper outputsize parameter.
**Replacement**: Use `test-time-series-refresh.ts` or `test-init-timeseries.ts` for proper testing.

## Recommended Action

These files can be safely deleted to reduce codebase clutter, with the exception of the one-off remediation scripts which might be useful as reference for similar future tasks.
