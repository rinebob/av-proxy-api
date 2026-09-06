# Time-Series POST Pipeline Monitoring Guide

This document describes every stage of the time-series POST pipeline, the logs emitted at each stage, and the Logs Explorer queries to detect and diagnose failures.

## Table of Contents

- [Pipeline Overview](#pipeline-overview)
- [Run ID Format](#run-id-format)
- [Cloud Run Services](#cloud-run-services)
- [Log Tag Reference](#log-tag-reference)
- [Stage 1: Orchestrator Start](#stage-1-orchestrator-start)
- [Stage 2: Run Document Initialization](#stage-2-run-document-initialization)
- [Stage 3: Job Creation (per symbol)](#stage-3-job-creation-per-symbol)
- [Stage 4: Job Creation Completion](#stage-4-job-creation-completion)
- [Stage 5: Worker Execution](#stage-5-worker-execution)
- [Stage 6: Run Aggregation](#stage-6-run-aggregation)
- [Stage 7: PDR Publish](#stage-7-pdr-publish)
- [Stage 8: Run Document Cleanup](#stage-8-run-document-cleanup)
- [End-to-End Verification Queries](#end-to-end-verification-queries)
- [Failure Mode Quick Reference](#failure-mode-quick-reference)

---

## Pipeline Overview

The POST pipeline runs three scheduled passes per trading day (Mon-Fri), each processing MONTHLY, WEEKLY, and DAILY intervals sequentially:

| Sequence | Schedule (PT) | UTC (Sep) | Function | clockPt | Description |
|----------|--------------|-----------|----------|---------|-------------|
| A | `35 13 * * 1-5` (1:35 PM) | ~20:35 | `refreshAvTimeSeriesPostAllIntervals` | `1335` | Initial full-universe run |
| B | `0 18 * * 1-5` (6:00 PM) | ~01:00+1d | `refreshAvDailyTimeSeriesPostEveningRetry00` | `1800` | Retry pass (retry symbols from A) |
| C | `0 4 * * 1-5` (4:00 AM) | ~11:00 | `refreshAvDailyTimeSeriesPostMorning0700` | `0400` | Final pre-open reconciliation |

Each pass creates three per-interval realtime runs (MONTHLY, WEEKLY, DAILY), enqueues Cloud Tasks for each symbol, and emits a Partner Data Ready (PDR) message when all jobs for an interval complete.

### Execution Flow

```
onSchedule (A/B/C)
  └─ runAllTimeSeriesIntervalsPost
       ├─ 1. Log run_start
       ├─ 2. Initialize 3 realtime-runs docs (MONTHLY, WEEKLY, DAILY)
       ├─ 3. MONTHLY: createRealtimeRunJobAndEnqueueTask × ~864 symbols
       │      ├─ Firestore tx (jobRef only) → create job doc
       │      ├─ Non-tx increment createdJobs on runRef
       │      └─ Enqueue Cloud Task
       ├─ 4. WEEKLY: same as above
       ├─ 5. DAILY: same as above
       │
       └─ [Cloud Tasks execute asynchronously]
            └─ processTimeSeriesJobTask (per symbol)
                 ├─ 6. Worker fetches AV data, writes to Firestore
                 ├─ 7. Worker calls onRealtimeRunJobTerminal
                 │      ├─ Increment finishedJobs/successJobs
                 │      ├─ If finished === created AND jobsCreationCompletedAt set:
                 │      │    ├─ Mark run COMPLETE
                 │      │    └─ 8. enqueueDataReadyInternal → publish PDR to Pub/Sub
                 │      └─ If past MAX_RUN_DURATION_MS (60min):
                 │           ├─ reconcileRunJobs (force-complete)
                 │           └─ 8. enqueueDataReadyInternal → publish PDR
                 └─ 9. Nightly cleanup deletes run docs older than 2 days
```

---

## Run ID Format

All realtime POST run IDs follow this format:

```
YYYY-MM-DD-DOW-SEQUENCE-INTERVAL-LIVE|MANUAL-PHASE-HHMM
```

**Examples for market date 2026-09-01 (Tuesday), A-run:**

| Interval | runId |
|----------|-------|
| MONTHLY | `2026-09-01-TUE-A-MONTHLY-LIVE-POST-1335` |
| WEEKLY | `2026-09-01-TUE-A-WEEKLY-LIVE-POST-1335` |
| DAILY | `2026-09-01-TUE-A-DAILY-LIVE-POST-1335` |

**B-run examples:**

| Interval | runId |
|----------|-------|
| MONTHLY | `2026-09-01-TUE-B-MONTHLY-LIVE-POST-1800` |
| WEEKLY | `2026-09-01-TUE-B-WEEKLY-LIVE-POST-1800` |
| DAILY | `2026-09-01-TUE-B-DAILY-LIVE-POST-1800` |

**C-run examples:**

| Interval | runId |
|----------|-------|
| MONTHLY | `2026-09-01-TUE-C-MONTHLY-LIVE-POST-0400` |
| WEEKLY | `2026-09-01-TUE-C-WEEKLY-LIVE-POST-0400` |
| DAILY | `2026-09-01-TUE-C-DAILY-LIVE-POST-0400` |

### Run ID Component Reference

| Component | Source | Values |
|-----------|--------|--------|
| `YYYY-MM-DD` | ET market date | e.g. `2026-09-01` |
| `DOW` | Day of week from market date | `MON`, `TUE`, `WED`, `THU`, `FRI` |
| `SEQUENCE` | Pass identifier | `A` (initial), `B` (evening retry), `C` (morning catch-up) |
| `INTERVAL` | Time-series interval | `MONTHLY`, `WEEKLY`, `DAILY` |
| `LIVE\|MANUAL` | Run type | `LIVE` (scheduled), `MANUAL` (emulator/manual) |
| `PHASE` | Trading phase | `POST` (post-close) |
| `HHMM` | PT clock label | `1335` (A), `1800` (B), `0400` (C) |

---

## Cloud Run Services

Logs are scoped by `resource.labels.service_name`. The pipeline involves three services:

| Service Name | Role | Cloud Function |
|-------------|------|----------------|
| `refreshavtimeseriespostallintervals` | Orchestrator (A-run) | `refreshAvTimeSeriesPostAllIntervals` |
| `refreshavdailytimeseriesposteveningretry00` | Orchestrator (B-run) | `refreshAvDailyTimeSeriesPostEveningRetry00` |
| `refreshavdailytimeseriespostmorning0700` | Orchestrator (C-run) | `refreshAvDailyTimeSeriesPostMorning0700` |
| `processtimeseriesjobtask` | Worker + Aggregator + PDR publisher | `processTimeSeriesJobTask` |
| `cleanupoldrundocs` | Nightly cleanup | `cleanupOldRunDocs` |

> **Important:** The aggregator (`onRealtimeRunJobTerminal`) and PDR publisher (`enqueueDataReadyInternal`) are **library functions**, not separate Cloud Functions. Their logs appear under the `processtimeseriesjobtask` service because they execute inside the worker.

---

## Log Tag Reference

Each `betterLogger` instance tags log lines with a short prefix in the format `[TAG function]`. These tags identify which code module produced the log:

| Tag | Logger | File | Service |
|-----|--------|------|---------|
| `aVTSRM` | `tsJobLogger` | `av-time-series-refresh-manager.ts` | Orchestrator |
| `tSJ.t` | `taskLogger` | `time-series-jobs.task.ts` | Worker (task wrapper) |
| `tSJ.w` | `logger` | `time-series-jobs.worker.ts` | Worker (core logic) |
| `rTRA` | `logger` | `realtime-run-aggregator.ts` | Aggregator (runs inside worker) |
| `pDR.H` | `drLogger` | `data-ready.handler.ts` | PDR publisher (runs inside worker) |
| `runDocCleanup` | `logger` | `run-doc-cleanup.ts` | Cleanup |

### Log Line Format

All `betterLogger` info/warn/error logs follow this format:

```
[TAG function] event=EVENT_NAME sym=SYMBOL int=INTERVAL mktDate=DATE ep=ENDPOINT level=LEVEL message=MESSAGE runId=RUNID
```

Not all fields are present in every log. The `runId` field appears in aggregator and PDR logs. Timer logs use a different format (see below).

---

## Stage 1: Orchestrator Start

**Service:** `refreshavtimeseriespostallintervals` (A), `refreshavdailytimeseriesposteveningretry00` (B), `refreshavdailytimeseriespostmorning0700` (C)

**Log event:** `ts.post_all_intervals.run_start`

**Log tag:** `aVTSRM`

**Example log line:**
```
[aVTSRM rATSRP] event=ts.post_all_intervals.run_start mktDate=2026-09-01 level=info message=POST all-intervals run START seq=A scheduled=true mktDate=2026-09-01 actualDate=2026-09-01 startTimePt=13:35:00
```

**What it tells you:** The orchestrator function was triggered and is starting. This confirms the Cloud Scheduler fired.

### Query: Confirm orchestrator started

```
resource.type="cloud_run_revision"
resource.labels.service_name="refreshavtimeseriespostallintervals"
textPayload=~"ts.post_all_intervals.run_start"
timestamp>="2026-09-01T20:00:00Z"
timestamp<="2026-09-01T21:30:00Z"
```

> Adjust `service_name` and timestamp range for B/C runs.

---

## Stage 2: Run Document Initialization

**Service:** Orchestrator (same as Stage 1)

**Firestore writes (not logs):** Three `realtime-runs/{runId}` documents are created with `status: 'IN_PROGRESS'`, `createdJobs: 0`, `finishedJobs: 0`, and `partnerDataReady.messageSent: false`.

**What to check:** The run documents exist in Firestore with correct `runCreatedAt` and `runStartedAt` timestamps.

### Firestore check

```
db.collection('realtime-runs').doc('2026-09-01-TUE-A-MONTHLY-LIVE-POST-1335').get()
db.collection('realtime-runs').doc('2026-09-01-TUE-A-WEEKLY-LIVE-POST-1335').get()
db.collection('realtime-runs').doc('2026-09-01-TUE-A-DAILY-LIVE-POST-1335').get()
```

> **Note:** Run docs are deleted after 2 days by `cleanupOldRunDocs`. If the run is older than 2 days, the docs will be gone. Use log-based verification instead.

---

## Stage 3: Job Creation (per symbol)

**Service:** Orchestrator

**Log events:**

| Event | Tag | Type | Description |
|-------|-----|------|-------------|
| `ts.jobs.scheduler` | `aVTSRM` | `startMaj` | Major block start for endpoint job creation |
| `scheduler.endpoint` | `aVTSRM` | `timeStart` | Timer start for entire endpoint |
| `ts.jobs.processing` | `aVTSRM` | `startMaj` | Per-symbol processing block start |
| `scheduler.symbol` | `aVTSRM` | `timeStart` | Timer start for individual symbol |
| `realtime_job.tx` | `aVTSRM` | `timeStart`/`timeEnd` | Firestore transaction to create job doc |
| `realtime_job.enqueue` | `aVTSRM` | `timeStart`/`timeEnd` | Cloud Task enqueue |
| `scheduler.symbol` | `aVTSRM` | `timeEnd` | Timer end for individual symbol |
| `ts.jobs.processing` | `aVTSRM` | `endMaj` | Per-symbol processing block end |
| `scheduler.endpoint` | `aVTSRM` | `timeEnd` | Timer end for entire endpoint |

**Example timer log lines:**
```
[aVTSRM rTSE] TIMER START label=scheduler.endpoint sym= int=daily(D) ep=TIME_SERIES_DAILY_ADJUSTED
[aVTSRM rTSE] TIMER START label=scheduler.symbol sym=AAPL int=daily(D) ep=TIME_SERIES_DAILY_ADJUSTED
[aVTSRM cRRJAET] TIMER START label=realtime_job.tx sym=AAPL int=daily(D) ep=TIME_SERIES_DAILY_ADJUSTED
[aVTSRM cRRJAET] TIMER END label=realtime_job.tx durMs=45 sym=AAPL int=daily(D) ep=TIME_SERIES_DAILY_ADJUSTED
[aVTSRM cRRJAET] TIMER START label=realtime_job.enqueue sym=AAPL int=daily(D) ep=TIME_SERIES_DAILY_ADJUSTED
[aVTSRM cRRJAET] TIMER END label=realtime_job.enqueue durMs=120 sym=AAPL int=daily(D) ep=TIME_SERIES_DAILY_ADJUSTED
[aVTSRM rTSE] TIMER END label=scheduler.symbol durMs=180 sym=AAPL int=daily(D) ep=TIME_SERIES_DAILY_ADJUSTED
[aVTSRM rTSE] TIMER END label=scheduler.endpoint durMs=54000 int=daily(D) ep=TIME_SERIES_DAILY_ADJUSTED
```

**What to check:** The `realtime_job.tx` duration (`durMs`) should be in the tens of milliseconds. If it's in the tens of seconds (30,000+), there is Firestore transaction contention.

### Query: Check transaction timing (health indicator)

```
resource.type="cloud_run_revision"
resource.labels.service_name="refreshavtimeseriespostallintervals"
textPayload=~"TIMER END label=realtime_job.tx"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-01T21:30:00Z"
```

**Healthy:** `durMs` values consistently under 500ms.

**Unhealthy:** `durMs` values of 30,000-99,000ms indicating Firestore transaction contention.

### Query: Check for enqueue failures

```
resource.type="cloud_run_revision"
resource.labels.service_name="refreshavtimeseriespostallintervals"
textPayload=~"realtime_job.enqueue_failed"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-01T22:00:00Z"
```

### Query: Count symbols processed per interval

```
resource.type="cloud_run_revision"
resource.labels.service_name="refreshavtimeseriespostallintervals"
textPayload=~"TIMER END label=scheduler.symbol.*int=daily"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-01T22:00:00Z"
```

> Replace `daily` with `weekly` or `monthly` for other intervals. The result count should be close to the tracked symbol universe (~864).

---

## Stage 4: Job Creation Completion

**Service:** Orchestrator

**Firestore writes (not logs):** After each interval's job creation loop, the orchestrator sets `jobsCreationCompletedAt` on the run document.

**What to check:** The `jobsCreationCompletedAt` field must be set on all three interval run documents. If it's missing, the orchestrator was killed mid-creation.

### Firestore check

```
db.collection('realtime-runs').doc('2026-09-01-TUE-A-DAILY-LIVE-POST-1335').get()
// Check: data().jobsCreationCompletedAt exists
```

### Log-based check: Confirm endpoint timer ended for all 3 intervals

```
resource.type="cloud_run_revision"
resource.labels.service_name="refreshavtimeseriespostallintervals"
textPayload=~"TIMER END label=scheduler.endpoint"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-01T22:00:00Z"
```

**Expected:** 3 results (one each for MONTHLY, WEEKLY, DAILY). If fewer than 3, the orchestrator was killed before completing all intervals.

---

## Stage 5: Worker Execution

**Service:** `processtimeseriesjobtask`

**Log events:**

| Event | Tag | Level | Description |
|-------|-----|-------|-------------|
| `job.task.start` | `tSJ.t` | info | Cloud Task invocation started |
| `ts.jobs.worker.start` | `tSJ.w` | info | Worker core logic started |
| `ts.jobs.worker.success` | `tSJ.w` | info | Worker completed successfully |
| `ts.jobs.worker.error` | `tSJ.w` | error | Worker encountered an error |
| `ts.jobs.worker.missing_runId` | `tSJ.w` | error | Worker invoked without required runId |
| `ts.jobs.backfill.success` | `tSJ.w` | info | Backfill job succeeded |
| `ts.jobs.backfill.permanent_failure` | `tSJ.w` | info | Backfill job permanently failed after max attempts |
| `job.task.complete` | `tSJ.t` | info | Cloud Task invocation completed |

**Example log lines:**
```
[tSJ.t pSJT] event=job.task.start sym=AAPL mktDate=2026-09-01 ep=0 level=info
[tSJ.w pSJI] event=ts.jobs.worker.start sym=AAPL mktDate=2026-09-01 int=daily ep=0 level=info
[tSJ.w pSJI] event=ts.jobs.worker.success sym=AAPL mktDate=2026-09-01 int=daily ep=0 level=info
[tSJ.t pSJT] event=job.task.complete sym=AAPL mktDate=2026-09-01 ep=0 level=info
```

### Query: Confirm workers are processing

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"ts.jobs.worker.start"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

### Query: Check for worker errors

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"ts.jobs.worker.error"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

### Query: Count successful worker completions per interval

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"ts.jobs.worker.success.*int=daily"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

> Replace `daily` with `weekly` or `monthly`. The count should match the number of created jobs for that interval.

---

## Stage 6: Run Aggregation

**Service:** `processtimeseriesjobtask` (runs inside the worker process)

**Log tag:** `rTRA`

**Log events:**

| Event | Level | Description | When it fires |
|-------|-------|-------------|---------------|
| `realtime.run_not_found` | warn | Run document doesn't exist when a job finishes | Run doc was deleted or never created |
| `realtime.run_complete` | info | Run completed via fast path (all jobs finished within window) | `finished === created` and within 60min |
| `realtime.run_already_complete` | info | Another worker already claimed completion | Duplicate completion attempt (suppressed) |
| `realtime.run_reconcile_before_complete` | warn | Run exceeded 60min window, forcing reconciliation | `finished > 0` but past `MAX_RUN_DURATION_MS` |
| `realtime.run_complete_after_reconcile` | info | Run completed via reconciliation path | After `reconcileRunJobs` force-completes |
| `realtime.run_already_complete_after_reconcile` | info | Another worker already completed during reconcile | Duplicate reconcile completion (suppressed) |
| `realtime.run_pdr_error` | error | PDR publish failed (fast path) | `enqueueDataReadyInternal` threw |
| `realtime.run_pdr_error_after_reconcile` | error | PDR publish failed (reconcile path) | `enqueueDataReadyInternal` threw |
| `realtime.aggregator_error` | error | Unhandled error in aggregator | Unexpected exception |

**Example `realtime.run_complete` log line:**
```
[rTRA undefined] event=realtime.run_complete level=info message={"phase":"post","runType":"ts-post-all-intervals-initial","trigger":"scheduler","sequence":"A","runStartedAt":{"_seconds":1788294908},"partnerDataReady":{"messageSent":false},"interval":"daily","marketDate":"2026-09-01","runId":"2026-09-01-TUE-A-DAILY-LIVE-POST-1335","status":"IN_PROGRESS","jobsCreationStartedAt":{"_seconds":1788295172},"createdJobs":864,"finishedJobs":864,"successJobs":862} runId=2026-09-01-TUE-A-DAILY-LIVE-POST-1335
```

**Critical fields in the `run_complete` message payload:**

| Field | Healthy Value | Unhealthy Value |
|-------|--------------|-----------------|
| `createdJobs` | ~864 (full universe) | Much less than universe (e.g. 40) |
| `finishedJobs` | Equals `createdJobs` | Less than `createdJobs` |
| `successJobs` | Close to `createdJobs` | Much less than `createdJobs` |
| `jobsCreationCompletedAt` | Present (timestamp) | **Missing** (orchestrator killed mid-creation) |
| `permanentFailureJobs` | 0 or small number | Large number |

### Query: All aggregator activity for a specific run

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"2026-09-01-TUE-A-"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

### Query: All run completions (any interval, any sequence)

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"realtime\.run_complete"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

> **Expected:** 3 results per sequence (MONTHLY, WEEKLY, DAILY). For a full A+B+C day, expect up to 9 completions (some B/C intervals may have 0 retry symbols and complete trivially).

### Query: Check for run-not-found warnings

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"realtime.run_not_found"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

> **If present:** The run document was missing when jobs tried to report completion. This indicates either premature cleanup or a failed run doc initialization.

### Query: Check for reconciliation (timeout) events

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"realtime.run_reconcile_before_complete"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T01:00:00Z"
```

> **If present:** The run took longer than 60 minutes (`MAX_RUN_DURATION_MS`). The aggregator force-completed it via reconciliation.

### Query: Check for aggregator errors

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"realtime\.(aggregator_error|run_pdr_error)"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

---

## Stage 7: PDR Publish

**Service:** `processtimeseriesjobtask` (runs inside the worker process)

**Log tag:** `pDR.H`

**Log events:**

| Event | Level | Description |
|-------|-------|-------------|
| `runs.upsert.received` | info | Run doc written/updated in `runs/{runId}` collection |
| `runs.upsert.enqueued` | info | **PDR message published to Pub/Sub** (definitive "PDR sent" signal) |
| `runs.end.doc` | info | Final run doc snapshot exists (END payloads only) |

**Example log lines:**
```
[pDR.H eDRI] event=runs.upsert.received int=daily mktDate=2026-09-01 ep=DATA_READY_RUN level=info message=Run doc written/updated runId=2026-09-01-TUE-A-DAILY-LIVE-POST-1335
[pDR.H eDRI] event=runs.upsert.enqueued int=daily mktDate=2026-09-01 ep=DATA_READY_RUN level=info message=Run enqueued to Pub/Sub runId=2026-09-01-TUE-A-DAILY-LIVE-POST-1335
[pDR.H eDRI] event=runs.end.doc int=daily mktDate=2026-09-01 ep=DATA_READY_RUN level=info message=Run doc snapshot exists. RUN COMPLETE runId=2026-09-01-TUE-A-DAILY-LIVE-POST-1335
```

**The `runs.upsert.enqueued` log is the definitive signal that a PDR was sent.** If you see `runs.upsert.received` but NOT `runs.upsert.enqueued`, the worker was killed between writing the run doc and publishing to Pub/Sub.

### Firestore: PDR run docs (not cleaned up)

The `runs/{runId}` collection (separate from `realtime-runs`) is **not** cleaned up by `cleanupOldRunDocs`. These docs persist indefinitely and can be checked for historical PDR verification:

```
db.collection('runs').doc('2026-09-01-TUE-A-DAILY-LIVE-POST-1335').get()
// Check: data().status === 'completed' or 'failed'
// Check: data().runMeta.messageId exists (confirms Pub/Sub publish)
```

### Query: Confirm all 3 PDRs sent for A-run

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"runs.upsert.enqueued"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

**Expected:** 3 results (MONTHLY, WEEKLY, DAILY) with the A-run runIds.

### Query: Check for PDRs that were received but not enqueued (worker killed mid-publish)

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"runs.upsert.received"
NOT textPayload=~"runs.upsert.enqueued"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

> **Note:** This query syntax may need adjustment in Logs Explorer. Alternatively, compare the count of `runs.upsert.received` vs `runs.upsert.enqueued` — they should be equal.

---

## Stage 8: Run Document Cleanup

**Service:** `cleanupoldrundocs`

**Schedule:** `0 2 * * *` (2:00 AM ET / 6:00 AM UTC daily)

**TTL:** 2 days (`RUN_DOC_TTL_MS = 2 * 24 * 60 * 60 * 1000`)

**What it does:** Deletes `realtime-runs` and `intraday-runs` documents (and their `jobs` subcollections) where `runCreatedAt` is older than 2 days.

**Log events:**

| Event | Level | Description |
|-------|-------|-------------|
| `run-doc-cleanup.start` | info | Cleanup started, includes cutoff timestamp |
| `run-doc-cleanup.collection.found` | info | Found expired run docs in a collection |
| `run-doc-cleanup.collection.none_expired` | info | No expired run docs in a collection |
| `run-doc-cleanup.complete` | info | Cleanup finished, includes deletion counts |

### Query: Confirm cleanup ran

```
resource.type="cloud_run_revision"
resource.labels.service_name="cleanupoldrundocs"
timestamp>="2026-09-03T05:00:00Z"
timestamp<="2026-09-03T07:00:00Z"
```

> **Important:** This cleanup is why `realtime-runs` docs older than 2 days will be missing from Firestore. The `runs` collection (PDR-side) is NOT cleaned up and persists indefinitely.

---

## End-to-End Verification Queries

### Full A-run verification for market date 2026-09-01

Run these queries in order to verify each stage of the pipeline:

#### 1. Orchestrator started

```
resource.type="cloud_run_revision"
resource.labels.service_name="refreshavtimeseriespostallintervals"
textPayload=~"ts.post_all_intervals.run_start.*seq=A"
timestamp>="2026-09-01T20:00:00Z"
timestamp<="2026-09-01T21:00:00Z"
```

**Expected:** 1 result.

#### 2. All 3 intervals had job creation completed

```
resource.type="cloud_run_revision"
resource.labels.service_name="refreshavtimeseriespostallintervals"
textPayload=~"TIMER END label=scheduler.endpoint"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-01T22:00:00Z"
```

**Expected:** 3 results (MONTHLY, WEEKLY, DAILY). If fewer, orchestrator was killed.

#### 3. Transaction timing is healthy

```
resource.type="cloud_run_revision"
resource.labels.service_name="refreshavtimeseriespostallintervals"
textPayload=~"TIMER END label=realtime_job.tx"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-01T22:00:00Z"
```

**Expected:** All `durMs` values under 500ms. Values of 30,000+ indicate contention.

#### 4. All 3 runs completed

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"realtime.run_complete.*2026-09-01-TUE-A-"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

**Expected:** 3 results. Verify `createdJobs` is close to the full universe (~864) in each.

#### 5. All 3 PDRs sent

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"runs.upsert.enqueued.*2026-09-01-TUE-A-"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

**Expected:** 3 results (MONTHLY, WEEKLY, DAILY).

#### 6. No errors

```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"(realtime.aggregator_error|realtime.run_pdr_error|ts.jobs.worker.missing_runId)"
timestamp>="2026-09-01T20:35:00Z"
timestamp<="2026-09-02T00:00:00Z"
```

**Expected:** 0 results.

---

## Failure Mode Quick Reference

### Symptom: No PDR sent for an interval

**Possible causes:**

1. **Orchestrator killed before creating any jobs** — Check Stage 1 and Stage 3 logs. No `scheduler.endpoint` timer end logs.
2. **Orchestrator killed mid-job-creation** — Check Stage 4. `scheduler.endpoint` timer end exists for some intervals but not all. The `run_complete` log will show `createdJobs` much less than universe and no `jobsCreationCompletedAt`.
3. **All jobs failed permanently** — Check Stage 5 worker logs. `ts.jobs.worker.error` for all symbols. The aggregator will still send a PDR (with `runStatus: COMPLETED_WITH_ERRORS`), but if the PDR publish itself fails, check for `realtime.run_pdr_error`.
4. **Aggregator never fired** — No `realtime.run_complete` or `realtime.run_reconcile` logs. Jobs may be stuck in `Pending` status. Check Firestore `realtime-runs/{runId}/jobs` for jobs with `status: PENDING`.

### Symptom: PDR sent but with partial coverage

**Diagnostic:** The `realtime.run_complete` log shows `createdJobs` much less than the tracked symbol universe (~864).

**Root cause:** Orchestrator was killed mid-job-creation after creating only a subset of jobs. The aggregator saw `finished === created` (both small) and sent a PDR. The `jobsCreationCompletedAt` field will be missing from the run doc.

**Key query:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"realtime.run_complete.*\"createdJobs\":40"
```

### Symptom: Duplicate PDR sent

**Diagnostic:** Multiple `runs.upsert.enqueued` logs for the same `runId`.

**Note:** As of commit `2d363c3` (Aug 23, 2026), the aggregator uses an atomic completion claim (`didComplete` flag in a transaction) to prevent this. If you still see duplicates, the atomic claim may have a bug.

### Symptom: Transaction contention (slow job creation)

**Diagnostic:** `realtime_job.tx` timer logs show `durMs` of 30,000-99,000ms instead of <500ms.

**Root cause:** Multiple parallel Firestore transactions writing to the same `runRef` document. The `createdJobs` increment must be outside the transaction (non-transactional `FieldValue.increment()` is atomic at the document level without locking).

**Key query:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="refreshavtimeseriespostallintervals"
textPayload=~"TIMER END label=realtime_job.tx"
```

### Symptom: Run docs missing from Firestore

**Diagnostic:** `realtime-runs/{runId}` document doesn't exist.

**Cause:** The `cleanupOldRunDocs` function deletes run docs older than 2 days (TTL = 2 days, runs at 2:00 AM ET daily). This is expected behavior, not a bug.

**Workaround:** Use log-based verification (Stage 6 and Stage 7 queries) instead of Firestore for runs older than 2 days. The `runs/{runId}` collection (PDR-side) is NOT cleaned up and can also be checked.

### Symptom: Reconciliation triggered (run took >60min)

**Diagnostic:** `realtime.run_reconcile_before_complete` warning log present.

**Meaning:** The run exceeded `MAX_RUN_DURATION_MS` (60 minutes). The aggregator force-completed it by scanning all job docs and counting terminal states. A PDR is still sent, but with whatever counts existed at reconciliation time.

**Key query:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="processtimeseriesjobtask"
textPayload=~"realtime.run_reconcile_before_complete"
```

---

## Appendix: Key Configuration Values

| Config | Value | File |
|--------|-------|------|
| A-run schedule | `35 13 * * 1-5` (1:35 PM PT) | `function-schedules.ts` |
| B-run schedule | `0 18 * * 1-5` (6:00 PM PT) | `function-schedules.ts` |
| C-run schedule | `0 4 * * 1-5` (4:00 AM PT) | `function-schedules.ts` |
| Batch size | 10 (`TS_SCHEDULER_BATCH_SIZE`) | `av-time-series-refresh-manager.ts` |
| Max job attempts | 5 (`MAX_JOB_ATTEMPTS`) | `job-config.ts` |
| Max run duration | 60 min (`MAX_RUN_DURATION_MS`) | `job-config.ts` |
| Cloud Tasks rate | 1.2/sec, 20 concurrent (`CLOUD_TASKS_RATE_LIMITS`) | `job-config.ts` |
| Cloud Tasks retry | 5 attempts, 10-300s backoff | `job-config.ts` |
| Worker memory | 512MiB (`JOB_FUNCTION_MEMORY`) | `job-config.ts` |
| Run doc TTL | 2 days (`RUN_DOC_TTL_MS`) | `job-config.ts` |
| Cleanup schedule | `0 2 * * *` (2:00 AM ET) | `function-schedules.ts` |
| Cleanup max runs/invocation | 200 (`CLEANUP_MAX_RUNS_PER_INVOCATION`) | `job-config.ts` |
| Pub/Sub topic | `partner-data-ready` | `partner/constants.ts` |
| Firestore collections | `realtime-runs`, `runs`, `intraday-runs`, `backfill-runs` | `shared/firestore/firestore.ts` |
