# Intraday Snapshot Pipeline – Implementation Plan

> **Scope:** Replace the existing ad-hoc PRE-phase snapshot writes with a first-class, Cloud-Tasks-backed intraday snapshot pipeline that mirrors the architecture of the POST end-of-day pipeline. No new financial data types; this is a scheduling and job-dispatch upgrade.

---

## Background & Goal

The intraday snapshot (`ip / io / it / ic / ipc` fields on a daily `CompactBar`) is the **live stand-in for the current trading day's bar** during market hours. It allows the indicator engine to append an estimated "today" bar to the historical D/W/M series so signals can be generated and trades placed before the POST-close finalized bar arrives — without waiting until the next day.

The snapshot source is the Alpha Vantage `TIME_SERIES_INTRADAY` endpoint (1-min delayed data). The specific 1-min interval is incidental — we only need the most recent bar's close price and timestamp to populate the snapshot fields. We are **not** doing intraday trading; this exists solely to avoid a same-day stale gap in the D/W/M series.

---

## Current State

### What works today
- `upsertAvDailyIntradaySnapshot()` in `av-firestore-helper.ts` correctly locates or creates the day bar in the DAILY_ADJUSTED year shard and patches `ip / io / it / ic / ipc`.
- `AvIntradayHandler` in `av-intraday.handler.ts` can fetch 1-min data for a given symbol. It works; its `transformResponse` returns raw payload (intentional for its current use).
- `refreshAvIntradayRthClose1615Pre` in `av-refresh-manager.ts` runs at 16:15 ET, iterates all symbols serially, and writes via `upsertAvDailyBar`. **It does scale to 760 symbols** because it runs sequentially in a single function invocation, but it will hit Cloud Function timeout walls as the universe grows and has no retry or observability.

### What does not work
- `refreshAvDailyTimeSeriesIntradayHourly` and `refreshAvDailyTimeSeriesPreClose` in `av-time-series-refresh-manager.ts` both call `runTimeSeriesJobsForEndpoint` with `TradingPhase.PRE`. That function **hard-gates on POST phase and immediately returns** — these schedulers are complete no-ops.
- There is no Cloud Tasks dispatch for PRE / intraday snapshot jobs. No `intraday-runs` run documents, no per-symbol job tracking, no retry pipeline.

### Root cause
The POST job pipeline (`processTimeSeriesJobInternal`) only supports `TIME_SERIES_DAILY_ADJUSTED / WEEKLY_ADJUSTED / MONTHLY_ADJUSTED` at `TradingPhase.POST`. It does not support `TIME_SERIES_INTRADAY` or PRE phase. Plugging the snapshot into the existing worker would require adding conditional branches that conflate period-end freshness semantics (irrelevant for a snapshot) with snapshot-write semantics. A purpose-built sibling worker is the right approach.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Reuse existing Cloud Task queue (`processTimeSeriesJobTask`)? | **No — new queue** | Keeps rate-limit tuning independent. Intraday jobs are faster (no shard writes, no freshness check); a separate queue avoids head-of-line blocking on the POST pipeline. |
| Snapshot interval (1min / 5min / 15min)? | **1min only** | Granularity is irrelevant for a daily bar stand-in. Simpler config, fewer API params. |
| Remove 3:30pm PRE schedule? | **Yes** | Too close to 4pm close; the 3pm capture is sufficient. |
| Remove 16:15 RTH close function? | **Yes** | Superseded by the job pipeline. The serial loop approach does not scale. |
| Remove `refreshAvDailyTimeSeriesPreClose`? | **Yes** | Currently a no-op. Remove to reduce confusion. |
| Intraday run tracking collection? | **`intraday-runs/{runId}/jobs/{symbol}`** | Mirrors `realtime-runs` layout; gives the same observability surface. |
| Schedule cadence? | **8am, 10am, 12pm ET Mon–Fri** | 3 captures/day. Reduced from 6 to limit update volume. Cron: `0 8,10,12 * * 1-5`. |
| Rate limit? | **1.0 dispatch/sec** | Matches POST pipeline. At 760 symbols, drains in ~13 min, well within the hourly window. Can be tuned to 1.5/sec if needed. |

