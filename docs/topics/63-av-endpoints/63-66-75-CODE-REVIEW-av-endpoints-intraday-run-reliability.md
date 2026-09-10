**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #66  
**Task:** #75  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-10  
**Last Updated:** 2026-09-10  

## Summary

Task #75 adds integration tests for the intraday scheduler and self-healing path. The tests mock Firestore and Cloud Tasks at the module boundary and verify the scheduler's observable effects: skip vs. create decisions, run doc state, PDR publication, and stale run force-completion. 12 integration tests cover all acceptance criteria.

## Standards

- File size: 311 lines — within limits for an integration test file.
- Single responsibility: the test file tests the scheduler's integration of the calendar gate and self-healing path. Each `describe` block groups related tests.
- No duplication: helper functions (`setupTrackedSymbols`, `setupNoStaleRuns`, `setupStaleRun`, `resetMocks`) reduce setup boilerplate without hiding test intent.
- No dead code: all mocks are used. No unused imports.
- Consistent patterns: follows the existing test patterns in the repo (jest.mock at module level, direct import after mocks, `describe`/`it` blocks).
- Clean type contracts: N/A (test file).
- Security defaults: N/A.

No Standards findings.

## Spec

Acceptance criteria from task #75:

- [x] Test: scheduler skips job creation on a holiday — **met** (Labor Day 2026-09-07)
- [x] Test: scheduler skips job creation on a weekend — **met** (Saturday 2026-01-03, Sunday 2026-01-04)
- [x] Test: scheduler skips job creation on post-early-close tick — **met** (2026-11-27 at 1200 PT)
- [x] Test: scheduler creates jobs on a normal trading day — **met** (0800, 1000, 1200 PT)
- [x] Test: scheduler does not write a run doc when skipping — **met** (asserts `mockDocSet` not called)
- [x] Test: scheduler force-completes a stale IN_PROGRESS run before creating new jobs — **met** (asserts transaction called, staleRun: true, new jobs still created)
- [x] Test: force-completed run gets `staleRun: true` flag — **met** (asserts `mockDocUpdate` called with `staleRun: true, status: 'COMPLETE'`)
- [x] Test: force-completed run publishes PDR with `runStatus: FAILED` — **met** (asserts `mockPublishIntradayPdr` called with `runStatusOverride: 'failed'`)
- [x] Test: no force-completion when no stale run exists — **met** (asserts no transaction, no PDR, no update)
- [x] All tests pass — **met** (12/12)

Test plan coverage from the BE test plan:
- Scheduler skips job creation on a holiday — **met**
- Scheduler skips job creation on a weekend — **met**
- Scheduler skips job creation on an early-close day at 1200 PT — **met**
- Scheduler creates jobs on a normal trading day at 0800, 1000, 1200 PT — **met**
- Scheduler does not write a run doc when skipping — **met**
- Scheduler force-completes a stale IN_PROGRESS run — **met**
- Force-completed run gets `staleRun: true` flag — **met**
- Force-completed run publishes PDR with `runStatus: FAILED` — **met**
- Scheduler proceeds with new tick after force-completion — **met** (asserts new jobs created)
- No force-completion when no stale run exists — **met**

No Spec findings.

## Thermo-nuclear

- Abstraction quality: N/A (test file).
- File size: fine.
- Spaghetti detection: no spaghetti. Mocks are at the right level — module boundaries, not internal implementation details.
- Code judo: the integration tests test the scheduler's observable effects (run doc writes, batch commits, task enqueues, PDR calls, transaction calls) rather than internal function calls. This is the highest seam possible — the test verifies what the scheduler *does*, not how it does it.
- Mock quality: Firestore, Cloud Tasks, and PDR publishing are mocked at the module level. The calendar gate uses real static data (no mocking needed), which means the integration tests exercise the real calendar logic end-to-end.
- Edge cases: holiday, weekend (both days), post-early-close, normal trading day (all three ticks), stale run force-completion, no stale run — all covered.
- Test isolation: `resetMocks()` in `beforeEach` ensures each test starts clean. `setupNoStaleRuns()` in `beforeEach` ensures the self-healing path doesn't interfere with skip/create tests.

No Thermo-nuclear findings.

## Test results

- Integration tests: 12/12 passed
- Build: PASS

## Verdict: PASS

No critical, major, or minor findings. All acceptance criteria met. Tests pass and build passes. The integration tests verify the scheduler's observable effects at the right seam.
