**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #66  
**Task:** #76  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-10  
**Last Updated:** 2026-09-10  

## Summary

Task #76 requires unit tests for the `intradayPdrWatchdog` function. During Task #74 implementation, 8 unit tests were written in `functions/tests/v2/alpha-vantage/intraday-watchdog/intraday-pdr-watchdog.test.ts` that cover all of Task #76's acceptance criteria. The only change for Task #76 was updating the `describe` block label from `'Task #74: ...'` to `'Task #74/#76: ...'` to reflect that the tests fulfill both tasks.

## Standards

- Test file follows existing patterns: jest.mock at module level, direct import after mocks, `describe`/`it` blocks.
- Helper functions (`setupTrackedSymbols`, `resetMocks`, `docPath`, `setData`) reduce boilerplate without hiding test intent.
- No dead code: all mocks are used.
- The `describe` block label now references both Task #74 and #76, accurately reflecting the test coverage scope.

No Standards findings.

## Spec

Acceptance criteria from task #76:

- [x] Test: watchdog is silent when run doc exists and `partnerDataReady.messageSent === true` — **met** by "is silent when run doc exists and partnerDataReady.messageSent === true"
- [x] Test: watchdog alerts when run doc exists but `partnerDataReady.messageSent !== true` — **met** by "logs ERROR when run doc exists but partnerDataReady.messageSent !== true"
- [x] Test: watchdog alerts when run doc does not exist — **met** by "logs ERROR when run doc does not exist (scheduler did not fire)"
- [x] Test: watchdog writes health doc with runId, clockPt, marketDate, and alert state — **met** by "health doc contains tick status, PDR state, and alert state" (asserts `marketDate`, `clockPt`, `runId`, `tickStatus`, `pdrState`, `alertState`, `checkedAt`)
- [x] All tests pass — **met** (8/8)

No Spec findings.

## Thermo-nuclear

- The tests were written during Task #74 implementation as part of the TDD workflow. Task #76 was planned as a separate task to ensure test coverage, but the tests were written alongside the implementation. This is the correct TDD approach — tests should be written with the implementation, not deferred.
- The `describe` block label update from `'Task #74'` to `'Task #74/#76'` is a minimal, accurate change that reflects the dual purpose of the tests.
- No new code was needed for Task #76 — the tests already existed and passed.
- Test quality: tests mock Firestore at the module level, use real calendar data (no mocking), and verify both alert behavior and health doc structure.

No Thermo-nuclear findings.

## Test results

- Unit tests: 8/8 passed
- Build: PASS

## Verdict: PASS

No critical, major, minor, or nit findings. All acceptance criteria met by existing tests written during Task #74. The `describe` block label was updated to reference both tasks. Tests pass and build passes.
