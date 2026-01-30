# Time-Series Job Pipeline Deep Dive (Realtime & Full Backfill)

Audience: internal + RS engineering. This document is a **technical appendix** to:

- `docs/time-series-job-pipeline-plan.md` (design & migration plan)
- `docs/rs-partner-integration.md` (RS-facing behavior & contracts)

It focuses on **concrete types and flows** for the job-based time-series pipeline:

- Firestore schemas (jobs & runs)
- Enums / interfaces
- Realtime refresh pipeline
- Full backfill pipeline
- Shared helpers & separation of concerns

---

## 1. Core Types & Enums

Most core types live in:

- `functions/src/v2/alpha-vantage/jobs/time-series-jobs.model.ts`
- `functions/src/v2/alpha-vantage/jobs/time-series-jobs.worker.ts`
- `functions/src/v2/alpha-vantage/jobs/backfill-job-aggregator.ts`
- `functions/src/v2/alpha-vantage/data-refresher/av-time-series-refresh-manager.ts`

### 1.1 Execution Mode (Job-Level)

```ts
export enum TimeSeriesJobMode {
  Compact = 'COMPACT',        // standard small-window refresh (scheduler path)
  FullBackfill = 'FULL_BACKFILL', // destructive full-history rebuild
}
```

- **Compact**: used by **realtime** jobs. Fetches a compact window from Alpha Vantage and merges it into existing SA data.
- **FullBackfill**: used only by **full backfill** jobs. Deletes existing SA data for that symbol+endpoint and fetches **FULL** history.

### 1.2 Job Terminal Status

```ts
export enum TimeSeriesJobTerminalStatus {
  SUCCESS = 'SUCCESS',
  PERMANENT_FAILURE = 'PERMANENT_FAILURE',
}
```

Used by both:

- Realtime aggregator (`time-series-jobs.aggregator.ts`)
- Backfill aggregator (`backfill-job-aggregator.ts`)

as the only two **terminal** outcomes for job completion.

### 1.3 Job Type (Realtime vs Backfill)

```ts
export enum TimeSeriesJobType {
  REALTIME = 'realtime',
  BACKFILL = 'backfill',
}
```

- **Realtime**: jobs created under `time-series-jobs/{marketDate}/jobs/...`.
- **Backfill**: jobs created under `backfill-runs/{runId}/jobs/...`.

The worker uses this to:

- Select the right **job document path**.
- Route completion events to the correct **aggregator** (realtime vs backfill).

### 1.4 Job Status (Full State Machine)

```ts
export enum TimeSeriesJobStatus {
  Pending = 'PENDING',
  InProgress = 'IN_PROGRESS',
  Success = 'SUCCESS',
  TransientFailure = 'TRANSIENT_FAILURE',
  PermanentFailure = 'PERMANENT_FAILURE',
}
```

Status transitions:

- `PENDING` → `IN_PROGRESS` → `SUCCESS`
- `PENDING` → `IN_PROGRESS` → `TRANSIENT_FAILURE` → (retries) → `SUCCESS`
- `PENDING` → `IN_PROGRESS` → `TRANSIENT_FAILURE` → ... → `PERMANENT_FAILURE` (after MAX_ATTEMPTS)

---

## 2. Firestore Schemas

### 2.1 Realtime Runs – `realtime-runs` (canonical)

The canonical model for **realtime POST runs** is a **run-centric tree** that mirrors the full backfill layout:

```text
realtime-runs/{runId}
realtime-runs/{runId}/jobs/{symbol-endpoint-phase}
```

- `runId`: `YYYY-MM-DD-DOW-POST-LIVE|MANUAL-SEQUENCE-HHMM` (e.g. `2026-01-29-THU-POST-LIVE-A-1635`).
- `jobId`: `${symbol}-${endpoint}-${phase}`.

**Run document (high level):**

