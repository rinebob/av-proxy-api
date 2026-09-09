**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #65  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Implementation Plan  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

## Area: SHARED

## Modules

### MarketCalendarService (new)

Location: `functions/src/v2/common/market-calendar/`

- `market-holidays.data.ts` — moved from `partner/` to `common/market-calendar/`. Existing import in `partner/market-holidays-partner.ts` updated to the new path. No content changes to the data file.
- `market-calendar.service.ts` — new service wrapping the static holiday data.

### Service interface

```typescript
class MarketCalendarService {
  /** True if the market is open on the given ET date (YYYY-MM-DD). */
  isTradingDay(date: string): boolean;

  /**
   * True if the market is open at the given PT clock time on the given ET date.
   * Returns false for weekends, holidays, and ticks after an early-close time.
   * Internally converts PT HHMM to ET wall-clock for comparison.
   */
  isMarketOpenAt(date: string, clockPt: string): boolean;

  /** Returns the early-close ET time (e.g. "13:00") for the date, or null. */
  getEarlyCloseEt(date: string): string | null;
}
```

### Year-coverage guard

If the requested year is not present in `UNIFIED_MARKET_HOLIDAYS`, the service throws with a clear message naming the missing year. It never silently returns an empty list. This makes the annual holiday list update a visible operational task, not a silent failure.

### Timezone conversion

The service owns the PT-to-ET conversion. `isMarketOpenAt(date, clockPt)` takes a PT HHMM string (e.g. "0800") and converts to ET wall-clock internally to compare against early-close times. Callers pass PT clock times directly — no conversion burden on the caller.

### Existing TradingCalendarService

The rule-based `TradingCalendarService` in `historical-options-corpus/services/` is unrelated and stays where it is. The intraday pipeline uses the static data file as its source of truth because it is authoritative (manually verified, includes special closures and early-close metadata).

## Dependencies

- `market-holidays.data.ts` (moved, not modified)
- No external dependencies

## Risks

- Moving `market-holidays.data.ts` breaks the one existing import in `partner/market-holidays-partner.ts`. Simple path update.
- The year-coverage guard is a behavioral change: code that previously got an empty list for an uncovered year will now throw. This is intentional — silent empty lists caused the holiday backlog problem.