---

## Architecture Overview

```
Cloud Scheduler (0 8,10,12 * * 1-5, ET)
  └─ refreshAvDailyTimeSeriesIntradayHourly (onSchedule)
       └─ runIntradaySnapshotJobsForSymbols()
            ├─ reads tracked-symbols
            ├─ creates intraday-runs/{runId} doc
            ├─ creates intraday-runs/{runId}/jobs/{symbol} docs
            └─ enqueues Cloud Task per symbol
                    │
                    ▼
         Cloud Task Queue: processIntradaySnapshotJobTask
                    │
                    ▼
         processIntradaySnapshotJobTask (onTaskDispatched)
                    │
                    ▼
         processIntradaySnapshotJobInternal()
            ├─ AvIntradayHandler.fetch({ symbol, interval: '1min' })
            ├─ pick latest bar for today's ET date
            ├─ upsertAvDailyIntradaySnapshot()
            └─ update job doc (SUCCESS / TRANSIENT_FAILURE / PERMANENT_FAILURE)
                    │
                    ▼
         IntradayRunAggregator
            └─ increments finishedJobs / successJobs / permanentFailureJobs
            └─ marks intraday-runs/{runId} COMPLETE when all jobs done
            └─ enqueueDataReadyInternal (PartnerRunType.TS_DAILY_PRE)
```

---

## Firestore Schema

### Run document
**Path:** `intraday-runs/{runId}`

```
runId:                string       // e.g. "2026-06-15-MON-INTRADAY-LIVE-1000"
marketDate:           string       // YYYY-MM-DD ET trading date
phase:                'pre'
interval:             'intraday'
trigger:              RefreshTrigger
status:               'IN_PROGRESS' | 'COMPLETE' | 'COMPLETE_WITH_ERRORS'
runCreatedAt:         Timestamp
runStartedAt:         Timestamp
createdJobs:          number
finishedJobs:         number
successJobs:          number
permanentFailureJobs: number
clockEt:              string       // HHMM — which hourly tick triggered this run
```

### Job document
**Path:** `intraday-runs/{runId}/jobs/{symbol}`

```
symbol:           string
marketDate:       string
status:           TimeSeriesJobStatus   // reuse existing enum
attempts:         number
createdAt:        Timestamp
updatedAt:        Timestamp
lastAttemptAt:    Timestamp
firstAttemptedAt: Timestamp
lastError:        string | undefined
```

---

## Implementation Checklist

### Step 1 – New worker (`intraday-snapshot-jobs.worker.ts`)

**File:** `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.worker.ts`

- [ ] Define `IntradaySnapshotJobPayload` interface: `{ marketDate, symbol, runId, clockEt }`
- [ ] Implement `processIntradaySnapshotJobInternal(payload)`:
  - Gate on `TS_TIME_SERIES_TASKS_ENABLED` env flag (same safety guard as POST worker)
  - Load job doc from `intraday-runs/{runId}/jobs/{symbol}`; no-op if terminal
  - Mark `IN_PROGRESS`, bump `attempts`, stamp `lastAttemptAt` / `firstAttemptedAt`
  - Call `AvIntradayHandler.fetch({ symbol, interval: '1min' })`
  - Parse `Time Series (1min)` from raw response
  - Filter entries to today's ET date; sort descending; pick index 0
  - Guard: if no bar found for today, throw retryable error
  - Call `upsertAvDailyIntradaySnapshot({ symbol, date, ip, io, dow })`
  - On success: set job status `SUCCESS`, call `onIntradayRunJobTerminal(runId, symbol, SUCCESS)`
  - On error: increment attempts; if `>= MAX_JOB_ATTEMPTS`, set `PERMANENT_FAILURE` and call aggregator; otherwise set `TRANSIENT_FAILURE` and rethrow (Cloud Tasks retries)