```ts
interface RealtimeRunDoc {
  runId: string;
  runType: 'ts-post-all-intervals';
  marketDate: string;           // YYYY-MM-DD (ET)
  phase: TradingPhase.POST;
  trigger: 'scheduled' | 'manual' | 'test';

  // Counters managed by the scheduler and worker/aggregator:
  expectedJobs: number;         // total jobs this run should create
  createdJobs: number;          // incremented as job docs are written
  finishedJobs: number;         // incremented once per job terminal transition
  successJobs: number;
  permanentFailureJobs: number;

  status: TimeSeriesRunStatus;  // NOT_STARTED | IN_PROGRESS | COMPLETE | COMPLETE_WITH_ERRORS

  runCreatedAt: FirebaseFirestore.Timestamp;
  runStartedAt?: FirebaseFirestore.Timestamp;
  runCompletedAt?: FirebaseFirestore.Timestamp;

  // Marker that the scheduler has finished job creation for this run.
  jobsCreationCompleteAt?: FirebaseFirestore.Timestamp;

  // Partner-data-ready side effects (Pub/Sub):
  pdrPublishedAt?: FirebaseFirestore.Timestamp;
  pdrMessageId?: string;
}
```

**Realtime job documents (canonical path):**

```text
realtime-runs/{runId}/jobs/{symbol-endpoint-phase}
```

Each job document is structurally similar to the existing `time-series-jobs` job docs (see below) but is now **logically owned by a single run**. The worker will update these docs and maintain the run-level counters instead of writing to a date-level aggregate under `time-series-jobs/{marketDate}`.

> **Design choice:** For realtime POST, the system will converge on **per-run counters on `realtime-runs/{runId}`** as the single source of truth for completion and partner-data-ready publishing. The legacy `time-series-jobs/{marketDate}` aggregate document is deprecated and will be removed once all schedulers and workers are migrated.

### 2.2 Realtime Jobs – `time-series-jobs` (legacy, to be removed)

This was the original root for realtime jobs and the date-level aggregate. New work should target `realtime-runs/{runId}` instead.

**Collection layout (legacy):**

```text
time-series-jobs/{marketDate}/jobs/{symbol-endpoint-phase}
```

- `marketDate`: `YYYY-MM-DD` (ET trading date)
- `jobId`: `${symbol}-${endpoint}-${phase}`

**Document shape (approximate, see `time-series-jobs.model.ts`):**

```ts
interface TimeSeriesJobDoc {
  symbol: string;                     // e.g. "AVGO"
  endpoint: AlphaVantageEndpoint;     // e.g. TIME_SERIES_DAILY_ADJUSTED
  interval: TimeSeriesInterval;       // DAILY | WEEKLY | MONTHLY
  phase: TradingPhase;                // PRE | POST

  status: TimeSeriesJobStatus;        // PENDING, IN_PROGRESS, SUCCESS, etc.
  attempts: number;
  lastError?: string;

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  lastAttemptAt?: FirebaseFirestore.Timestamp;

  // When we verify that the intended bar exists for this date/interval
  finalizedAtMs?: number;             // epoch millis for the target period

  // Optional: mode for this job (typically COMPACT for realtime)
  mode?: TimeSeriesJobMode;
}
```

**Date doc (aggregate per marketDate) – legacy/deprecated:**

```text
time-series-jobs/{marketDate}
```

Historically this doc held per-date aggregates such as:

- `marketDate`
- `phase` (string)
- `runId` (string or null)
- `status` (`IN_PROGRESS` | `COMPLETE`)
- `totalJobs` (aggregate count)

The new design **eliminates this aggregation layer for realtime**. Instead:

- Schedulers write a single run doc under `realtime-runs/{runId}`.
- Job creation and the worker maintain **per-run counters** on that doc.
- The run-level aggregator uses those counters plus `jobsCreationCompleteAt` to determine completion and publish `partner-data-ready`.

New implementations should treat writes to `time-series-jobs/{marketDate}` as **deprecated** and avoid adding new dependencies; the remaining code will be marked for removal once the `realtime-runs` path is fully live in production.

### 2.3 Backfill Runs – `backfill-runs`

**Run document:**

```text
backfill-runs/{runId}
```

Created by `enqueueFullBackfillJobsForEndpoint`:

```ts
await runDocRef.set({
  runId,
  type: 'full_backfill',
  marketDate,
  endpoint: endpointName,
  interval: intervalForEndpoint,
  symbolCount: createdSymbolsThisEndpoint.size,
  expectedJobs: createdSymbolsThisEndpoint.size,
  successJobs: 0,
  permanentFailureJobs: 0,
  status: 'IN_PROGRESS',
  runStartedAt: Timestamp.now(),
});
```

