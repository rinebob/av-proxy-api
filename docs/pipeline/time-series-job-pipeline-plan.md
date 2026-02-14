# Time-Series Job Pipeline – Design & Migration Plan

> **Last updated:** 2026-02-14  
> **Implementation status:** Sections 1–8 reflect the current, live pipeline (realtime-runs, A/B/C schedulers, PDRs). Sections 9–12 are future work/backlog items and are marked as such.

### Related Documents

This document is part of a four-document set covering the time-series job pipeline:

| Document | Purpose | Audience |
|----------|---------|----------|
| **`pipeline/time-series-job-pipeline-plan.md`** (this doc) | Design rationale, architecture decisions, migration plan, and future work. The "why + what". | Internal SA engineers |
| **`pipeline/time-series-job-pipeline-deep-dive.md`** | Technical appendix with concrete TypeScript types, code paths, Firestore shapes, and step-by-step algorithms. The "how". | Internal + RS engineering |
| **`partner/rs-partner-integration.md`** | Consumer-facing contract: Pub/Sub payloads, subscription filters, `includeSymbols`/`excludeSymbols` semantics, HTTPS endpoints, quick start. | RS backend engineers |
| **`pipeline/abc-run-pipeline-flowchart.md`** | Mermaid flowcharts documenting the A/B/C pipeline visually with filenames and function names. | Internal + RS engineering |

---

## 1. Problem Statement

The current Alpha Vantage time-series refresh pipeline (daily/weekly/monthly, pre/post-close) is:

- **Monolithic**: a single scheduled function (`refreshForEndpoints`) loops over *all* tracked symbols and endpoints.
- **Best-effort**: failures (AV throttling, transient errors, timeouts) are handled at the symbol level but not elevated to a clear "run incomplete" state.
- **Opaque**: there is no authoritative, queryable representation of "which symbols for which date are finalized vs stale."
- **Brittle under growth**: as `tracked_symbols` grows, per-run AV call volume and duration increase; we already hit issues (e.g. the 60-symbol cap) that silently starved part of the universe.

**Goal:** Move to a **job-driven, queue-executed pipeline** where each `{marketDate, symbol, endpoint, phase}` is a first-class job with explicit state, and "completion" is defined by job state, not by a loop that happens to finish.

---

## 2. High-Level Architecture

### 2.1 Core Idea

Introduce a new **Time-Series Job Pipeline**:

- **Job Model (Firestore)**:
  - Every refresh unit (per symbol, per endpoint, per phase, per date) is a **job document**.
  - Job docs track status, attempts, and errors.
- **Orchestrator (Schedulers)**:
  - Scheduled functions **populate jobs** and enqueue work, but *do not* call AV directly.
- **Workers (Cloud Tasks)**:
  - Each job is executed by a worker function that:
    - Calls AV,
    - Writes bars to Firestore via existing handlers,
    - Updates job status.
- **Status & Finalization**:
  - "Done" for a given date is defined as: **all jobs are in `{SUCCESS, PERMANENT_FAILURE}`** and validation passes.
  - Health UI and partner monitoring read from job summaries, not heuristics.

---

## 3. Firestore Job Schema

### 3.1 Collections & Paths

Historically the job pipeline used a **date-centric root** under `time-series-jobs/{marketDate}`. That layout has been fully superseded and all realtime work now uses the **run-centric** model described below. New code MUST NOT write to or depend on `time-series-jobs/{marketDate}`.

- **Realtime runs (canonical):**
  - `realtime-runs/{runId}`
  - `realtime-runs/{runId}/jobs/{jobId}`
- **Backfill runs (canonical):**
  - `backfill-runs/{runId}`
  - `backfill-runs/{runId}/jobs/{jobId}`

Where:

- `runId` (realtime, all-intervals POST):
  - Format: `YYYY-MM-DD-DOW-SEQUENCE-INTERVAL-LIVE|MANUAL-PHASE-HHMM`
  - Example: `2026-01-29-THU-A-DAILY-LIVE-POST-1635`.
  - There is **one realtime run per interval** (DAILY, WEEKLY, MONTHLY) for a given trading date and sequence.
  - `SEQUENCE` segment:
    - `A` → initial A run (close-time all-intervals POST driven by `refreshAvTimeSeriesPostAllIntervals`, clockEt=1635).
    - `B` → evening retry B run (all-intervals POST driven by `refreshAvDailyTimeSeriesPostEveningRetry00`, clockEt=2100).
    - `C` → next-morning cleanup C run (all-intervals POST driven by `refreshAvDailyTimeSeriesPostMorning0700`, clockEt=0700).
  - `HHMM` is the ET clock label identifying when the run was nominally scheduled (e.g. `1635`, `2100`, `0700`). This is always required and is set by the caller.