- [ ] Reuse `MAX_JOB_ATTEMPTS` and `JOB_EXECUTION_DELAY_MS` from `job-config.ts`

---

### Step 2 – New run aggregator (`intraday-snapshot-jobs.aggregator.ts`)

**File:** `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.aggregator.ts`

- [ ] Implement `onIntradayRunJobTerminal({ runId, symbol, status })`:
  - Inside a transaction: increment `finishedJobs` and the appropriate counter (`successJobs` / `permanentFailureJobs`) on the run doc
  - After the transaction, re-read the run doc and check completion via **two paths** (mirrors `realtime-run-aggregator.ts`):
    - **Fast path:** `finishedJobs === createdJobs` → mark run `COMPLETE`, publish PDR immediately
    - **Reconcile path:** `finishedJobs > 0` AND run age exceeds `INTRADAY_MAX_RUN_DURATION_MS` (20 min) AND run is still not `COMPLETE` → re-scan all job docs in the subcollection, count terminal states directly, force-complete, then publish PDR. This handles lagging Cloud Tasks retries where the `=== createdJobs` equality is never hit. **Do not reuse `MAX_RUN_DURATION_MS` (60 min) — that is the POST pipeline window.**
  - On completion (either path): call `enqueueDataReadyInternal` with `PartnerRunType.TS_DAILY_PRE`
  - **Fire after every run** — consumers receive up to 3 PRE notifications per trading day (8am, 10am, 12pm ticks) and decide how often to act on them. Include `clockEt` in the message payload so consumers can identify which tick completed.
- [ ] Add `jobsCreationStartedAt` timestamp to the run doc (set by the scheduler runner) so the reconcile path can compute the age window correctly — same pattern as `realtime-runs`

---

### Step 3 – New Cloud Task handler (`intraday-snapshot-jobs.task.ts`)

**File:** `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.task.ts`

- [ ] Export `processIntradaySnapshotJobTask` via `onTaskDispatched<IntradaySnapshotJobPayload>`
- [ ] Use same `retryConfig` and `memory` as `processTimeSeriesJobTask` (from `job-config.ts`)
- [ ] Rate limits: `maxDispatchesPerSecond: 1.0`, `maxConcurrentDispatches: 20` (same as POST — tunable later)
- [ ] Delegate to `processIntradaySnapshotJobInternal`

---

### Step 4 – Scheduler runner function (`av-time-series-refresh-manager.ts`)

- [ ] Add `runIntradaySnapshotJobsForSymbols(options)` function:
  - Reads `tracked-symbols`
  - Derives `marketDate`, `dow`, `clockEt` (HHMM ET) from current time
  - Builds `runId`: `${marketDate}-${dow}-INTRADAY-LIVE-${clockEt}`
  - Creates `intraday-runs/{runId}` doc with initial counters
  - For each symbol: creates job doc + enqueues to `CloudTask.INTRADAY_SNAPSHOT_JOB`
  - Batches using `TS_SCHEDULER_BATCH_SIZE` (same as POST)
  - Weekend guard: skip if `dow` is SAT or SUN
- [ ] Fix `refreshAvDailyTimeSeriesIntradayHourly`: replace no-op `runTimeSeriesJobsForEndpoint` call with `runIntradaySnapshotJobsForSymbols()`
- [ ] Remove `refreshAvDailyTimeSeriesPreClose` export and function body (no-op, confusing)

---

### Step 5 – Constants and config

**File:** `functions/src/v2/common/constants.ts`
- [ ] Add `INTRADAY_SNAPSHOT_JOB = 'processIntradaySnapshotJobTask'` to `CloudTask` enum