- `expectedJobs`: number of backfill jobs created for this run.
- `successJobs` / `permanentFailureJobs`: counters maintained by `onBackfillJobTerminal`.
- `status`: `IN_PROGRESS` or `COMPLETE`.

**Backfill job documents:**

```text
backfill-runs/{runId}/jobs/{symbol-endpoint-phase}
```

Created by `enqueueFullBackfillJobsForEndpoint`:

```ts
await jobRef.set({
  symbol: symbolUpper,
  endpoint,
  phase: TradingPhase.POST,
  mode: TimeSeriesJobMode.FullBackfill,
  status: TimeSeriesJobStatus.Pending,
  attempts: 0,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
});
```

These are intentionally **simpler** than realtime `time-series-jobs` docs (no `lastError`/`finalizedAtMs`).

---

## 3. Realtime Pipeline

This section traces the **normal daily/weekly/monthly refresh** path.

### 3.1 Entry Point: Schedulers (Cloud Scheduler → Functions v2)

Relevant functions in `av-time-series-refresh-manager.ts`:

- `refreshAvDailyTimeSeriesPostClose`
- `refreshAvWeeklyTimeSeriesPostClose`
- `refreshAvMonthlyTimeSeriesPostClose`

Each scheduled function:

1. Computes **market context**:
   - `marketDate` (ET)
   - `phase` (PRE/POST)
   - target endpoints (DAILY, WEEKLY, MONTHLY adjusted).
2. Loads the **tracked symbol universe** from Firestore (`FirestoreCollection.TRACKED_SYMBOLS`).
3. For each `{symbol, endpoint}`:
   - Calls `createOrUpdateTimeSeriesJobAndMaybeEnqueueTask(...)`.

### 3.2 Job Creation & Enqueue – Realtime Helper

`createOrUpdateTimeSeriesJobAndMaybeEnqueueTask` (in `av-time-series-refresh-manager.ts`) is the central helper used by the **realtime** pipeline for **job doc creation and task enqueue** under `time-series-jobs/{marketDate}`.

Full backfills use a sibling path, `enqueueFullBackfillJobsForEndpoint` (Section 4.3), which writes job docs under `backfill-runs/{runId}` and enqueues tasks with `jobType: BACKFILL`.

*Purposefully trimmed for clarity in this appendix; see source for full details.*

### 3.3 Cloud Tasks Worker Wrapper

`functions/src/v2/alpha-vantage/jobs/time-series-jobs.task.ts`:

```ts
export const processTimeSeriesJobTask = onTaskDispatched<ProcessTimeSeriesJobPayload>(
  {
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 300,
    },
    rateLimits: {
      maxConcurrentDispatches: 20,
      maxDispatchesPerSecond: 1.0,
    },
    memory: '512MiB',
    secrets: ['ALPHAVANTAGE_API_KEY'],
  },
  async (req) => {
    const payload = req.data as ProcessTimeSeriesJobPayload;
    // logs...
    await processTimeSeriesJobInternal(payload);
  },
);
```

- **Queue name:** `CloudTask.TIME_SERIES_JOB` (`processTimeSeriesJobTask`).
- **Rate limiting:** ~1 AV request/second, up to 20 concurrent tasks for Firestore work.
- **Retries:** up to 5 attempts with exponential backoff.

### 3.4 Core Worker: `processTimeSeriesJobInternal`

Location: `time-series-jobs.worker.ts`.

```ts
export interface ProcessTimeSeriesJobPayload {
  marketDate: string;            // YYYY-MM-DD (ET)
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  phase: TradingPhase;
  mode?: TimeSeriesJobMode;      // COMPACT (default) or FULL_BACKFILL
  jobType?: TimeSeriesJobType;   // REALTIME (default) or BACKFILL
  runId?: string;                // required when jobType is BACKFILL
}
```

High-level algorithm:

1. **Safety belt:**
   - If `TS_TIME_SERIES_TASKS_ENABLED` is not `true` and not in emulator, **no-op** (extra guard while pipeline is under development).
