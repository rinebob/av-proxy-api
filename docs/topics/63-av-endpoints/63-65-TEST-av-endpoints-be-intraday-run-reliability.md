**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #65  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

## Area: BE

## Integration test targets

### Calendar gate (scheduler)

Prior art: none (no existing scheduler tests — this is new coverage)

- Scheduler skips job creation on a holiday (e.g. 2026-09-07 Labor Day)
- Scheduler skips job creation on a weekend
- Scheduler skips job creation on an early-close day at 1200 PT (post-close tick)
- Scheduler creates jobs on a normal trading day at 0800, 1000, 1200 PT
- Scheduler does not write a run doc when skipping
- Scheduler logs the skip reason (holiday, weekend, post-early-close)

### Self-healing (scheduler)

- Scheduler force-completes a stale IN_PROGRESS run before creating new jobs
- Force-completed run gets `staleRun: true` flag
- Force-completed run publishes a PDR with `runStatus: FAILED`
- Scheduler proceeds with new tick after force-completion
- No force-completion when no stale run exists

### Alerting watchdog

- Watchdog is silent when run doc exists and `partnerDataReady.messageSent === true`
- Watchdog alerts when run doc exists but `partnerDataReady.messageSent !== true`
- Watchdog alerts when run doc does not exist (scheduler didn't fire)
- Watchdog writes a health doc to Firestore with tick status
- Watchdog health doc includes runId, clockPt, marketDate, and alert state

### PartnerRunStatus extension

- `PartnerRunStatus.FAILED` is a valid enum value
- PDR payload with `runStatus: FAILED` is accepted by `validateDataReadyPayload`

## Test seams

- Scheduler tests: mock Firestore (run doc reads/writes, job doc creation) and Cloud Tasks enqueue. Verify the decision (create vs. skip) and the side effects (run doc state, PDR publication).
- Watchdog tests: mock Firestore run doc reads. Verify alert behavior (log at ERROR level, health doc write).
- Use the highest seam possible: test the scheduler function's observable effects, not internal function calls.

## Edge cases

- Stale run force-completion race: a late job terminal callback arrives during force-completion. Transaction should prevent double-completion.
- Watchdog fires but the run is still IN_PROGRESS (not yet complete, not stale). Should the watchdog alert, or only alert when the run doc is missing/complete-without-PDR? Define the threshold.
- Manual invocation of `runIntradaySnapshotJobsForSymbols` on a holiday — should be blocked by the same calendar gate.
- Multiple stale runs from different ticks on the same market date — force-complete all, not just the most recent.
