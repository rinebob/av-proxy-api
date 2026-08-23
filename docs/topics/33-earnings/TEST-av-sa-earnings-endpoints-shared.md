**Topic:** Implement AV earnings-related endpoints (3)
**Issue:** #35
**Topic Parent:** #33
**Domain:** EARNINGS
**Type:** Test Plan
**Status:** Draft
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

# Test Plan: SHARED — AV Earnings Endpoints

## E2E User Journeys

Not applicable for SHARED area — this area produces types and config consumed by BE. No user-facing behavior.

## Integration Tests

Not applicable — SHARED package is pure types and config objects. No runtime integration to test.

## Unit Tests

- `SavantApiEndpoint` enum: verify all four SA- values exist
- `SA_ENDPOINT_TO_AV_FUNCTION` mapping: verify each SA- endpoint maps to the correct AV function
- `AvEarningsResponse` type shape: verify type compiles with correct fields (annualEarnings, quarterlyEarnings with reportTime)
- `AvEarningsEstimatesResponse` type shape: verify nullable fields compile as `string | null`
- `AvEarningsCalendarEntry` type shape: verify fields match AV CSV columns

## Test Seams

- **Highest seam:** Pure assertion tests on config objects and enum values (same pattern as `av-technical-indicators-config.test.ts`)
- **Lower seams:** TypeScript compilation itself — if types are wrong, code won't compile

## Existing Test Coverage

- `av-technical-indicators-config.test.ts` — config assertion pattern to follow
- No existing tests for earnings types or config (these are new)

## Edge Cases

- EARNINGS TTL changed from 30d to 7d — test must assert 7d, not 30d
- EARNINGS_ESTIMATES firestorePath changed — test must assert new grouped path
- EARNINGS_CALENDAR symbolUsage changed from OPTIONAL to NOT_SUPPORTED — test must assert NOT_SUPPORTED
- EARNINGS_CALENDAR horizon parameter — test must assert `12month`