2. **Endpoint/phase check:**
   - Supports only POST for `TIME_SERIES_DAILY_ADJUSTED`, `TIME_SERIES_WEEKLY_ADJUSTED`, `TIME_SERIES_MONTHLY_ADJUSTED`.
3. **Determine job doc reference** based on `jobType`:
   - `REALTIME` → `time-series-jobs/{marketDate}/jobs/{symbol-endpoint-phase}`.
   - `BACKFILL` → `backfill-runs/{runId}/jobs/{symbol-endpoint-phase}`.
4. **Increment attempts and mark `IN_PROGRESS`** in a transaction.
5. **If `mode === FullBackfill`**:
   - Delete existing SA time-series data for that symbol+interval using helpers:

```ts
deleteDailyAdjustedForSymbol(symbol);
deleteWeeklyAdjustedForSymbol(symbol);
deleteMonthlyAdjustedForSymbol(symbol);
```

6. **Fetch from Alpha Vantage** via `AlphaVantageHandlerFactory`:

```ts
const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
const outputSizeForJob = mode === TimeSeriesJobMode.FullBackfill
  ? OutputSize.FULL
  : OutputSize.COMPACT;

await handler.fetch({
  symbol,
  outputsize: outputSizeForJob,
  __phase: phase,
});
```

7. **Verify bar presence** using SA time-series metadata (`lastBarTs`) in Firestore.
8. **Update job status**:
   - On success: `TimeSeriesJobStatus.Success`, `periodStatus`, optional `finalizedAtMs`.
   - On error:
     - Record `lastError` for observability.
     - If attempts < MAX_ATTEMPTS: mark `TRANSIENT_FAILURE`, throw to let Cloud Tasks retry.
     - Else: mark `PERMANENT_FAILURE` and **do not throw**.
9. **Aggregators**:
   - After determining terminal state:
     - `jobType === BACKFILL` → `onBackfillJobTerminal(...)`.
     - `jobType !== BACKFILL` → `onTimeSeriesJobTerminal(...)`.

> **Shared worker:** The **same worker function** powers both realtime and full backfill jobs; mode and jobType control behavior.

### 3.5 Realtime Aggregator: `onTimeSeriesJobTerminal`

Location: `time-series-jobs.aggregator.ts` (not shown here in full; pattern matches `backfill-job-aggregator.ts`).

Responsibilities:

- Maintain aggregates on `time-series-jobs/{marketDate}`:
  - `successJobs`, `permanentFailureJobs`, etc.
- Detect when **all realtime jobs for a date** are in terminal states.
- Feed data into:
  - `system/time-series-status` (health view).
  - Run-level partner data-ready publishing (for RS), via an aggregator that composes `DataReadyPayloadV1`.

The aggregator writes a roll-up document under `time-series-jobs/{marketDate}`
and then calls `publishTimeSeriesRunCompletedFromJobs`, which enqueues a
`partner-data-ready` message via `enqueueDataReadyInternal`.

RS consumes these completion events and may apply an internal feature flag to
temporarily skip or short-circuit processing for certain runs (for example,
while testing new ingestion logic). This does **not** change behavior on our
side: the pipeline always publishes a completion event when a run reaches a
terminal state.

Concretely, this is expressed via the `trigger` field in the
`DataReadyPayloadV1` payload and mirrored Pub/Sub attributes:

- For normal production runs the pipeline emits `trigger: "scheduled"` and RS
  performs its usual ingestion.
- When SA explicitly emits `trigger: "test"`, RS treats the event as a
  contract/delivery test and **skips normal processing** while still accepting
  and logging the message.

---

## 4. Full Backfill Pipeline

Full backfills are **admin-initiated** operations that reuse the same worker but:

- Use `TimeSeriesJobMode.FullBackfill`.
- Use `TimeSeriesJobType.BACKFILL`.
- Store jobs under `backfill-runs/{runId}/jobs/...`.

### 4.1 HTTP Trigger → Task: `triggerFullBackfillJobs`

Location: `av-full-backfill.http.ts`.

