**Topic:** Implement AV earnings-related endpoints (3)
**Issue:** #35
**Topic Parent:** #33
**Domain:** EARNINGS
**Type:** Implementation Plan
**Status:** Draft
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

# Implementation Plan: SHARED — AV Earnings Endpoints

## Overview

The SHARED area owns the `shared/alpha-vantage/` package: the `SavantApiEndpoint` enum, TypeScript response types, and endpoint config changes. These are consumed by the BE handlers and tests.

## Components

### 1. SavantApiEndpoint enum

New file `shared/alpha-vantage/savant-api-endpoints.ts`:

```typescript
export enum SavantApiEndpoint {
  SA_EARNINGS                  = 'SA_EARNINGS',
  SA_EARNINGS_ESTIMATES        = 'SA_EARNINGS_ESTIMATES',
  SA_EARNINGS_CALENDAR         = 'SA_EARNINGS_CALENDAR',
  SA_EARNINGS_CALENDAR_GLOBAL  = 'SA_EARNINGS_CALENDAR_GLOBAL',
}

// Maps each SA endpoint to the AV function it calls (or derives from)
export const SA_ENDPOINT_TO_AV_FUNCTION: Record<SavantApiEndpoint, AlphaVantageEndpoint> = {
  SavantApiEndpoint.SA_EARNINGS:                  AlphaVantageEndpoint.EARNINGS,
  SavantApiEndpoint.SA_EARNINGS_ESTIMATES:        AlphaVantageEndpoint.EARNINGS_ESTIMATES,
  SavantApiEndpoint.SA_EARNINGS_CALENDAR:         AlphaVantageEndpoint.EARNINGS_CALENDAR,
  SavantApiEndpoint.SA_EARNINGS_CALENDAR_GLOBAL:  AlphaVantageEndpoint.EARNINGS_CALENDAR,
};
```

The existing `AlphaVantageEndpoint` enum is unchanged — it uses raw AV function names. The SA- enum is the consumer-facing identity layer.

### 2. TypeScript response types

New file `shared/alpha-vantage/av-earnings-types.ts`:

- `AvEarningsResponse` — `{ symbol, annualEarnings: AvAnnualEarning[], quarterlyEarnings: AvQuarterlyEarning[] }`
- `AvAnnualEarning` — `{ fiscalDateEnding, reportedEPS }`
- `AvQuarterlyEarning` — `{ fiscalDateEnding, reportedDate, reportedEPS, estimatedEPS, surprise, surprisePercentage, reportTime }`
- `reportTime` type: `'pre-market' | 'post-market'`

New file `shared/alpha-vantage/av-earnings-estimates-types.ts`:

- `AvEarningsEstimatesResponse` — `{ symbol, estimates: AvEarningsEstimate[] }`
- `AvEarningsEstimate` — all fields from AV response, numeric values as strings, nullable fields typed as `string | null`
- `horizon` type: `'fiscal year' | 'fiscal quarter'`

New file `shared/alpha-vantage/av-earnings-calendar-types.ts`:

- `AvEarningsCalendarEntry` — `{ symbol, name, reportDate, fiscalDateEnding, estimate, currency, timeOfTheDay }`
- `estimate` and `timeOfTheDay` can be empty strings

### 3. Config changes in `av-endpoint-configs.ts`

- EARNINGS: `ttl` 30d → 7d (firestorePath already correct: `symbol-data/{symbol}/earnings/av-earnings`)
- EARNINGS_ESTIMATES: `firestorePath` → `symbol-data/{symbol}/earnings/av-earnings-estimates` (regrouping from `earnings-estimates/av-earnings-estimates`)
- EARNINGS_CALENDAR: change from per-symbol (OPTIONAL, `symbol-data/{symbol}/earnings-calendar/av-earnings-calendar`) to global (`NOT_SUPPORTED`, `market-data/av-earnings-calendar`, add `horizon=12month` parameter)
- Add EARNINGS, EARNINGS_ESTIMATES, EARNINGS_CALENDAR to `AV_IMPLEMENTED_ENDPOINTS`

## Phases

### Phase 1: Foundation (enum + types + config)

**Task S1: SavantApiEndpoint enum + TypeScript response types**
- Create `savant-api-endpoints.ts` with enum + AV function mapping
- Create `av-earnings-types.ts`, `av-earnings-estimates-types.ts`, `av-earnings-calendar-types.ts`
- Export from `shared/alpha-vantage/index.ts`
- Config tests: verify enum values, AV function mappings
- Blocked by: None

**Task S2: Config changes**
- Update EARNINGS TTL, EARNINGS_ESTIMATES firestorePath, EARNINGS_CALENDAR to global
- Update AV_IMPLEMENTED_ENDPOINTS
- Config tests: verify paths, TTLs, horizon, symbolUsage
- Blocked by: S1

## Cross-area boundaries

- BE handlers import types and config from SHARED
- BE factory imports new handlers and registers them by endpoint ID
- BE refresh manager reads config's `symbolUsage` to determine per-symbol vs global processing

## Technical risks

- **EARNINGS_ESTIMATES path change** is a breaking change for any existing Firestore docs at the old path. No migration needed — old docs become orphaned and will be re-fetched at the new path. Acceptable since the endpoint was never actively refreshed.
- **EARNINGS_CALENDAR config change** from OPTIONAL to NOT_SUPPORTED changes how `resolveFirestorePath` treats it. The path no longer has `{symbol}` — it's a fixed global path. Verified `resolveFirestorePath` returns the path as-is for NOT_SUPPORTED endpoints.
