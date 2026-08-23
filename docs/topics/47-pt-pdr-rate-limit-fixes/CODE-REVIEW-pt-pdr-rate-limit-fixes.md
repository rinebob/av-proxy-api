**Topic:** Update PDR message, migrate to PT timezone and consolidate schedules
**Issue:** #51 (Task)
**Topic Parent:** #47
**Domain:** AV-ENDPOINTS
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

# Code Review: Task #51 — PT timezone migration, PDR fix, and rate limit tuning

## Summary

Retrospective review of code changes already in the working tree. Three fix areas reviewed: timezone migration + scheduler consolidation, duplicate PDR fix, and rate limit tuning.

All 14 acceptance criteria are MET.

## Findings by severity

### Critical (0)

None.

### Major (0)

None.

### Minor (1)

**MINOR-1: `partner-symbols-ready` Pub/Sub topic cleanup is manual**
- **File:** `functions/src/v2/partner/symbols-ready.publisher.ts`
- **Issue:** The publisher is documented as unused, but the GCP Pub/Sub topic and any subscriptions must be manually deleted. There's no automated cleanup.
- **Status:** Deferred — manual GCP cleanup task, not a code issue.

### Nit (1)

**NIT-1: `clockEt` comment in RunIdFactory says "Required PT time"**
- **File:** `functions/src/v2/alpha-vantage/jobs/runid-factory.ts` (line 23)
- **Issue:** The field was renamed to `clockPt` but the original comment already said "Required PT time" (it was wrong before the rename). Now it's correct.
- **Status:** No action needed — comment is now correct after the rename.

## Acceptance criteria verification

- [x] All `onSchedule` registrations use `timeZone: 'America/Los_Angeles'`
- [x] `clockEt` renamed to `clockPt` in RunIdFactory and all callers
- [x] Cron times updated to PT equivalents
- [x] 6 deprecated no-op schedulers removed
- [x] 5 deprecated schedule constants removed
- [x] Exports updated in index.ts and v2/alpha-vantage/index.ts
- [x] `createdJobs` increment moved inside Firestore transaction
- [x] Run completion wrapped in transaction with `didComplete` flag in realtime-run-aggregator (both paths)
- [x] Same atomic completion claim in intraday-snapshot-jobs.aggregator
- [x] Per-symbol `publishSymbolsReadyBatch` calls removed from worker
- [x] Redundant `runStartedAt` stamping removed from worker
- [x] `symbols-ready.publisher.ts` documents unused status
- [x] `JOB_EXECUTION_DELAY_MS` set to 0
- [x] `maxDispatchesPerSecond` set to 1.2 in job-config.ts and intraday-snapshot-jobs.task.ts

## Verdict: PASS

All acceptance criteria met. No critical or major findings. One minor (manual GCP cleanup) deferred. Code is ready to ship.
