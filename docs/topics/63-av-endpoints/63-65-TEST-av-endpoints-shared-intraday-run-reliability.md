**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #65  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Test Plan  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

## Area: SHARED

## Unit test targets

### MarketCalendarService

Prior art: `functions/tests/v2/historical-options-corpus/trading-calendar.service.test.ts`

- `isTradingDay` returns false for weekends (Sat, Sun)
- `isTradingDay` returns false for NYSE holidays (Labor Day 2026-09-07, Christmas 2026-12-25, etc.)
- `isTradingDay` returns true for normal trading days
- `isMarketOpenAt` returns false for a holiday date regardless of clockPt
- `isMarketOpenAt` returns false for a weekend regardless of clockPt
- `isMarketOpenAt` returns true for a normal trading day at 0800, 1000, 1200 PT
- `isMarketOpenAt` returns true for an early-close day at 0800 PT (11:00 ET, before 13:00 ET close)
- `isMarketOpenAt` returns true for an early-close day at 1000 PT (13:00 ET, at the close boundary — verify boundary behavior)
- `isMarketOpenAt` returns false for an early-close day at 1200 PT (15:00 ET, after 13:00 ET close)
- `getEarlyCloseEt` returns "13:00" for 2026-11-27 (day after Thanksgiving)
- `getEarlyCloseEt` returns "13:00" for 2026-12-24 (Christmas Eve)
- `getEarlyCloseEt` returns null for a normal trading day
- `getEarlyCloseEt` returns null for a holiday (closed all day)
- Year-coverage guard throws when the requested year is not in the static data
- Year-coverage guard error message names the missing year

## Test seams

- `MarketCalendarService` is a pure function over static data. No Firestore, no network. Test directly with constructed instances.
- No mocking required.

## Edge cases

- Boundary: 1000 PT = 13:00 ET on an early-close day. Is the market open at exactly 13:00 ET? Define and test the boundary explicitly.
- Year transition: 2026-12-31 (covered) vs 2027-01-04 (not covered) — guard should throw for 2027.
- Observed holidays: 2026-07-03 (Independence Day observed) should be closed.
