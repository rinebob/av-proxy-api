**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #67  
**Task:** #70  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

## Summary

Task #70 is "Unit tests for MarketCalendarService." The 25 unit tests were written test-first during task #69 (TDD) and committed in `75adad9`. This review verifies that the existing test coverage maps to task #70's acceptance criteria. No new code was written for this task.

## Standards

- Test file follows existing project patterns: `describe`/`it` blocks, direct import, no mocking (matches `trading-calendar.service.test.ts` prior art).
- Tests verify external behavior (input → output), not implementation details. No tests peek at private methods or internal state.
- No dead code, no duplication. Each test covers a distinct case.
- Test file size: 118 lines — well within limits.

No Standards findings.

## Spec

Acceptance criteria from task #70, mapped to existing tests:

- [x] Tests for `isTradingDay`: weekends, holidays, normal trading days — **met** (7 tests: Saturday, Sunday, Labor Day, Christmas, Independence Day observed, Monday, Wednesday)
- [x] Tests for `isMarketOpenAt`: holiday, weekend, normal day at 0800/1000/1200 PT, early-close day at 0800/1000/1200 PT — **met** (10 tests covering all combinations including early-close boundary)
- [x] Tests for `getEarlyCloseEt`: early-close days return 13:00, normal days return null, holidays return null — **met** (4 tests)
- [x] Test for year-coverage guard: throws for uncovered year, error message names the year — **met** (4 tests across all three methods + error message content)
- [x] Test for observed holidays (e.g. 2026-07-03 Independence Day observed) — **met** (1 test)
- [x] All tests pass — **met** (25/25)

No Spec findings.

## Thermo-nuclear

- Test quality: tests verify external behavior, not implementation details. Each test has a clear intent expressed in its description.
- Edge cases: early-close boundary (1000 PT = 13:00 ET, inclusive), observed holidays, year-coverage guard across all three public methods all covered.
- No missing edge cases identified beyond what the test plan specified.

No Thermo-nuclear findings.

## Test results

- Unit tests: 25/25 passed
- Build: PASS (verified during task #69)

## Verdict: PASS

No critical, major, or minor findings. All acceptance criteria met by the existing test suite. Tests were committed in `75adad9` as part of task #69 TDD.