- `runId` (backfill): `YYYY-MM-DD-DOW-POST-<INTERVAL>-FULL_BACKFILL` for full-history backfills (e.g. `2026-02-01-SUN-POST-DAILY-FULL_BACKFILL`). Each interval (DAILY, WEEKLY, MONTHLY) gets its own backfill run doc.
- `jobId`: deterministic id, e.g. `${symbol}-${endpoint}-${phase}`.

### 3.2 Job Document Shape

```ts
// NOTE: in implementation these are backed by shared enums, not raw strings.
// See time-series-jobs.model.ts for canonical definitions.
interface TimeSeriesJob {
  symbol: string;
  endpoint: AlphaVantageEndpoint; // e.g. TIME_SERIES_DAILY_ADJUSTED | TIME_SERIES_WEEKLY_ADJUSTED | TIME_SERIES_MONTHLY_ADJUSTED
  interval: TimeSeriesInterval;   // DAILY | WEEKLY | MONTHLY
  phase: TradingPhase;            // PRE | POST

  status: TimeSeriesJobStatus;    // PENDING | IN_PROGRESS | SUCCESS | TRANSIENT_FAILURE | PERMANENT_FAILURE
  attempts: number;
  lastError?: string;

  // Data freshness relative to the target marketDate/period.
  // Orthogonal to job status — a job can be SUCCESS but STALE.
  dataFreshness?: TimeSeriesDataFreshness; // UNKNOWN | FRESH | STALE

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  firstAttemptedAt?: FirebaseFirestore.Timestamp; // when first AV fetch started
  lastAttemptAt?: FirebaseFirestore.Timestamp;
}

---

## 4. Orchestrator Design (Schedulers)

### 4.1 Refactor `refreshForEndpoints` into Job Populator

**Current behavior:**

- Loads all tracked symbols.
- For each symbol & endpoint:
  - Calls AV handler,
  - Writes bars,
  - Updates metadata, status, finalization docs, etc.

**New behavior:**

1. **Compute context** (already present):
   - `marketDate` (ET)
   - `phase` (PRE/POST)
   - `endpoints` (e.g. `[TIME_SERIES_DAILY_ADJUSTED]` or `[WEEKLY_ADJUSTED, MONTHLY_ADJUSTED]`)
   - `runId`, `dow`, etc.

2. **Load tracked symbols**:

   ```ts
   const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
   const symbols = symbolsSnap.docs.map(d => d.id);
   ```

3. **Populate job docs**:

   For each `symbol` and `endpoint`:

   - Derive `interval` from endpoint.
   - Compute `jobId = `${symbol}-${endpoint}-${phase}``.
   - `set` `realtime-runs/{runId}/jobs/{jobId}` with:
     - `symbol, endpoint, interval, phase`
     - If new: `status: 'PENDING'`, `attempts: 0`, `createdAt`, `updatedAt`.
     - If existing and already `SUCCESS` or `PERMANENT_FAILURE`: **leave unchanged** (idempotent).

4. **Enqueue work** (Cloud Tasks, see Section 5).

5. **Write summary doc** (optional at this stage):

   - `realtime-runs/{runId}` with aggregate counts:
     - `totalJobs`, `pending`, `success`, `failure`, `permanentFailure`.

No AV calls occur in `refreshForEndpoints` in the new model.

### 4.2 Schedules

Keep existing cron schedules in `function-schedules.ts`:

- PRE runs (intraday snapshots).
- POST daily runs + retries.
- POST weekly/monthly runs.

Change their semantics from "do work" to **"populate/refresh jobs and enqueue tasks"** for the relevant `{marketDate, phase, endpoints}` set.

### 4.3 Realtime POST Orchestrator & Weekly/Monthly Schedulers

#### 4.3.1 Canonical All-Intervals POST Orchestrator (Run A / B / C)

In the current pipeline, the **canonical realtime POST entrypoint** for time-series is `runAllTimeSeriesIntervalsPost` (in `av-time-series-refresh-manager.ts`). It is invoked by three schedulers that represent the A/B/C realtime runs for POST:

- **Run A – primary close-time pass**
  - Scheduler: `refreshAvTimeSeriesPostAllIntervals`
  - Cron: `TS_DAILY_POST_CLOSE_SCHEDULE` (16:35 ET)
  - Behavior:
    - Computes market context via `getEtMarketDateAndDow()`.
    - Calls `runAllTimeSeriesIntervalsPost({ trigger: SCHEDULER, sequence: 'A', clockEt: '1635', ... })`.
    - `runAllTimeSeriesIntervalsPost` builds one interval-specific `runId` per interval using `buildRealtimeIntervalRunId(...)` → `RunIdFactory.createRealtime()` in the `YYYY-MM-DD-DOW-SEQUENCE-INTERVAL-LIVE|MANUAL-PHASE-HHMM` format.
    - For each interval (MONTHLY, WEEKLY, DAILY), it initializes `realtime-runs/{runId}` and calls `runTimeSeriesJobsForEndpoint(...)` which in turn uses `createRealtimeRunJobAndEnqueueTask(...)` to create jobs under `realtime-runs/{runId}/jobs/{jobId}` and enqueue Cloud Tasks.

- **Run B – same-evening retry pass**
  - Scheduler: `refreshAvDailyTimeSeriesPostEveningRetry00`
  - Cron: `TS_DAILY_POST_EVENING_RETRY_MINUTE_00` (21:00 ET)
  - Behavior:
    - Calls `runAllTimeSeriesIntervalsPost({ trigger: SCHEDULER, sequence: 'B', clockEt: '2100', ... })`.
    - For each interval, the orchestrator reads `retrySymbols` from the corresponding A run doc via `getRetrySymbolsForInterval()` and creates jobs **only** for those symbols. If no retry symbols exist, the run is immediately marked `COMPLETE` with `createdJobs=0`.

- **Run C – next-morning cleanup pass**
  - Scheduler: `refreshAvDailyTimeSeriesPostMorning0700`
  - Cron: `TS_DAILY_POST_MORNING_CATCHUP_0700` (07:00 ET)
  - Behavior:
    - Uses `getLatestRetryRunMarketDateForInterval(TimeSeriesInterval.DAILY)` to identify the **target marketDate** for cleanup (typically yesterday's date).
    - If no retry runs exist, it logs `ts.jobs.a_run.skip_no_retry` and returns without creating a run.
    - Otherwise calls `runAllTimeSeriesIntervalsPost({ trigger: SCHEDULER, sequence: 'C', clockEt: '0700', marketDate: targetMarketDate, ... })`.
    - For each interval, the orchestrator reads `retrySymbols` from the corresponding B run doc via `getRetrySymbolsForInterval()` and creates jobs only for those symbols with `deadlineRun: true` so the worker can apply stale-at-deadline semantics.

#### 4.3.2 Weekly/Monthly POST Schedulers

The legacy weekly/monthly POST schedulers are retained for compatibility but are now **logging-only no-ops** in the new pipeline:

- `refreshAvWeeklyTimeSeriesPostClose`
- `refreshAvMonthlyTimeSeriesPostClose`

Both run on `TS_POST_CLOSE_SCHEDULE`, but they no longer create jobs or call AV handlers; they emit structured logs indicating that all-intervals POST is handled by `refreshAvTimeSeriesPostAllIntervals`.

### 4.4 Feature Flags & Env Toggles

Environment variables that gate behavior for the schedulers and job pipeline:

- ~~`TS_JOB_PIPELINE_ENABLED_DAILY_POST`~~ — **Removed.** The pipeline is now always active for all POST intervals. This transitional flag was removed once the pipeline was validated in production.
- `TS_TIME_SERIES_TASKS_ENABLED`
  - When `true`, schedulers will **enqueue Cloud Tasks** for time-series jobs that are `PENDING` or non-terminal.
  - When `false`, job docs can still be created, but no tasks are dispatched; useful for dry runs.
  - The worker also checks this flag and early-returns in non-emulator environments when `false`.
- `TS_JOB_TEST_SYMBOL`
  - Optional, comma-separated list of symbols (e.g., `AVGO` or `AVGO,MSFT,SPY`).
  - When set, POST time-series schedulers restrict both job creation and legacy handler work to this subset to avoid hammering AV during rollouts.

Operational guidance:

- `TS_TIME_SERIES_TASKS_ENABLED` must be `true` in production for the pipeline to function.
- Use `TS_JOB_TEST_SYMBOL` during rollouts to restrict the symbol universe for testing.

---

### 4.5 Temporary Guard: Time-Series-Only Mode

To reduce noise and risk while validating the time-series job pipeline, the main refresh orchestrator (`refreshForEndpoints` in `av-refresh-manager.ts`) supports an opt-in guard that disables all non-time-series work for a run.

- **Env var:** `AV_REFRESH_TIMESERIES_ONLY`
- **Behavior when enabled** (`true` / `1` / `on`):
  - The `endpoints` array passed into `refreshForEndpoints` is filtered down to only those for which `isTimeSeriesEndpoint(endpoint) === true`.
  - If no time-series endpoints remain after filtering, the function logs a `refresh.skip_non_timeseries_only` event and returns early (no AV calls or Firestore writes for that run).
  - If some endpoints are filtered out, a `refresh.filter_non_timeseries` structured log records both the original and filtered endpoint sets.

This guard is intentionally easy to reverse:

- To re-enable non-time-series AV work, unset `AV_REFRESH_TIMESERIES_ONLY` or set it to any value other than `true` / `1` / `on`.
- Once unset, `refreshForEndpoints` will again process all configured endpoints (including non-time-series) according to its normal logic.

Operational recommendation while the job pipeline is under active development:

- Keep `AV_REFRESH_TIMESERIES_ONLY` enabled in environments where you are primarily validating the time-series job / worker / publisher path.
- Explicitly remove or flip this flag as part of the rollout plan once non-time-series endpoints are ready to be exercised again.

---

## 5. Worker Design (Cloud Tasks)

### 5.1 Function: `processTimeSeriesJobTask` → `processTimeSeriesJobInternal`

**Trigger:**

- Cloud Tasks handler (`onTaskDispatched`), auth enforced by Cloud Tasks queue.
- Configuration centralized in `job-config.ts`: `CLOUD_TASKS_RATE_LIMITS`, `CLOUD_TASKS_RETRY_CONFIG`, `JOB_FUNCTION_MEMORY`.

**Payload:**

```json
{
  "marketDate": "2026-01-05",
  "symbol": "AAPL",
  "endpoint": "TIME_SERIES_DAILY_ADJUSTED",
  "phase": "POST",
  "runId": "2026-01-05-MON-A-DAILY-LIVE-POST-1635",
  "jobType": "realtime",
  "mode": "COMPACT",
  "deadlineRun": false
}
```

**Algorithm:**

1. **Load job**:
   - Path: `realtime-runs/{runId}/jobs/{jobId}`.
   - If job is missing → optionally treat as no-op or recreate as `PENDING`.
   - If `status ∈ {SUCCESS, PERMANENT_FAILURE}` → idempotent **no-op**, acknowledge task.

2. **Mark IN_PROGRESS & increment attempts** (transaction):
   - `status: 'IN_PROGRESS'`
   - `attempts: attempts + 1`
   - `lastAttemptAt = now`, `updatedAt = now`.

3. **Compute target bar (minimal verification)**:

   For all intervals we define a common target timestamp:

   - `targetTs = new Date(`${marketDate}T00:00:00.000Z`).getTime()`.

   Verification is always based on **series metadata derived from bars**, using `lastBarTs` as the authoritative "latest bar" timestamp:

   - **DAILY**:
     - Read the year doc under `sa-time-series` (e.g. `.../av-daily-adjusted/years/{year}`).
     - Use `lastBarTs` from that year doc.
     - Treat the job as complete if `lastBarTs >= targetTs`, incomplete otherwise.
   - **WEEKLY**:
     - Read the WEEKLY year doc under `sa-time-series` (e.g. `.../av-weekly-adjusted/years/{year}`).
     - Use `lastBarTs` from that year doc.
     - Treat the job as complete if `lastBarTs >= targetTs`, incomplete otherwise.
   - **MONTHLY**:
     - Read the MONTHLY `all` doc under `sa-time-series` (e.g. `.../av-monthly-adjusted/all`).
     - Use `lastBarTs` from that doc (computed from the bars array).
     - Treat the job as complete if `lastBarTs >= targetTs`, incomplete otherwise.

4. **Call AV via existing handler**:

   ```ts
   const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
   await handler.fetch({
     symbol,
     outputsize: OutputSize.COMPACT,
     __checkWriteToggle: false,
     __phase: phase,
     __run: runContext,
   });
   ```

   - Handlers already:
     - Normalize AV response.
     - Write time-series bars via `saveAvTimeSeriesData` to `sa-time-series`.
     - Update top-level metadata, `latestBarTimestamp`, etc.

5. **Verify write + derive freshness**:

   - For DAILY/WEEKLY/MONTHLY jobs, read the appropriate time-series document in `sa-time-series` (DAILY/WEEKLY year doc, MONTHLY all doc) and rely on `lastBarTs` to determine completeness (see step 3).
   - Compute a **data freshness** signal, orthogonal to job status:

     - `TimeSeriesDataFreshness.FRESH` when `lastBarTs >= targetTs`.
     - `TimeSeriesDataFreshness.STALE` when a bar exists but `lastBarTs < targetTs`.
     - `TimeSeriesDataFreshness.UNKNOWN` when no bar has been recorded yet.

   - If the handler call succeeds, always mark the job itself as `status: 'SUCCESS'` and persist:

     - `periodStatus` (`PERIOD_END` vs `IN_PROGRESS`).
     - Optional `finalizedAtMs = targetTs` when `PERIOD_END`.
     - `dataFreshness` as above.

   - For realtime jobs with a `runId`, the worker also maintains per-run symbol lists on `realtime-runs/{runId}`:

     - When `dataFreshness === STALE`:
       - Append `symbol` to `staleSymbols` and `retrySymbols`.
     - When a previously-stale symbol becomes `FRESH` (B/C retry pass):
       - Remove `symbol` from `retrySymbols` and append to `retrySuccessSymbols`.
     - When the job reaches `PERMANENT_FAILURE` (after `MAX_JOB_ATTEMPTS` retries):
       - The realtime run aggregator appends `symbol` to `permanentFailureSymbols` and `retrySymbols`.

   - This yields four per-run arrays:

     - `staleSymbols`: symbols that were still stale for that run's target `marketDate`/interval.
     - `permanentFailureSymbols`: symbols that ultimately hard-failed for that run.
     - `retrySymbols`: the **canonical superset** (`stale ∪ permanentFailure`) that future A/B/C runs will use to drive selective re-fetching.
     - `retrySuccessSymbols`: symbols that were in the retry set but became FRESH during this pass. Used to derive `includeSymbols` in the PDR message for B/C runs.

6. **Error handling / mismatches + deadline semantics**:

   - If AV call fails (throttle, network, 500, malformed, empty data):
     - `status: 'FAILURE'`
     - `lastError`: truncated error string
     - `updatedAt = now`.
   - If AV returns but `latestBarTimestamp` does not match the expected `marketDate` (i.e. `dataFreshness === STALE`):
     - For A/B runs, treat this as **successful but stale** (`status: SUCCESS`, `dataFreshness: STALE`) so later passes can re-check these symbols using the per-run `retrySymbols` list.
     - For the C (deadline) run, when the task payload includes `deadlineRun: true` and `dataFreshness === STALE` after a fetch, the worker throws a `"STALE_AT_DEADLINE"` error so the job flows through the existing retry path:
       - For `attempts < MAX_ATTEMPTS`, mark `TRANSIENT_FAILURE` and **rethrow**; Cloud Tasks retries according to `retryConfig`.
       - Once `attempts >= MAX_ATTEMPTS`, mark `status: 'PERMANENT_FAILURE'` and notify the realtime run aggregator, which updates `permanentFailureJobs`, `permanentFailureSymbols`, and `retrySymbols` for that run.

---

## 6. Throttling & Rate-Limiting

### 6.1 Cloud Tasks Queue Config

Define a queue (e.g. `av-timeseries-jobs`):

- **Rate limit (AV constraint):** current Alpha Vantage limit is **75 requests / minute**.
  - Target `maxDispatchesPerSecond ≈ 1.0–1.2` to stay comfortably under 75/min.
- `maxConcurrentDispatches`: to protect Firestore and Functions (e.g. 10–20).
- Retry policy:
  - `maxAttempts: 5`
  - `minBackoff`: ~10 seconds
  - `maxBackoff`: several minutes

Jobs no longer need per-loop throttling; **queue-level config** controls throughput.

### 6.2 Implemented Worker Limits & Diagnostics (Current State)

All configuration is centralized in `job-config.ts`:

- **Cloud Tasks worker export** (`processTimeSeriesJobTask` in `time-series-jobs.task.ts`):
  - `rateLimits.maxConcurrentDispatches = 20` (from `CLOUD_TASKS_RATE_LIMITS`).
  - `rateLimits.maxDispatchesPerSecond = 1.0` — stays under AV 75/min limit.
  - `retryConfig.maxAttempts = 5`, with backoff between 10s and 300s (from `CLOUD_TASKS_RETRY_CONFIG`).
  - `memory = '512MiB'` (from `JOB_FUNCTION_MEMORY`).
- **Worker implementation** (`processTimeSeriesJobInternal` in `time-series-jobs.worker.ts`):
  - Adds a fixed **1s delay** (`JOB_EXECUTION_DELAY_MS`) at the start of each job to further spread AV calls.
  - Treats errors as **TransientFailure** for attempts `< MAX_JOB_ATTEMPTS` (5), rethrowing so Cloud Tasks retries.
  - After `MAX_JOB_ATTEMPTS`, marks jobs as **PermanentFailure** and stops retrying.
- **Aggregator timeout**: `MAX_RUN_DURATION_MS` (60 minutes) — if a run hasn't completed within this window, the aggregator reconciles from the jobs subcollection and force-completes.
- **Supported endpoints**:
  - `TIME_SERIES_DAILY_ADJUSTED`, `TIME_SERIES_WEEKLY_ADJUSTED`, `TIME_SERIES_MONTHLY_ADJUSTED` for **POST** phase only.

### 6.3 Scheduler Interaction

Each scheduled run (PRE/POST):

- Ensures correct set of jobs exist for `{marketDate, phase, endpoints}`.
- Enqueues tasks for any jobs still in `PENDING` or `FAILURE` (up to some daily limit if needed).
- Does not block on job completion; completion is tracked via job status and summaries.

### 6.4 Queue & Worker Tuning Guidance

Tuning guidelines as the universe and SLAs evolve:

- **Throughput vs safety**
  - At `maxDispatchesPerSecond = 1.0` and `maxConcurrentDispatches = 20`, effective AV call rate is ~1/sec → ~60/min, under the 75/min limit. The 20 concurrent dispatches allow Firestore writes to overlap while the 1/sec dispatch rate gates AV calls.
  - The internal 1s delay (`JOB_EXECUTION_DELAY_MS`) further spreads calls.
  - To increase throughput in the future, consider increasing `maxDispatchesPerSecond` slightly while monitoring AV throttling.
- **Queue UI vs code settings**
  - Rely on **code-level** `rateLimits` in the function export (via `job-config.ts`); the Cloud Tasks UI has been observed to drift from intended settings.
  - Treat the UI as read-only status, not the source of truth for limits.

### 6.5 SA Backfill Toolbox (Where This Fits)

The job pipeline is designed to keep **current** DAILY / WEEKLY / MONTHLY data fresh and correct. When historical issues or AV quirks slip through, we rely on a small set of **backfill / repair tools** to clean up the past:

- **SA Time-Series Window Backfill (Primary window repair)**
  Script: `functions/scripts/backfill-timeseries-window.ts`
  Use when you need to **surgically repair a bounded date window** for SA time-series:
  - Supports DAILY / WEEKLY / MONTHLY.
  - Deletes + rewrites bars **only inside** `[BACKFILL_FROM, BACKFILL_TO]` for the selected intervals.
  - Persists a resumable run state in Firestore under `system/backfill-runs/runs/{backfillRunId}` and updates an aggregate summary at `system/backfill-runs`.
  - Recommended for:
    - Fixing AV regressions for a known date span.
    - Cleaning up after split/history patches that affected a limited window.

- **Full-history / structural rebuilders (existing scripts)**
  Used when an entire interval’s history for a symbol (or small universe) is known to be wrong and must be **rebuilt from scratch** using AV or daily SA as the source of truth. Examples include:
  - Daily backfill scripts that re-fetch complete DAILY_ADJUSTED history.
  - Weekly/monthly rebuild scripts that regenerate W/M bars from daily SA or AV compact windows.

Operationally:

- Prefer the **job pipeline** and validators for day-to-day correctness.
- Reach for the **window backfill** when a **specific date range** is wrong but the rest of history is trusted.
- Use the heavier **full-history rebuilders** sparingly, when an interval’s entire history is compromised and a targeted window repair is insufficient.

---

## 7. Job Lifecycle & Status Transitions

Job status progression for a single `{marketDate, symbol, endpoint, phase}`:

1. **Creation**
   - Scheduler creates/updates job with `status: PENDING`, `attempts: 0`.
2. **Dispatch**
   - When `TS_TIME_SERIES_TASKS_ENABLED=true`, scheduler enqueues a Cloud Task for each job that is not in a terminal state.
3. **Worker start**
   - Worker loads job; if `status ∈ {SUCCESS, PERMANENT_FAILURE}`, it is treated as terminal and the task is acknowledged (no-op).
   - Otherwise, it runs a transaction to set:
     - `status: IN_PROGRESS`, `attempts: attempts + 1`, `lastAttemptAt`, `updatedAt`.
4. **Success path**
   - Handler runs, writes data, verification passes.
   - Job is updated to `status: SUCCESS`, with `periodStatus` and optional `finalizedAtMs`.
5. **Transient failure path**
   - Handler throws (AV throttle, timeout, transient network error, etc.).
   - Worker records `lastError`, increments `attempts`.
   - If `attempts < MAX_ATTEMPTS`:
     - Sets `status: TRANSIENT_FAILURE` and **rethrows**; Cloud Tasks retries according to `retryConfig`.
6. **Permanent failure path**
   - Once `attempts >= MAX_ATTEMPTS`:
     - Job is marked `status: PERMANENT_FAILURE`.
     - Worker does **not** throw, so Cloud Tasks stops retrying.

Terminal states are `SUCCESS` and `PERMANENT_FAILURE`; all others are considered active or pending work.

---

## 8. Status & Finalization Integration

### 7.1 `system/time-series-status` *(Future Work)*

For `DAILY_ADJUSTED` and each `marketDate`:

- Derive status from **realtime run docs** for that date and interval:

  - Filter `realtime-runs` where `marketDate` matches and `interval = DAILY`.
  - `totalSymbols = sum(createdJobs)` across those runs.
  - `finalizedCountTotal = sum(successJobs)`.
  - `pendingCount = totalSymbols - finalizedCountTotal - sum(permanentFailureJobs)`.

- Persist these aggregates into the existing `system/time-series-status` doc shape so the Health UI can remain mostly unchanged but with richer backing data.

### 7.2 Finalization Docs *(Future Work)*

Finalization for `marketDate` should occur only when:

1. All `DAILY` POST jobs for that `marketDate` have `status ∈ {SUCCESS, PERMANENT_FAILURE}`.
2. Daily validation passes.

---

## 9. Partner Notifications Integration (Job Pipeline)

> **Status:** This section describes the intended, steady-state integration for
> partner notifications based on the `realtime-runs` model. Portions of it are
> implemented today (run-level PDR for A/B/C runs); others should be treated as
> **future work / backlog**, not as a description of current production
> behavior.

The ultimate purpose of this pipeline is to keep the partner-facing API surface fresh. Partners currently rely on **Pub/Sub notifications** to know when it is safe and efficient to pull data. The job pipeline must integrate cleanly with the existing RS contract while adding a more granular readiness stream.

The pipeline exposes a symbol-level readiness stream derived from job docs. This exists primarily for future or non-RS consumers who explicitly want per-symbol early signals. RS does **not** rely on this stream for its canonical ingestion; it uses the run-level `partner-data-ready` contract described in Section 9.3.

- **Topic:** `partner-symbols-ready` (new Pub/Sub topic, separate from `partner-data-ready`).

---

## 9. Health UI / Angular & NgRx Signal Store *(Future Work)*

### 8.1 New Backend Read Surface

Add or extend an API endpoint to expose per-date job summaries:

- **Input:**
  - `marketDate` (optional; default to "today" ET).
- **Output:**
  - `totalJobs`
  - `successCount`
  - `pendingCount`
  - `failureCount`
  - `permanentFailureCount`
  - Small sample lists of:
    - `pending` symbols
    - `failure` symbols with `lastError`

---

## 9. Migration Strategy *(Historical / Future Work)*

### 9.1 Phase 1 – Completed: All-Intervals POST with Realtime Runs

**Status:** Complete. The job pipeline is fully live for all POST intervals (DAILY, WEEKLY, MONTHLY) using the `realtime-runs` model.

What's implemented today:

- **Schema & job creation**:
  - Realtime jobs are created under `realtime-runs/{runId}/jobs/{...}` for all intervals.
  - Each interval gets its own run document per sequence (A/B/C).
  - RunIds use the `YYYY-MM-DD-DOW-SEQUENCE-INTERVAL-LIVE|MANUAL-PHASE-HHMM` format (generated by `RunIdFactory.createRealtime()` in `runid-factory.ts`).
- **Worker**:
  - `processTimeSeriesJobInternal` handles all intervals in POST phase.
  - Supports `COMPACT` (realtime) and `FULL_BACKFILL` modes.
  - Tracks `dataFreshness` (FRESH/STALE/UNKNOWN) and maintains per-run `retrySymbols`, `staleSymbols`, and `retrySuccessSymbols`.
- **Schedulers**:
  - A/B/C POST schedulers (`refreshAvTimeSeriesPostAllIntervals`,
    `refreshAvDailyTimeSeriesPostEveningRetry00`,
    `refreshAvDailyTimeSeriesPostMorning0700`) invoke
    `runAllTimeSeriesIntervalsPost` and create jobs for all intervals.
  - B/C runs use `getRetrySymbolsForInterval()` to read retry symbols from the prior sequence's run doc.
  - Weekly/monthly POST schedulers are now logging-only no-ops.
- **Cloud Tasks**:
  - Queue `CloudTask.TIME_SERIES_JOB` processes tasks with rate limits and retries (config in `job-config.ts`).
- **Aggregation & PDR**:
  - `onRealtimeRunJobTerminal` maintains per-run counters and emits run-level
    `partner-data-ready` END messages for each completed interval run.
  - PDR messages include `includeSymbols` (B/C retry runs) or `excludeSymbols` (A initial runs) for RS consumption.
  - Fast-path completion when `finishedJobs === createdJobs`; slow-path reconciliation via `reconcileRunJobs()` after `MAX_RUN_DURATION_MS`.

Future work (see later sections) focuses on:
- Health UI and richer status aggregation (`system/time-series-status`).
- Optional symbol-level readiness streams.
- Operational tooling for manual remediation and audits.

---

## 10. Deprecation / Removal Targets *(Historical / Future Work)*

As the job-based pipeline becomes the source of truth for time-series refresh, the following code paths are candidates for deprecation and eventual removal:

- **`av-refresh-manager.ts` (time-series portions):**
  - The per-symbol AV loops inside `refreshForEndpoints` for time-series endpoints (DAILY/WEEKLY/MONTHLY) once all such work is handled via jobs.
  - The "near-complete acceleration" logic that re-runs a small subset of DAILY POST symbols to try to catch stragglers.
  - Any logic in this module that infers completion solely from `latestBarTimestamp` rather than from job status + validation.

---

## 11. Open Questions / TODOs *(Backlog)*

- **Job granularity:**
  - One job per `{symbol, endpoint, phase, marketDate}` is the baseline. Do we ever want per-phase-only or multi-endpoint jobs?
- **Failure policies:**
  - Exact thresholds and behavior for moving from `FAILURE` → `PERMANENT_FAILURE`.
- **Operational tooling:**
  - Admin scripts or UI to inspect and requeue failed jobs by date/symbol.

---

## 12. Verification & Audit Strategy *(Future Work)*

This pipeline relies on **three layers of protection** to minimize the need for manual or bulk backfills.

### 12.1 Layer 1 – Jobs + Retries (Per-Symbol Robustness)

- Each `{marketDate, symbol, endpoint, phase}` is a job.
- Cloud Tasks handles **short-term retries** with backoff for transient errors (throttling, network, 5xx).
- The worker:
  - Marks `status: FAILURE` with `lastError` when a refresh attempt fails.
  - Transitions to `PERMANENT_FAILURE` when `attempts > MAX_ATTEMPTS`.
- The orchestrator **never re-creates jobs that are already `SUCCESS` or `PERMANENT_FAILURE`** for a given `{marketDate, endpoint, phase}`:
  - This ensures we do *not* keep re-requesting symbols that are already complete for that day.

### 12.2 Layer 2 – Validation + Remediation (DAILY + W/M)

For **DAILY POST** and **WEEKLY/MONTHLY POST**, we run validation passes over all symbols for a `marketDate`:

- **DAILY POST validation** (extension of existing script):
  - Confirms each symbol has a DAILY bar for `marketDate` (or is explicitly exempt).
  - Checks for obviously bad values (e.g., NaNs, impossible prices).
  - For failures:
    - Re-queues only those symbols by resetting their job `status` to `PENDING` and enqueuing new tasks.
    - Re-runs validation after remediation; only then marks the date as finalized.

- **WEEKLY/MONTHLY POST validation**:
  - Confirms each symbol has at least one non-empty WEEKLY/MONTHLY series entry that is **at or after** the expected period for `marketDate`.
    - We trust AV's bars and do **not** attempt strict period-end date matching for the latest bar.
    - The key is: the series is present and non-empty; we rely on AV to provide a correct in-progress bar that will eventually become the final period bar.
  - For symbols missing W/M series when they should exist:
    - Re-queue only those jobs for another attempt.

**Handling AV delayed availability:**

- AV does **not** guarantee a specific time when all market data is ready; data becomes available "whenever that data is available from the source".
- For DAILY jobs:
  - A job is **not** considered complete until `latestBarTimestamp >= targetTs` (the date for `marketDate`).
  - If the last bar still represents a prior trading day, the worker treats this as a soft failure: `status: FAILURE`, allowing later scheduled runs to re-attempt.
  - Once we see `latestBarTimestamp` for `marketDate` (or later, in unusual trading-calendar edge cases), the job can move to `SUCCESS` and will not be re-enqueued.
- For W/M jobs:
  - The worker trusts AV's latest W/M series; success is defined as a non-empty payload and successful write.
  - Validation (Section 12.2) ensures that, over time, each symbol accumulates the expected W/M coverage; missing-period issues are surfaced there.

This combination means:

- We keep retrying symbols **only until** their job is demonstrably complete for that date.
- We do *not* burn quota on symbols whose jobs are already `SUCCESS` for that `marketDate`.

### 12.3 Layer 3 – Nightly Completeness Audits (2-Week Lookback)

To defend against subtle or long-tail issues, we add a **nightly audit** over a recent history window:

- Runs once per night (off-hours), scanning a **2-week lookback** window.
  - We assume data is good through at least `2025-12-31`; initial audits can safely start at that boundary.
- For each `marketDate` in the lookback and for each interval (DAILY/WEEKLY/MONTHLY):
  - Confirms that the number of jobs equals the symbol universe size for that date.
  - Confirms that all jobs are `SUCCESS` or `PERMANENT_FAILURE`.
  - Optionally samples a subset of symbols to cross-check Firestore time-series documents for presence of the expected bars.
- Audit results:
  - Written to a dedicated collection (e.g. `system/time-series-audits/{marketDate}`) with summary and any anomalies.
  - For anomalies (e.g., missing jobs, missing bars, unexpected values):
    - Create or re-open jobs for the affected `{symbol, endpoint, marketDate}` combinations.
    - Allow the standard worker + validation path to repair them.

Over time, this three-layer approach (jobs + retries, validation/remediation, nightly audits) should reduce full backfills to **rare, structural events** (schema changes, split logic changes), not routine correctness fixes.