**File:** `functions/src/v2/alpha-vantage/jobs/job-config.ts`
- [ ] Add `INTRADAY_MAX_RUN_DURATION_MS = 20 * 60 * 1000` (20 minutes) — intraday-specific reconcile window, separate from the shared `MAX_RUN_DURATION_MS` (60 min) used by the POST pipeline

---

### Step 6 – `index.ts` wiring

**File:** `functions/src/index.ts`
- [ ] Export `processIntradaySnapshotJobTask` from `intraday-snapshot-jobs.task`
- [ ] Remove export of `refreshAvDailyTimeSeriesPreClose` (no-op, being deleted)
- [ ] Remove export of `refreshAvIntradayRthClose1615Pre` (superseded)
- [ ] Keep export of `refreshAvDailyTimeSeriesIntradayHourly` (now correctly wired)

---

### Step 7 – Cleanup in `av-refresh-manager.ts`
- [ ] Remove or stub out `refreshAvIntradayRthClose1615Pre` (leave a deprecation comment referencing the new pipeline)
- [ ] Remove `TS_INTRADAY_RTH_CLOSE_1615` schedule reference if no longer used

---

### Step 8 – Schedule constants (`function-schedules.ts`)
- [ ] Remove `TS_DAILY_PRE_CLOSE_SCHEDULE` if no longer referenced
- [ ] Keep `TS_DAILY_INTRADAY_HOURLY_SCHEDULE` (`0 8,10,12 * * 1-5`)

---

## Files Changed Summary

| File | Change Type | Notes |
|---|---|---|
| `jobs/intraday-snapshot-jobs.worker.ts` | **New** | Core snapshot job worker |
| `jobs/intraday-snapshot-jobs.aggregator.ts` | **New** | Run completion aggregator |
| `jobs/intraday-snapshot-jobs.task.ts` | **New** | `onTaskDispatched` Cloud Task wrapper |
| `common/constants.ts` | **Modify** | Add `INTRADAY_SNAPSHOT_JOB` to `CloudTask` enum |
| `data-refresher/av-time-series-refresh-manager.ts` | **Modify** | Add `runIntradaySnapshotJobsForSymbols()`, fix hourly scheduler, remove pre-close no-op |
| `data-refresher/av-refresh-manager.ts` | **Modify** | Remove / deprecate `refreshAvIntradayRthClose1615Pre` |
| `functions/src/index.ts` | **Modify** | Wire new task export, remove deprecated exports |
| `common/function-schedules.ts` | **Modify** | Remove `TS_DAILY_PRE_CLOSE_SCHEDULE` if unused |

**Unchanged:** `av-intraday.handler.ts`, `av-firestore-helper.ts` (`upsertAvDailyIntradaySnapshot`), `CompactBar` type, `DayOfWeek` enum, all POST pipeline files.

---

## Resolved Decisions

1. ✅ **Partner data-ready notification:** Fire `TS_DAILY_PRE` after **every** hourly run. Include `clockEt` in the payload so consumers can filter by tick if needed.
2. ✅ **RTH close gap (3pm → POST):** The gap between the last 3pm snapshot and the finalized POST DAILY_ADJUSTED bar is acceptable. No separate 4:15pm run needed.
3. ✅ **Rate limit tuning:** 1.0 dispatch/sec is correct for now. Revisit if symbol universe exceeds ~900.
4. ✅ **Aggregator completion strategy:** Use the same dual-path pattern as `realtime-run-aggregator.ts` — fast path (`finishedJobs === createdJobs`) plus a reconcile path that re-scans job docs when the run exceeds `INTRADAY_MAX_RUN_DURATION_MS` (20 min) without completing. **20 min, not 60** — at 1.0/sec drain takes ~13 min so 20 min gives adequate buffer without an hour wait.
5. ✅ **Health metrics:** Not needed for intraday snapshot jobs. Run-level tracking in `intraday-runs` is sufficient.
