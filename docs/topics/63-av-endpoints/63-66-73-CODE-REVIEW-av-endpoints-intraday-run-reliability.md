**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #66  
**Task:** #73  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

## Summary

Task #73 adds self-healing for stale intraday runs. Before creating jobs for a new tick, the scheduler queries `intraday-runs` for any IN_PROGRESS runs from a previous tick on the same market date. Each stale run is force-completed in a Firestore transaction (setting `staleRun: true`), and a PDR with `runStatus: FAILED` is published. The transaction guard prevents double-completion if a late job callback already completed the run. 4 unit tests cover the self-healing logic.

## Standards

- File size: `intraday-self-healing.ts` is 105 lines, `intraday-snapshot-jobs.aggregator.ts` is 440 lines — both within limits.
- Single responsibility: the self-healing module has one job — find and force-complete stale runs. The scheduler delegates to it cleanly.
- No duplication: PDR publishing is reused via the exported `publishIntradayPdr` with a `runStatusOverride` parameter. No PDR logic was duplicated.
- No dead code: the `runStatusOverride` parameter defaults to `undefined`, preserving existing behavior for the normal completion path.
- Consistent patterns: the self-healing module follows the same pattern as the calendar gate — a testable helper extracted from the scheduler.
- Clean type contracts: `ForceCompletedRun` is a minimal interface. `runStatusOverride` is optional on `publishIntradayPdr`.
- Security defaults: N/A.

No Standards findings.

## Spec

Acceptance criteria from task #73:

- [x] Scheduler checks for stale IN_PROGRESS runs on the same market date before creating new jobs — **met** (queries `intraday-runs` where `marketDate == X` and `status == IN_PROGRESS`)
- [x] Stale run is force-completed with `staleRun: true` flag — **met** (transaction sets `status=COMPLETE`, `staleRun=true`, `runFinishedAt=now`)
- [x] Stale run publishes a PDR with `runStatus: FAILED` — **met** (calls `publishIntradayPdr` with `runStatusOverride: PartnerRunStatus.FAILED`)
- [x] Transaction prevents double-completion if a late job callback arrives during force-completion — **met** (transaction checks `status === COMPLETE` before updating; if already complete, skips and doesn't publish PDR)
- [x] Scheduler proceeds with new tick after force-completion — **met** (self-healing runs before job creation; new run doc and jobs are created normally after)
- [x] No force-completion when no stale run exists — **met** (returns empty array, no PDR published)
- [x] Multiple stale runs on the same market date are all force-completed — **met** (iterates over all stale docs)
- [x] Build passes — **met**

Test plan coverage:
- Scheduler force-completes a stale IN_PROGRESS run before creating new jobs — **met**
- Force-completed run gets `staleRun: true` flag — **met**
- Force-completed run publishes a PDR with `runStatus: FAILED` — **met**
- Scheduler proceeds with new tick after force-completion — **met**
- No force-completion when no stale run exists — **met**

No Spec findings.

## Thermo-nuclear

- Abstraction quality: good. The self-healing module is a deep module — it hides the Firestore query, transaction logic, and PDR publishing behind a single function returning a list of force-completed runs. The scheduler doesn't need to know the details.
- File size: fine.
- Spaghetti detection: no spaghetti. The self-healing module is called once between the calendar gate and job creation. Clean seam.
- Code judo: reusing `publishIntradayPdr` with a `runStatusOverride` parameter is the right move. It avoids duplicating the PDR publishing logic while allowing the self-healing path to signal `FAILED` instead of `COMPLETED`/`COMPLETED_WITH_ERRORS`.
- Transaction safety: the transaction reads the run doc and checks `status === COMPLETE` before updating. This correctly handles the race condition where a late job callback completes the run between the query and the transaction. The `didComplete` flag ensures PDR is only published when the transaction actually completed the run.
- Error handling: PDR publish failures are logged but don't block the scheduler. This is the right trade-off — the run is already force-completed in Firestore, and blocking on PDR publish would prevent the new tick from proceeding.
- Test quality: tests verify external behavior (query → force-complete → PDR publish). Mocks are at the right level (Firestore db and `publishIntradayPdr`). The transaction guard test correctly simulates the race condition.
- Edge cases: no stale runs, single stale run, multiple stale runs, already-complete race condition all covered.

No Thermo-nuclear findings.

## Test results

- Unit tests: 4/4 passed
- Build: PASS

## Verdict: PASS

No critical, major, or minor findings. All acceptance criteria met. Build and tests pass. The self-healing module is well-abstracted, transaction-safe, and reuses the PDR publishing path cleanly.
