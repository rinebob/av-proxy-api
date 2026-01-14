# Time-Series Job Pipeline – Design & Migration Plan

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

New logical root:

- **Root collection:** `time-series-jobs`
- **Per market date:**  
  `time-series-jobs/{marketDate}/jobs/{jobId}`

Where:

- `marketDate`: `YYYY-MM-DD` (ET trading date)
- `jobId`: deterministic id, e.g. `${symbol}-${endpoint}-${phase}`

### 3.2 Job Document Shape

```ts
// NOTE: in implementation these should be backed by shared enums, not raw strings.
// e.g. AlphaVantageEndpoint, TimeSeriesInterval, TradingPhase, TimeSeriesJobStatus.
interface TimeSeriesJob {
  symbol: string;
  endpoint: AlphaVantageEndpoint; // e.g. TIME_SERIES_DAILY_ADJUSTED | TIME_SERIES_WEEKLY_ADJUSTED | TIME_SERIES_MONTHLY_ADJUSTED
  interval: TimeSeriesInterval;   // DAILY | WEEKLY | MONTHLY
  phase: TradingPhase;            // PRE | POST

  status: TimeSeriesJobStatus;    // PENDING | IN_PROGRESS | SUCCESS | FAILURE | PERMANENT_FAILURE
  attempts: number;
  lastError?: string;

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  lastAttemptAt?: FirebaseFirestore.Timestamp;

  // When we verify that latestBarTimestamp (or equivalent) matches the intended bar for this date
  finalizedAtMs?: number;
}
```

### 3.3 Interval Semantics (DAILY vs WEEKLY vs MONTHLY)

The pipeline intentionally treats intervals differently, reflecting both AV semantics and storage layout:

- **DAILY**
  - Each POST job for a given `marketDate` writes **a single daily bar** for that date via `upsertAvDailyBar` using `outputsize=compact`.
  - We do **not** attempt to reconstruct older days from the compact window on POST; historical gaps are addressed via backfill tooling (see Section 6.5).
  - Storage: year-sharded docs under `sa-time-series/{symbol}/sa-time-series/av-daily-adjusted/years/{year}`.
- **WEEKLY**
  - Compact window is treated as authoritative for the latest year(s).
  - POST jobs for WEEKLY endpoints merge the compact window into year-sharded docs via `mergeWeeklyCompactWindowIntoShards`, rebuilding the latest-year shards and rollover segments.
  - Storage: year-sharded docs under `sa-time-series/{symbol}/sa-time-series/av-weekly-adjusted/years/{year}`.
- **MONTHLY**
  - Compact window is treated as authoritative for the full monthly range.
  - POST jobs merge the compact window into the single `all` doc via `mergeMonthlyCompactWindowIntoAllDocs`.
  - Storage: `sa-time-series/{symbol}/sa-time-series/av-monthly-adjusted/all`.

This means:

- The **job pipeline** guarantees that DAILY/WEEKLY/MONTHLY have the correct **latest bar** for each marketDate.
- **Historical DAILY gaps** (e.g., only Fridays present) are repaired via backfill scripts, not by the schedulers.

### 3.4 Invariants

For a given `marketDate` and set of endpoints/phases:

- **Completion invariant:**  
  The refresh cycle for that date is logically complete when:
  - All jobs satisfy `status ∈ {SUCCESS, PERMANENT_FAILURE}`.
  - Data validation (existing daily validation script) passes.

- **Staleness detection:**  
  Symbols that are stale are exactly:
  - Jobs with `status ∈ {PENDING, IN_PROGRESS, FAILURE}` for `marketDate = today`.

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
   - `set` `system/time-series-jobs/{marketDate}/jobs/{jobId}` with:
     - `symbol, endpoint, interval, phase`
     - If new: `status: 'PENDING'`, `attempts: 0`, `createdAt`, `updatedAt`.
     - If existing and already `SUCCESS` or `PERMANENT_FAILURE`: **leave unchanged** (idempotent).

4. **Enqueue work** (Cloud Tasks, see Section 5).

