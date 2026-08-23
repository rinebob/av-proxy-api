**Topic:** Implement AV earnings-related endpoints (3)
**Issue:** #35
**Topic Parent:** #33
**Domain:** EARNINGS
**Type:** Test Plan
**Status:** Draft
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

# Test Plan: BE — AV Earnings Endpoints

## E2E User Journeys

Not applicable — BE handlers are internal refresh infrastructure, not user-facing. E2E journeys will be covered by the future Earnings Research Venue topic.

## Integration Tests

- **Calendar handler + Firestore:** Mock `saveAvData` and tracked_symbols read. Verify the handler calls `saveAvData` with the filtered entries (not the full AV response). Verify it reads tracked_symbols before filtering.
- **Factory + handlers:** Verify `AlphaVantageHandlerFactory.createHandler()` returns the correct handler class for each of the three endpoints.

## Unit Tests

### CSV parser (`csv-parser.test.ts`)
- Parse real 12-month sample → verify row count and field values
- Empty fields (`estimate`, `timeOfTheDay` empty) → verify empty strings preserved
- Headers-only input (no data rows) → verify empty array
- Quoted fields with embedded commas → verify correct field extraction
- Trailing newline → verify no empty trailing row

### AvEarningsHandler (`av-earnings.handler.test.ts`)
- Mock AV JSON response → verify `transformResponse` output shape
- Verify `annualEarnings` array with `fiscalDateEnding` and `reportedEPS`
- Verify `quarterlyEarnings` array with all fields including `reportTime` (`pre-market` / `post-market`)
- Empty earnings (no annual or quarterly data) → verify empty arrays

### AvEarningsEstimatesHandler (`av-earnings-estimates.handler.test.ts`)
- Mock AV JSON response → verify `transformResponse` output shape
- Verify nullable fields pass through as `null` (e.g., `eps_estimate_revision_down_trailing_7_days`)
- Verify `horizon` values (`fiscal year`, `fiscal quarter`)
- Empty estimates array → verify empty array

### AvEarningsCalendarHandler (`av-earnings-calendar.handler.test.ts`)
- Mock AV CSV response → verify `fetch()` parses CSV, filters to tracked symbols, calls `saveAvData` with filtered result
- Mock `saveAvData` — do not rely on the untested writer
- Mock tracked_symbols Firestore read
- Empty CSV (headers only) → verify empty array, `saveAvData` called with empty array
- All entries filtered out (no tracked symbols match) → verify empty array stored (not skipped)

## Test Seams

- **Highest seam:** Handler-level tests with mock axios — same pattern as `historical-options-retrieval.service.test.ts`. Mock the AV API response, verify the handler's transformation/output.
- **Lower seam:** CSV parser as pure function — fastest, most reliable tests.
- **Lowest seam:** Config assertions (in SHARED test plan).

## Existing Test Coverage

- `historical-options-retrieval.service.test.ts` — mock axios pattern to follow for handler tests
- `av-technical-indicators-config.test.ts` — config assertion pattern (SHARED side)
- No existing tests for AV handlers outside historical options

## Edge Cases

- Empty AV response (no data) — each handler must handle gracefully
- Nullable fields in EARNINGS_ESTIMATES — must not throw, must preserve null
- CSV with empty fields — parser must return empty strings, not skip fields
- Global calendar with zero tracked-symbol matches — must store empty array (not skip write) so metadata updates
- `saveAvData` called with no symbol for global calendar — verify writer handles undefined/empty symbol

## What NOT to test

- `saveAvData` writer — untested in the codebase, not in scope to fix. Mock it in handler tests.
- Firestore integration — no emulator-based tests for this spec.
- Refresh manager fix — tested by verification that NOT_SUPPORTED endpoints process once. Can add a dedicated test if the fix is complex enough to warrant it.
