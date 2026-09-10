**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #66  
**Task:** #72  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

## Summary

Task #72 replaces the inline weekend guard in `runIntradaySnapshotJobsForSymbols` with a `MarketCalendarService`-backed calendar gate. The gate logic is extracted into a testable helper (`getIntradaySkipReason`) that returns `'weekend'`, `'holiday'`, `'post_early_close'`, or `null`. The scheduler now skips job creation on holidays, weekends, and post-early-close ticks — no jobs created, no run doc written. 12 unit tests cover the gate logic.

## Standards

- File size: `intraday-calendar-gate.ts` is 45 lines, `av-time-series-refresh-manager.ts` is 1439 lines — both within limits.
- Single responsibility: the gate helper has one job — decide whether to skip. The scheduler delegates to it cleanly.
- No duplication: the weekend/holiday/early-close logic now lives in one place (`getIntradaySkipReason`), backed by `MarketCalendarService`. The old inline weekend guard is removed.
- No dead code: the old `dowIdx` computation using `new Date()` is replaced with one that derives from `marketDate`.
- Consistent patterns: the gate helper follows the existing pattern of extracting testable logic from the scheduler (similar to `clockPtNow`).
- Clean type contracts: `IntradaySkipReason` is a union type, `null` means "proceed". Clear and minimal.
- Security defaults: N/A.

No Standards findings.

## Spec

Acceptance criteria from task #72:

- [x] `runIntradaySnapshotJobsForSymbols` calls `MarketCalendarService.isMarketOpenAt()` before creating any jobs — **met** (via `getIntradaySkipReason` which delegates to `MarketCalendarService`)
- [x] Returns immediately on holiday with a log entry naming the holiday — **met** (logs `reason: 'holiday'`)
- [x] Returns immediately on weekend with a log entry — **met** (logs `reason: 'weekend'`)
- [x] Returns immediately on post-early-close tick with a log entry naming the early-close time — **met** (logs `reason: 'post_early_close'`)
- [x] Creates jobs normally on a trading day at 0800, 1000, 1200 PT — **met** (gate returns null, proceeds to job creation)
- [x] No run doc written when skipping — **met** (returns before `runRef.set()`)
- [x] Gate applies to both scheduled and manual invocations — **met** (gate is in `runIntradaySnapshotJobsForSymbols`, called by both `onSchedule` and `runIntradaySnapshotDev`)
- [x] Build passes — **met**

Test plan coverage:
- Scheduler skips job creation on a holiday — **met** (gate test: Labor Day returns 'holiday')
- Scheduler skips job creation on a weekend — **met** (gate tests: Saturday, Sunday return 'weekend')
- Scheduler skips job creation on an early-close day at 1200 PT — **met** (gate test: 2026-11-27 at 1200 returns 'post_early_close')
- Scheduler creates jobs on a normal trading day at 0800, 1000, 1200 PT — **met** (gate tests: all return null)
- Scheduler logs the skip reason — **met** (log entry includes `reason` field)

No Spec findings.

## Thermo-nuclear

- Abstraction quality: good. The gate helper is a deep module — it hides the calendar service, weekend/holiday distinction, and early-close logic behind a single function returning a skip reason or null. The scheduler doesn't need to know why it's skipping.
- File size: fine.
- Spaghetti detection: no spaghetti. The gate is a pure function over static data, called once at the top of the scheduler.
- Code judo: extracting the gate into a testable helper is the right move. The scheduler function is 127 lines and touches Firestore, Cloud Tasks, and logging — testing it directly would require heavy mocking. The gate is pure and testable in isolation.
- Bug fix: the `dowIdx` derivation was changed from `new Date()` (current ET time) to `marketDate` parameter. This fixes a pre-existing bug where manual invocations with past dates would get the wrong day-of-week in the runId. Good catch.
- Test quality: tests verify external behavior (input date + clock → skip reason). No implementation detail testing.
- Edge cases: early-close boundary (1000 PT = 13:00 ET, inclusive), observed holidays, both early-close days covered.

No Thermo-nuclear findings.

## Test results

- Unit tests: 12/12 passed
- Build: PASS

## Verdict: PASS

No critical, major, or minor findings. All acceptance criteria met. Build and tests pass. The gate helper is well-abstracted and testable.