5. **Write summary doc** (optional at this stage):

   - `system/time-series-jobs/{marketDate}` with aggregate counts:
     - `totalJobs`, `pending`, `success`, `failure`, `permanentFailure`.

No AV calls occur in `refreshForEndpoints` in the new model.

### 4.2 Schedules

Keep existing cron schedules in `function-schedules.ts`:

- PRE runs (intraday snapshots).
- POST daily runs + retries.
- POST weekly/monthly runs.

Change their semantics from "do work" to **"populate/refresh jobs and enqueue tasks"** for the relevant `{marketDate, phase, endpoints}` set.

### 4.3 Weekly vs Monthly Schedulers (Implemented)

To avoid Cloud Function timeouts during job creation for the full symbol universe, the combined weekly+monthly post-close scheduler has been split into two separate scheduled functions in `av-refresh-manager.ts`:

- `refreshAvWeeklyTimeSeriesPostClose`
  - Runs on `TS_POST_CLOSE_SCHEDULE`.
  - Endpoints: `[TIME_SERIES_WEEKLY_ADJUSTED]`.
  - `timeoutSeconds: 600`.
- `refreshAvMonthlyTimeSeriesPostClose`
  - Runs on `TS_POST_CLOSE_SCHEDULE`.
  - Endpoints: `[TIME_SERIES_MONTHLY_ADJUSTED]`.
  - `timeoutSeconds: 600` (can be increased further if needed as tracked symbol count grows).

Both functions call `refreshForEndpoints` with `phase=POST` and **only populate jobs + enqueue tasks**; all AV calls are delegated to the Cloud Tasks worker.

### 4.4 Feature Flags & Env Toggles

Several environment variables gate behavior for the schedulers and job pipeline:

- `TS_JOB_PIPELINE_ENABLED_DAILY_POST`
  - When `true`, POST time-series schedulers populate job docs for DAILY/WEEKLY/MONTHLY endpoints.
  - Allows incremental rollout of the job pipeline without changing scheduler cron wiring.
- `TS_TIME_SERIES_TASKS_ENABLED`
  - When `true`, schedulers will **enqueue Cloud Tasks** for time-series jobs that are `PENDING` or non-terminal.
  - When `false`, job docs can still be created, but no tasks are dispatched; useful for dry runs.
- `TS_JOB_TEST_SYMBOL`
  - Optional, comma-separated list of symbols (e.g., `AVGO` or `AVGO,MSFT,SPY`).
  - When set, POST time-series schedulers restrict both job creation and legacy handler work to this subset to avoid hammering AV during rollouts.

Operational guidance:

- Enable `TS_JOB_PIPELINE_ENABLED_DAILY_POST` first, verify job creation and worker behavior using `TS_JOB_TEST_SYMBOL`.
- Then enable `TS_TIME_SERIES_TASKS_ENABLED` to turn on actual Cloud Tasks processing.
 - Once the job pipeline is stable in production for all POST time-series endpoints, these feature flags are considered **transitional** and should be simplified or removed so that schedulers and workers behave consistently across environments without extra toggles.


---

## 5. Worker Design (Cloud Tasks)

### 5.1 New Function: `processTimeSeriesJob`

**Trigger:**

- HTTPS endpoint behind Cloud Tasks, or background handler for Cloud Tasks.
- Auth enforced (only Cloud Tasks queue can call).

**Payload:**

```json
{
  "marketDate": "2026-01-05",
  "symbol": "AAPL",
  "endpoint": "TIME_SERIES_DAILY_ADJUSTED",
  "phase": "POST"
}
```

**Algorithm:**

1. **Load job**:
   - Path: `system/time-series-jobs/{marketDate}/jobs/{jobId}`.
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
     - Read the year doc under `sa-time-series` (e.g. `.../av-daily-adjusted/years/2026`).
     - Use `lastBarTs` from that year doc.
     - Treat the job as complete if `lastBarTs >= targetTs`, incomplete otherwise.
   - **WEEKLY**:
     - Read the WEEKLY year doc under `sa-time-series` (e.g. `.../av-weekly-adjusted/years/2026`).
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

