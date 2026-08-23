**Topic:** Implement AV earnings-related endpoints (3)
**Issue:** #35
**Topic Parent:** #33
**Domain:** EARNINGS
**Type:** Implementation Plan
**Status:** Draft
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

# Implementation Plan: BE — AV Earnings Endpoints

## Overview

The BE area owns the handler implementations, CSV parser utility, factory registration, and refresh manager fix. All handlers live in `functions/src/v2/alpha-vantage/handlers/`.

## Components

### 1. CSV parser utility

New file `functions/src/v2/alpha-vantage/utils/csv-parser.ts`:

Hand-rolled parser. No external library. Handles:
- Standard comma-delimited rows
- Quoted fields (defensive — handles embedded commas inside quotes)
- Empty fields (returns empty string)
- Headers-only input (returns empty array)
- Trailing newline at end of input

Interface: `parseCsv(input: string): string[][]` — returns array of rows, each row an array of field values. First row is headers.

### 2. AvEarningsHandler

New file `functions/src/v2/alpha-vantage/handlers/av-earnings.handler.ts`:

- Extends `AlphaVantageStandardHandlerBase<AvEarningsResponse>`
- Implements `transformResponse(data: any): AvEarningsResponse`
- Extracts `annualEarnings` and `quarterlyEarnings` arrays from AV response
- Preserves `reportTime` field on quarterly entries
- Standard fetch path (base class handles API call + Firestore save)

### 3. AvEarningsEstimatesHandler

New file `functions/src/v2/alpha-vantage/handlers/av-earnings-estimates.handler.ts`:

- Extends `AlphaVantageStandardHandlerBase<AvEarningsEstimatesResponse>`
- Implements `transformResponse(data: any): AvEarningsEstimatesResponse`
- Extracts `estimates` array from AV response
- Handles nullable fields — passes through `null` values as-is, types them as `string | null`
- Standard fetch path

### 4. AvEarningsCalendarHandler

New file `functions/src/v2/alpha-vantage/handlers/av-earnings-calendar.handler.ts`:

- Extends `AlphaVantageBaseHandler<AvEarningsCalendarEntry[]>`
- Overrides `fetch()` — cannot use standard base (CSV, not JSON)
- Same override pattern as `AvHistoricalOptionsHandler`
- Fetch flow:
  1. Call AV with `function=EARNINGS_CALENDAR`, `horizon=12month`, `apikey=...` (no symbol)
  2. Response is CSV text — parse with `parseCsv()`
  3. Map rows to `AvEarningsCalendarEntry[]` using header row
  4. Read `tracked_symbols` collection from Firestore
  5. Filter entries to tracked symbols only
  6. Call `saveAvData()` with filtered list, no symbol (global doc)
  7. Return `ApiResponse` with filtered list
- `transformResponse()` throws (deprecated, like historical options handler) — transformation is inline in `fetch()`
- Reads tracked symbols from Firestore: `db.collection('tracked_symbols').listDocuments()` → extract symbol IDs

### 5. Factory registration

Update `functions/src/v2/alpha-vantage/alpha-vantage-factory.ts`:

Add to `HANDLER_MAP`:
- `AlphaVantageEndpoint.EARNINGS` → `AvEarningsHandler`
- `AlphaVantageEndpoint.EARNINGS_ESTIMATES` → `AvEarningsEstimatesHandler`
- `AlphaVantageEndpoint.EARNINGS_CALENDAR` → `AvEarningsCalendarHandler`

### 6. Refresh manager fix

Update `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager.ts`:

The current loop iterates `for (const symbol of symbols)` for every endpoint. For `NOT_SUPPORTED` endpoints (no `{symbol}` in path), `resolveFirestorePath` returns the same path regardless of symbol — so the first iteration refreshes the doc, and all subsequent iterations skip it (doc is fresh). This is wasteful: N-1 redundant Firestore reads per NOT_SUPPORTED endpoint.

Fix: before the per-symbol loop, check `endpointConfig.symbolUsage`. If `NOT_SUPPORTED`, process the endpoint once (outside the symbol loop) and `continue` to the next endpoint. This affects `EARNINGS_CALENDAR`, `IPO_CALENDAR`, and any future global endpoints.

## Phases

### Phase 1: CSV parser utility

**Task B1: CSV parser + tests**
- Create `csv-parser.ts` with `parseCsv()` function
- Tests: real 12-month sample, empty fields, headers-only, quoted fields with embedded commas
- Blocked by: S2

### Phase 2: JSON handlers

**Task B2: AvEarningsHandler + tests**
- Create handler, extends standard base
- Tests: mock AV JSON, verify transformResponse output shape, reportTime preserved
- Blocked by: S2

**Task B3: AvEarningsEstimatesHandler + tests**
- Create handler, extends standard base
- Tests: mock AV JSON, verify transformResponse, nullable field handling
- Blocked by: S2

### Phase 3: CSV handler

**Task B4: AvEarningsCalendarHandler + tests**
- Create handler, extends base, overrides fetch()
- Tests: mock AV CSV, verify parsing + filtering + saveAvData called with filtered result, empty response handling
- Mock saveAvData and tracked_symbols Firestore read
- Blocked by: B1, S2

### Phase 4: Integration

**Task B5: Factory registration + refresh manager fix**
- Register all three handlers in factory
- Fix refresh manager: process NOT_SUPPORTED endpoints once outside per-symbol loop
- Integration verification: handlers resolve via factory, refresh manager processes global endpoint once
- Blocked by: B2, B3, B4

## Cross-area boundaries

- Imports types and config from SHARED package
- Uses existing `saveAvData` writer (untested — mock in handler tests)
- Uses existing `resolveFirestorePath` utility (no changes needed)

## Technical risks

- **CSV parsing edge cases:** AV CSV format is simple (no embedded commas in 1,814 real rows), but quoted-field handling is added defensively. If AV changes the format, parser may need updates.
- **Tracked symbols read in calendar handler:** The handler reads `tracked_symbols` collection during fetch. This is a Firestore read inside a fetch call — adds latency. Acceptable since the calendar refreshes once daily.
- **saveAvData for global doc:** The existing `saveAvData` expects a symbol parameter. For the global calendar (no symbol), the handler must call `saveAvData` with no symbol or an empty string. Need to verify `saveAvData` and `resolveFirestorePath` handle this correctly — the path has no `{symbol}` placeholder so it should work, but the writer may have symbol-dependent logic.
- **Refresh manager fix scope:** The fix affects all NOT_SUPPORTED endpoints, not just EARNINGS_CALENDAR. IPO_CALENDAR will also change behavior. This is correct but should be verified.
