**Topic:** Update PDR message, migrate to PT timezone and consolidate schedules
**Issue:** #49 (Plan)
**Topic Parent:** #47
**Domain:** AV-ENDPOINTS
**Type:** IMPL
**Status:** Complete
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

# IMPL: PT Timezone Migration, PDR Fix, and Rate Limit Tuning

## Areas

Single area: **BE** — all changes are in backend Cloud Functions (schedulers, refresh managers, jobs, aggregators, worker, publisher). No SHARED or FE changes.

## Components affected

### 1. Timezone migration + scheduler consolidation (REFACTOR)

**Files:**
- `functions/src/v2/common/function-schedules.ts` — remove 5 deprecated constants, update cron times ET→PT
- `functions/src/v2/alpha-vantage/data-refresher/av-time-series-refresh-manager.ts` — rename clockEt→clockPt, change timeZone, remove 6 deprecated no-op schedulers, atomic createdJobs increment
- `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager.ts` — remove deprecated refreshAvIntradayRthClose1615Pre, update comments
- `functions/src/v2/alpha-vantage/jobs/runid-factory.ts` — rename clockEt→clockPt in interface, factory, validator, parser
- `functions/src/v2/alpha-vantage/index.ts` — update exports
- `functions/src/index.ts` — update exports
- `functions/scripts/pipeline/infer-trigger-for-logs.ts` — remove TS_DAILY_PRE_CLOSE_SCHEDULE references

### 2. Duplicate PDR fix (BUGFIX)

**Files:**
- `functions/src/v2/alpha-vantage/jobs/realtime-run-aggregator.ts` — atomic completion claim with didComplete flag
- `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.aggregator.ts` — same pattern
- `functions/src/v2/alpha-vantage/jobs/time-series-jobs.worker.ts` — remove per-symbol publishSymbolsReadyBatch, remove redundant runStartedAt stamping
- `functions/src/v2/partner/symbols-ready.publisher.ts` — add unused note

### 3. Rate limit tuning (CHORE)

**Files:**
- `functions/src/v2/alpha-vantage/jobs/job-config.ts` — JOB_EXECUTION_DELAY_MS 1000→0, maxDispatchesPerSecond 1.0→1.2
- `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.task.ts` — maxDispatchesPerSecond 1.0→1.2

## Technical approach

### Timezone migration
Rename `clockEt` to `clockPt` throughout the RunIdFactory and all callers. Change `timeZone` on all `onSchedule` registrations from `America/New_York` to `America/Los_Angeles`. Update cron expressions to PT equivalents. Remove deprecated no-op schedulers and their constants. The runId format stays the same (YYYY-MM-DD-DOW-SEQ-INTERVAL-LIVE|MANUAL-PHASE-HHMM) — only the clock label values change.

### Duplicate PDR fix
Wrap the run completion update in a Firestore transaction. Read the run doc inside the transaction, check if status is already COMPLETE, and only set COMPLETE + publish PDR if it isn't. This ensures exactly one worker wins the race. Applied to both the realtime-run-aggregator and intraday-snapshot-jobs.aggregator, in both the fast path and reconcile path.

### Rate limit tuning
Set `JOB_EXECUTION_DELAY_MS` to 0 (the Cloud Tasks rate limiter already controls throughput). Increase `maxDispatchesPerSecond` from 1.0 to 1.2 (72/min, under AV's 75 req/min cap).

## Risks

- **Run ID format change:** Existing run docs in Firestore use `clockEt` in their IDs. New runs will use `clockPt`. This is a clean break — old runs age out and new runs use the new format. No migration needed.
- **GCP cleanup:** Deprecated Cloud Scheduler jobs and the `partner-symbols-ready` Pub/Sub topic should be manually deleted from GCP.