5. **Verify write**:

   - For DAILY/WEEKLY/MONTHLY jobs, read the appropriate time-series document in `sa-time-series` (DAILY/WEEKLY year doc, MONTHLY all doc) and rely on `lastBarTs` to determine completeness (see step 3).
   - If verification passes:
     - `status: 'SUCCESS'`
     - `finalizedAtMs = targetTs`
     - `updatedAt = now`.

6. **Error handling / mismatches**:

   - If AV call fails (throttle, network, 500, malformed, empty data):
     - `status: 'FAILURE'`
     - `lastError`: truncated error string
     - `updatedAt = now`.
   - If AV returns but `latestBarTimestamp` does not match expected date:
     - Treat as `FAILURE` with `lastError = 'latestBarTimestamp mismatch'`.
   - If `attempts > MAX_ATTEMPTS` (e.g. 5):
     - `status: 'PERMANENT_FAILURE'`
     - Stop re-enqueueing this job (Cloud Tasks retry + our logic together).

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

The initial rollout of the job worker uses conservative, code-level rate limiting and retry behavior:

- **Cloud Tasks worker export** (`processTimeSeriesJobTask` in `time-series-jobs.task.ts`):
  - `rateLimits.maxConcurrentDispatches = 1`.
  - `retryConfig.maxAttempts = 5`, with backoff between 10s and 300s.
- **Worker implementation** (`processTimeSeriesJobInternal` in `time-series-jobs.worker.ts`):
  - Adds a fixed **1s delay** at the start of each job to further spread AV calls and make individual executions visible in logs/UI.
  - Treats errors as **TransientFailure** for attempts `< MAX_ATTEMPTS`, rethrowing so Cloud Tasks retries.
  - After `MAX_ATTEMPTS`, marks jobs as **PermanentFailure** and stops retrying.
- **Supported endpoints in Phase 1**:
  - `TIME_SERIES_DAILY_ADJUSTED`, `TIME_SERIES_WEEKLY_ADJUSTED`, `TIME_SERIES_MONTHLY_ADJUSTED` for **POST** phase only.

This combination guarantees strictly serialized AV time-series calls with a clearly bounded retry envelope while the pipeline is being validated.

### 6.3 Scheduler Interaction

Each scheduled run (PRE/POST):

- Ensures correct set of jobs exist for `{marketDate, phase, endpoints}`.
- Enqueues tasks for any jobs still in `PENDING` or `FAILURE` (up to some daily limit if needed).
- Does not block on job completion; completion is tracked via job status and summaries.

### 6.4 Queue & Worker Tuning Guidance

Tuning guidelines as the universe and SLAs evolve:

- **Throughput vs safety**
  - At `maxConcurrentDispatches = 1` and a 1s delay inside the worker, effective AV call rate is ~1/sec → ~60/min, under the 75/min limit.
  - To increase throughput in the future, consider:
    - Removing or reducing the internal 1s delay once confidence is high.
    - Increasing `maxConcurrentDispatches` slightly (e.g., 2–3) while monitoring AV throttling and Firestore load.
- **Queue UI vs code settings**
  - Rely on **code-level** `rateLimits` in the function export; the Cloud Tasks UI has been observed to drift from intended settings.
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

### 7.1 `system/time-series-status`

For `DAILY_ADJUSTED` and each `marketDate`:

- Derive status from job docs:

  - `totalSymbols = total job count for marketDate & DAILY`.
  - `finalizedCountTotal = count(status == SUCCESS)`.
  - `pendingCount = count(status ∈ {PENDING, IN_PROGRESS, FAILURE})`.

- Persist these aggregates into the existing `system/time-series-status` doc shape so the Health UI can remain mostly unchanged but with richer backing data.

### 7.2 Finalization Docs

Finalization for `marketDate` should occur only when:

1. All `DAILY` POST jobs for that `marketDate` have `status ∈ {SUCCESS, PERMANENT_FAILURE}`.
2. Daily validation passes.

