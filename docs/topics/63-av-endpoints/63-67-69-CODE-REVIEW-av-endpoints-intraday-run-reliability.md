**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #67  
**Task:** #69  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

## Summary

Task #69 implements `MarketCalendarService` in `common/market-calendar/market-calendar.service.ts` with three public methods (`isTradingDay`, `isMarketOpenAt`, `getEarlyCloseEt`), a year-coverage guard, and PT-to-ET timezone conversion. 25 unit tests cover all acceptance criteria and edge cases from the test plan.

## Standards

- File size: 113 lines — well within limits.
- Single responsibility: the service has one job — market calendar decisions. Clean.
- No duplication: no duplicate code. Each method has a distinct purpose.
- No dead code: all methods are used by tests or by each other.
- Consistent patterns: follows the existing service pattern from `trading-calendar.service.test.ts` prior art.
- Clean type contracts: `string` inputs for dates, `string | null` return for early close, `boolean` returns for checks. Clear and minimal.
- Security defaults: N/A — no security concerns.
- Test conventions: tests follow existing project patterns (`describe`/`it`, direct import, no mocking).

No Standards findings.

## Spec

Acceptance criteria from task #69:

- [x] `MarketCalendarService` class exists with all three public methods — **met**
- [x] `isTradingDay` returns false for weekends and holidays, true for normal trading days — **met** (7 tests)
- [x] `isMarketOpenAt` converts PT HHMM to ET internally and returns false for post-early-close ticks — **met** (10 tests)
- [x] `getEarlyCloseEt` returns "13:00" for 2026-11-27 and 2026-12-24, null for normal days and holidays — **met** (4 tests)
- [x] Year-coverage guard throws for an uncovered year (e.g. 2027) with the year in the error message — **met** (4 tests)
- [x] Build passes — **met**

Test plan coverage: all items from the SHARED test plan are covered, including the early-close boundary (1000 PT = 13:00 ET), observed holidays (2026-07-03), and year-coverage guard error message content.

No Spec findings.

## Thermo-nuclear

- Abstraction quality: deep module. The service hides holiday data lookup, timezone conversion, and early-close logic behind three intent-revealing methods. Callers don't need to know about the data file or timezone math.
- File size: 113 lines — fine.
- Spaghetti detection: no spaghetti. Linear flow in each method.
- Code judo: the year-coverage guard is a good defensive pattern — fail loud, not silent. This directly addresses the holiday backlog root cause.
- Test quality: tests verify external behavior (input → output), not implementation details. No tests peek at private methods or internal state.
- Edge cases: early-close boundary (1000 PT = 13:00 ET, inclusive), observed holidays, year transition all covered.

Nit (not blocking): the `PT_TO_ET_OFFSET_HOURS` comment says "PT is 3 hours behind ET during normal trading hours" — the 3-hour offset is actually always correct for US timezones (they transition together), not just during trading hours. The comment is slightly misleading but not wrong.

No Thermo-nuclear findings (critical or major).

## Test results

- Unit tests: 25/25 passed
- Build: PASS

## Verdict: PASS

No critical or major findings. All acceptance criteria met. All test plan items covered. Build and tests pass.