```ts
export const triggerFullBackfillJobs = onRequest({ /* ... */ }, async (req, res) => {
  // validate method, shared secret, parse body
  const queue = getFunctions().taskQueue(CloudTask.FULL_BACKFILL_RUN);

  const endpointsToRun: AlphaVantageEndpoint[] = [];
  if (includeMonthly) endpointsToRun.push(AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED);
  if (includeWeekly) endpointsToRun.push(AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED);
  endpointsToRun.push(AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED);

  for (const endpoint of endpointsToRun) {
    await queue.enqueue({ marketDate, symbols, endpoint });
  }

  res.status(202).json({ ok: true, ... });
});
```

### 4.2 Endpoint-Specific Enqueue Task: `processFullBackfillRunTask`

Location: `av-full-backfill.task.ts`.

```ts
export const processFullBackfillRunTask = onTaskDispatched<FullBackfillTaskPayload>({
  retryConfig: { maxAttempts: 3, minBackoffSeconds: 30, maxBackoffSeconds: 300 },
  timeoutSeconds: 600,
  memory: '512MiB',
}, async (req) => {
  const data = (req.data || {}) as FullBackfillTaskPayload;
  const { marketDate, symbols, endpoint } = data;

  const result = await enqueueFullBackfillJobsForEndpoint({ endpoint, marketDate, symbols });
  // logs, etc.
});
```

- One **task invocation per endpoint** (DAILY, WEEKLY, MONTHLY) to keep enqueue bounded.

### 4.3 Job Creation & Run Doc: `enqueueFullBackfillJobsForEndpoint`

Location: `av-time-series-refresh-manager.ts`.

This helper is the **backfill-specific** companion to the realtime helper in Section 3.2. It creates job docs under `backfill-runs/{runId}` and enqueues Cloud Tasks with `jobType: BACKFILL`.

Key logic:

1. Derive `marketDate` (ET) and `runId`:

```ts
const runId = `${marketDate}-${dowStr}-POST-${endpoint}-FULL_BACKFILL`;
```

2. Determine symbol set:

```ts
symbols = symbolsOverride ? orderTrackedSymbols(symbolsOverride) : orderTrackedSymbols(allTrackedSymbols);
```

3. For each symbol chunk:

```ts
const jobId = `${symbolUpper}-${endpoint}-${TradingPhase.POST}`;
const jobPath = `${FirestoreCollection.BACKFILL_RUNS}/${runId}/${FirestoreCollection.JOBS}/${jobId}`;

await jobRef.set({
  symbol: symbolUpper,
  endpoint,
  phase: TradingPhase.POST,
  mode: TimeSeriesJobMode.FullBackfill,
  status: TimeSeriesJobStatus.Pending,
  attempts: 0,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
});

if (tasksEnabled) {
  const queue = getFunctions().taskQueue(CloudTask.TIME_SERIES_JOB);
  await queue.enqueue({
    marketDate,
    symbol: symbolUpper,
    endpoint,
    phase: TradingPhase.POST,
    mode: TimeSeriesJobMode.FullBackfill,
    jobType: TimeSeriesJobType.BACKFILL,
    runId,
  });
}
```

4. Reset and create the **run doc** with `expectedJobs`, `successJobs`, `permanentFailureJobs`, and `status: 'IN_PROGRESS'`.

> **Shared worker & queue:** Full backfill reuses the **same** `processTimeSeriesJobTask` and `processTimeSeriesJobInternal`, distinguished only by `mode` and `jobType`.

### 4.4 Backfill Aggregator: `onBackfillJobTerminal`

Location: `backfill-job-aggregator.ts`.