If validation fails:

- Mark status as "needs remediation" in `system/time-series-status`.
- Optionally:
  - Auto-requeue jobs for failed symbols.
  - After remediation, re-run validation and finalize.

---

## 9. Partner Notifications Integration (Job Pipeline)

The ultimate purpose of this pipeline is to keep the partner-facing API surface fresh. Partners currently rely on **Pub/Sub notifications** to know when it is safe and efficient to pull data. The job pipeline must integrate cleanly with the existing RS contract while adding a more granular readiness stream.

There are two distinct notification layers:

1. A **run-level completion signal** that says: "for this `marketDate` and interval set, the refresh run is complete".
2. A **symbol-level readiness stream** that allows partners to begin fetching data early as symbols complete, without waiting for the entire universe.

### 9.1 Source of Truth for Readiness

For the job-based pipeline, the **single source of truth** for readiness is the job document itself:

- Path: `time-series-jobs/{marketDate}/jobs/{jobId}`.
- Each job describes exactly one unit of work: `{marketDate, symbol, endpoint, interval, phase}`.
- Terminal states are `SUCCESS` and `PERMANENT_FAILURE` (see Section 7.3).

A symbol is considered **ready for partner consumption** for a given `marketDate` when:

- All required time-series jobs for that symbol/date have reached a terminal state, e.g.:
  - `{DAILY_POST, WEEKLY_POST, MONTHLY_POST}` jobs are `SUCCESS` (or a clearly-defined subset, per interval policy).
- There are no remaining non-terminal jobs for that symbol/date in `time-series-jobs/{marketDate}/jobs`.

This readiness computation is performed using job docs only; `sa-time-series` documents remain the source of truth for data but are not polled directly for partner signaling.

### 9.2 Symbol-Level Readiness Stream (New Topic)

To reduce partner latency, we introduce a symbol-level readiness stream that is derived from job docs.

- **Topic:** `partner-symbols-ready` (new Pub/Sub topic, separate from `partner-data-ready`).
- **Payload (conceptual):**

  ```ts
  interface SymbolsReadyPayloadV1 {
    version: 'v1';
    marketDate: string;   // YYYY-MM-DD (ET)
    runId?: string;       // Optional link to the run-level event
    symbols: string[];    // Symbols that just became fully ready for this marketDate
    reason?: 'scheduled' | 'backfill';
  }
  ```

- **Granularity:**
  - Readiness is computed per **`{marketDate, symbol}`**.
  - Intervals (DAILY/WEEKLY/MONTHLY) are handled internally by checking the corresponding jobs; the symbol stream does **not** include interval-level detail.

- **Emission strategy:**
  - As jobs transition to `SUCCESS` / `PERMANENT_FAILURE`, an aggregator tracks per-symbol readiness for the current `{marketDate, phase}`.
  - When a symbol's required intervals are all terminal and successful, that symbol is added to an in-memory or Firestore-backed accumulator for the current run.
  - Once the accumulator reaches a configured batch size (e.g. 10 symbols), the system publishes a `SymbolsReadyPayloadV1` with those symbols and clears that batch.
  - Any remaining symbols in the accumulator are flushed at the end of the run.

Partners who want low-latency access can subscribe to `partner-symbols-ready` and start issuing HTTPS time-series requests as soon as they see symbols of interest.

### 9.3 Run-Level Completion (Existing `partner-data-ready` Topic)

The existing RS integration is built around **run-level** `DataReadyPayloadV1` messages on the `partner-data-ready` topic. The job pipeline will continue to use this as the authoritative signal that a run has finished.

When all relevant jobs for `{marketDate, phase, intervalSet}` are terminal (see Section 3.4 Completion invariant):

- A small aggregator computes per-run summary metrics from job docs:
  - `totalJobs` for the run.
  - `successJobs` / `permanentFailureJobs`.
  - `finalizedCountTotal` and `pendingCount` derived from `SUCCESS` / non-terminal counts.
  - Explicit lists (or at least counts) of symbols that are in `PERMANENT_FAILURE`.

- The aggregator then constructs a `DataReadyPayloadV1` and calls `enqueueDataReadyInternal(...)` with:
  - `runId` following the existing RS contract (e.g. `YYYY-MM-DD-HHMM-post` or `YYYY-MM-DD-HHMM-post-manual`).
  - `phase = POST`.
  - `intervals = [TimeSeriesInterval.DAILY]` for DAILY runs, or appropriate combinations for W/M.
  - `runStatus`:
    - `'completed'` if there are no permanent-failure symbols.
    - `'completed_with_errors'` if any permanent failures occurred.
  - `status = END` (`PartnerPublishStatus.END`) to mark the end of the run.
  - `symbolsUpdatedCount`, `finalizedCountTotal`, and `pendingCount` populated from job aggregates.
  - `extraAttributes.successes` / `extraAttributes.failures` set from job counts so RS can inspect failures via existing runs documents.

The **job-run completion aggregator** is responsible for emitting this single, authoritative `partner-data-ready` message per run, in addition to any symbol-level `partner-symbols-ready` batches.

### 9.4 Permanent Failures and Partner Expectations

Permanent failure handling is critical for partner transparency:

- Jobs that reach `TimeSeriesJobStatus.PermanentFailure` indicate a symbol that the job pipeline will not retry further for that `{marketDate, endpoint, phase}` without operator intervention.
- The run-level `DataReadyPayloadV1` should reflect this by:
  - Setting `runStatus = 'completed_with_errors'`.
  - Including a non-zero `failures` count in `extraAttributes` (and optionally exposing the permanent-failure symbol list via the corresponding `runs/{runId}` document, where size permits).

Partners can then treat a `COMPLETED_WITH_ERRORS` run as "mostly done" while inspecting downstream logs or the `runs` collection for which symbols failed permanently.

---

## 9. Health UI / Angular & NgRx Signal Store

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

### 8.2 HealthDashboardStore Changes

In the Angular app (NgRx Signal Store + Signals):

- Extend `HealthDashboardStore` to hold:

  - `jobSummaryByDate: Record<string, JobSummary>`
  - `staleSymbolSample: string[]`
  - `failedSymbolSample: { symbol: string; error: string }[]`

- Computed signals:

  - `isDateFullyFinalized(marketDate)`: derived from job summary.
  - `hasOutstandingFailures(marketDate)`.
  - `staleCount`, `failureCount` for quick badges.

This gives:

- Precise visibility:
  - "We have N symbols still not finalized for 2026-01-05; here are 25 of them."
- Clear distinction between:
  - `PENDING` (not yet processed by workers),
  - `FAILURE` (retried but still failing),
  - `PERMANENT_FAILURE` (taken out of rotation pending manual remediation).

### 9.3 Daily PRE vs POST Rows (Operator Workflow)

The Health Dashboard should surface **separate rows** for DAILY PRE and DAILY POST job sets:

- **DAILY PRE row** (intraday snapshot health):
  - Jobs: `{marketDate, symbol, DAILY, PRE}`.
  - Metrics: `totalJobs`, `successCount`, `pendingCount`, `failureCount`.
  - Purpose: confirm that the pre-close snapshot pass (and any intraday PRE runs we choose to track as jobs) have executed for the symbol universe.

- **DAILY POST row** (final bar health):
  - Jobs: `{marketDate, symbol, DAILY, POST}`.
  - Metrics: same as above.
  - Operator workflow:
    - If `pendingCount = 0` and `failureCount = 0` → treat DAILY POST for that date as complete.
    - If `failureCount > 0` → drill into failed jobs list and optionally **requeue selected jobs** via an admin action.

Weekly/monthly can follow the same pattern (POST-only rows), but the critical operator flow each morning is:

- Check DAILY PRE row for obvious anomalies.
- Check DAILY POST row for completion and any remaining failures.

---

## 9. Migration Strategy

### 9.1 Phase 1 – Introduce Job Model for DAILY POST Only