```ts
export async function onBackfillJobTerminal(
  args: { runId: string; symbol: string; interval: TimeSeriesInterval; status: TimeSeriesJobTerminalStatus },
): Promise<void> {
  const { runId, symbol, interval, status } = args;
  const runRef = db.doc(`${FirestoreCollection.BACKFILL_RUNS}/${runId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) return;

    const now = Timestamp.now();
    if (status === 'SUCCESS') {
      tx.update(runRef, {
        successJobs: FieldValue.increment(1),
        updatedAt: now,
      });
    } else if (status === 'PERMANENT_FAILURE') {
      tx.update(runRef, {
        permanentFailureJobs: FieldValue.increment(1),
        updatedAt: now,
      });
    }
  });

  const runSnap = await runRef.get();
  const runData = runSnap.data();

  const expected = runData.expectedJobs || 0;
  const success = runData.successJobs || 0;
  const failure = runData.permanentFailureJobs || 0;

  if (success + failure >= expected && runData.status !== TimeSeriesRunStatus.COMPLETE) {
    await runRef.update({
      status: TimeSeriesRunStatus.COMPLETE,
      runCompletedAt: Timestamp.now(),
    });
  }
}
```

- No Pub/Sub side-effects here; backfills are **operator-driven maintenance**, not part of the RS cadence.

---

## 5. Shared Helpers & Separation of Concerns

### 5.1 Shared Components

Common to **both** realtime and full backfill:

- **Cloud Tasks worker & queue**
  - `CloudTask.TIME_SERIES_JOB` → `processTimeSeriesJobTask` → `processTimeSeriesJobInternal`.
- **Realtime job creator**
  - `createOrUpdateTimeSeriesJobAndMaybeEnqueueTask` writes under `time-series-jobs/{marketDate}` and enqueues `jobType: REALTIME` tasks when enabled.
- **Backfill job creator**
  - `enqueueFullBackfillJobsForEndpoint` writes under `backfill-runs/{runId}` and enqueues `jobType: BACKFILL` tasks when enabled.
- **Alpha Vantage handler abstraction**
  - `AlphaVantageHandlerFactory.createHandler(endpoint)`
  - `handler.fetch({ symbol, outputsize, __phase })` encapsulates AV calls and Firestore writes.
- **SA time-series storage layout**
  - Daily/weekly/year shards & monthly-all docs under `sa-time-series` trees.
- **Completion semantics**
  - Use `lastBarTs` on SA docs to determine whether the target period is complete.
- **Terminal status handling**
  - `TimeSeriesJobTerminalStatus` + per-pipeline aggregators.

### 5.2 Deliberate Differences

- **Job type & location**
  - Realtime: `TimeSeriesJobType.REALTIME`, docs under `time-series-jobs/{marketDate}/jobs/...`.
  - Backfill: `TimeSeriesJobType.BACKFILL`, docs under `backfill-runs/{runId}/jobs/...`.
- **Mode & output size**
  - Realtime: `mode=COMPACT` → `OutputSize.COMPACT`.
  - Backfill: `mode=FULL_BACKFILL` → `OutputSize.FULL` + destructive delete first.
- **Aggregators & side effects**
  - Realtime aggregator drives:
    - `system/time-series-status`.
    - Run-level `partner-data-ready` messages (RS contract).
    - Optional `partner-symbols-ready` stream.
  - Backfill aggregator only updates `backfill-runs/*`; **no partner Pub/Sub**.
- **Error fields**
  - Realtime jobs record `lastError` for operator visibility; backfill jobs currently do not.

---

## 6. Environment Flags & Safety Belts

Key env vars:

- `TS_TIME_SERIES_TASKS_ENABLED`
  - Gates **both** schedulers enqueueing and worker execution outside the emulator.
  - When `false`, jobs may be created but **tasks are not enqueued** and the worker early-returns in non-emulator environments.
- `TS_JOB_PIPELINE_ENABLED_DAILY_POST`
  - Controls whether daily POST schedulers populate job docs.
- `TS_JOB_TEST_SYMBOL`
  - Comma-separated list of symbols to restrict job creation / enqueue during rollouts.

Operationally:

- Enable job doc creation first (pipeline in "shadow" mode).
- Then enable `TS_TIME_SERIES_TASKS_ENABLED` to allow Cloud Tasks to run.
- When confident, remove test symbol filters.

---

## 7. How This Relates to RS

- RS’s **authoritative contract** remains:
  - Run-level Pub/Sub messages on `partner-data-ready` with `runType = "ts-post-all-intervals"`.
  - HTTPS reads via `partnerTimeSeriesV2`.
- The job pipeline provides:
  - Stronger internal guarantees that **every symbol** for the RS universe is either refreshed or explicitly marked as permanent failure for the day.
  - Clear, queryable job state for operators and health dashboards.
- Full backfills:
  - Use the same worker & AV handlers, but run in a separate namespace (`backfill-runs/*`).
  - Are invisible to RS in terms of cadence; RS simply sees corrected history via `partnerTimeSeriesV2` after backfills complete.