1. Implement the schema and job creation for **DAILY POST** only:
   - Keep WEEKLY/MONTHLY on the legacy loop initially.
2. Add `processTimeSeriesJob` worker for DAILY POST.
3. Configure Cloud Tasks queue and wire scheduler to:
   - Populate DAILY POST jobs.
   - Enqueue tasks for them.
4. In emulator/staging:
   - Run legacy loop and job pipeline in parallel (shadow mode).
   - Compare `latestBarTimestamp` and job status for a sample of symbols.

### 9.2 Phase 2 – Switch DAILY POST Fully to Jobs

1. Disable direct AV calls inside `refreshForEndpoints` for DAILY POST.
2. Rely exclusively on job pipeline for DAILY POST.
3. Validate for a period in staging and then Prod:
   - All symbols for each marketDate have matching `latestBarTimestamp` and job `status`.

### 9.3 Phase 3 – Extend to WEEKLY/MONTHLY POST

1. Create jobs and workers for `TIME_SERIES_WEEKLY_ADJUSTED` and `TIME_SERIES_MONTHLY_ADJUSTED` POST.
2. Reuse the same job schema and worker, with interval-specific verification logic.
3. Integrate WEEKLY/MONTHLY job summaries into Health UI.

### 9.4 Phase 4 – PRE Phase & Long-Tail Remediation

1. Decide which PRE flows warrant jobs (likely only daily PRE if we want job tracking there).
2. Optionally create PRE jobs for intraday snapshots that are critical to partners.
3. Add tooling/scripts to:
   - Backfill jobs for historical dates with known gaps.
   - Run workers to repair missing bars.

### 9.5 Phase 5 – Clean-Up Legacy Paths

1. Once job pipeline is stable for all intervals:
   - Remove any remaining per-symbol AV loops in schedulers.
   - Simplify `refreshForEndpoints` to orchestration-only concerns.
2. Update docs (`backend-functions-overview.md`, `partner-discovery.md`, etc.) to describe the job-driven pipeline as the canonical design.

---

## 10. Deprecation / Removal Targets

As the job-based pipeline becomes the source of truth for time-series refresh, the following code paths are candidates for deprecation and eventual removal:

- **`av-refresh-manager.ts` (time-series portions):**
  - The per-symbol AV loops inside `refreshForEndpoints` for time-series endpoints (DAILY/WEEKLY/MONTHLY) once all such work is handled via jobs.
  - The "near-complete acceleration" logic that re-runs a small subset of DAILY POST symbols to try to catch stragglers.
  - Any logic in this module that infers completion solely from `latestBarTimestamp` rather than from job status + validation.

- **Legacy time-series updaters (if any remain):**
  - Historical updaters such as `updateDailyTimeSeries` / `av-daily-time-series-updater` that iterate over all symbols and call AV directly.
  - Any scripts or functions that assume "one scheduled run implies all symbols updated" without consulting job documents.

- **Health metrics based only on request logs:**
  - Portions of the Health view that treat per-request success/failure as a proxy for freshness.
  - Over time, these should be replaced or augmented so that **job summaries** and **job statuses** are the primary health indicators for time-series.

During implementation we should:

- Tag affected code with `// TODO: deprecate (time-series job pipeline)`.
- Maintain a short list of deprecation items in `TASK.md`.
- Remove or simplify the legacy paths only after:
  - Daily POST is fully job-driven in Prod and stable.
  - Weekly/monthly POST has been migrated.
  - The Health UI is wired to job summaries and validated in real usage.

---

## 11. Open Questions / TODOs

- **Job granularity:**
  - One job per `{symbol, endpoint, phase, marketDate}` is the baseline. Do we ever want per-phase-only or multi-endpoint jobs?
- **Failure policies:**
  - Exact thresholds and behavior for moving from `FAILURE` → `PERMANENT_FAILURE`.
- **Operational tooling:**
  - Admin scripts or UI to inspect and requeue failed jobs by date/symbol.

---

## 12. Verification & Audit Strategy

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
