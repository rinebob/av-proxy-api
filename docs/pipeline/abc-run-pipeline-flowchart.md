# ABC Run Pipeline — Complete Flow

### Related Documents

| Document | Purpose | Audience |
|----------|---------|----------|
| **`pipeline/time-series-job-pipeline-plan.md`** | Design rationale, architecture decisions, migration plan, and future work. The "why + what". | Internal SA engineers |
| **`pipeline/time-series-job-pipeline-deep-dive.md`** | Technical appendix with concrete TypeScript types, code paths, Firestore shapes, and step-by-step algorithms. The "how". | Internal + RS engineering |
| **`partner/rs-partner-integration.md`** | Consumer-facing contract: Pub/Sub payloads, subscription filters, `includeSymbols`/`excludeSymbols` semantics, HTTPS endpoints, quick start. | RS backend engineers |
| **`pipeline/abc-run-pipeline-flowchart.md`** (this doc) | Mermaid flowcharts documenting the A/B/C pipeline visually with filenames and function names. | Internal + RS engineering |

---

## Schedule Summary

| Run | Cron (ET) | Scheduler Function | Sequence | clockEt |
|-----|-----------|-------------------|----------|---------|
| **A** | `35 16 * * 1-5` (4:35 PM) | `refreshAvTimeSeriesPostAllIntervals` | `A` | `1635` |
| **B** | `0 21 * * 1-5` (9:00 PM) | `refreshAvDailyTimeSeriesPostEveningRetry00` | `B` | `2100` |
| **C** | `0 7 * * 1-5` (7:00 AM next day) | `refreshAvDailyTimeSeriesPostMorning0700` | `C` | `0700` |

### Key Files

| File | Purpose |
|------|---------|
| `function-schedules.ts` | Cron schedule constants |
| `av-time-series-refresh-manager.ts` | Scheduler entry points, orchestrator, job creation |
| `runid-factory.ts` | Run ID generation, validation, parsing |
| `time-series-jobs.task.ts` | Cloud Task entry point |
| `time-series-jobs.worker.ts` | Worker: fetches AV data, determines freshness, updates job/run docs |
| `realtime-run-aggregator.ts` | Aggregator: increments run counters, detects completion, publishes PDR |
| `job-config.ts` | Constants (MAX_JOB_ATTEMPTS, batch sizes, rate limits) |
| `time-series-jobs.model.ts` | TypeScript interfaces and enums |

---

## 1. Scheduler to Orchestrator

```mermaid
flowchart TD
    A_SCHED["`**A Run** 4:35 PM ET
    refreshAvTimeSeriesPostAllIntervals
    sequence=A, clockEt=1635`"]
    B_SCHED["`**B Run** 9:00 PM ET
    refreshAvDailyTimeSeriesPostEveningRetry00
    sequence=B, clockEt=2100`"]
    C_SCHED["`**C Run** 7:00 AM ET next day
    refreshAvDailyTimeSeriesPostMorning0700
    sequence=C, clockEt=0700`"]

    C_SCHED --> C_QUERY{"`getLatestRetryRunMarketDateForInterval
    finds previous B run marketDate`"}
    C_QUERY -->|found| ORCH["`**runAllTimeSeriesIntervalsPost**`"]
    C_QUERY -->|not found| C_SKIP["`Early return, no-op`"]

    A_SCHED --> ORCH
    B_SCHED --> ORCH

    ORCH --> DERIVE["`Derive effectiveMarketDate, dow
    runTypeValue: A=initial, B/C=retry
    isDeadlineRun = sequence===C`"]
    DERIVE --> BUILD["`buildRealtimeIntervalRunId x3
    monthlyRunId, weeklyRunId, dailyRunId
    via RunIdFactory.createRealtime`"]
    BUILD --> INIT["`Init 3 run docs in Firestore
    realtime-runs/runId
    createdJobs=0, status=IN_PROGRESS`"]
    INIT --> INTERVALS["`Process MONTHLY then WEEKLY then DAILY`"]
```

## 2. Per-Interval Branching: A Run vs B/C Retry

```mermaid
flowchart TD
    START["`Per-interval processing`"] --> IS_A{"`sequence===A
    OR hasExplicitSymbols?`"}

    IS_A -->|YES A run| FULL["`Fetch full tracked-symbols
    from Firestore collection`"]
    IS_A -->|NO B/C run| RETRY["`getRetrySymbolsForInterval`"]

    RETRY --> SRC["`sourceSequence:
    B reads A, C reads B
    sourceClockEt: A=1635, B=2100`"]
    SRC --> READ["`Read source run doc
    realtime-runs/sourceRunId
    get retrySymbols array`"]

    READ --> HAS{"`retrySymbols.length > 0?`"}
    HAS -->|Yes| USE["`Use retrySymbols as symbol list
    Write retrySymbols to run doc`"]
    HAS -->|No| DONE["`Mark run COMPLETE
    createdJobs=0, no jobs created`"]

    FULL --> JOBS["`**runTimeSeriesJobsForEndpoint**`"]
    USE --> JOBS
```

## 3. Job Creation Loop

```mermaid
flowchart TD
    JOBS["`**runTimeSeriesJobsForEndpoint**`"] --> BATCH["`Batch symbols BATCH_SIZE=10
    Promise.all per batch`"]
    BATCH --> CREATE["`**createRealtimeRunJobAndEnqueueTask**
    per symbol`"]

    CREATE --> TX_CHECK{"`Job doc exists
    in Firestore?`"}
    TX_CHECK -->|No| NEW["`Create job doc
    status=Pending, attempts=0
    createdNewJob=true`"]
    TX_CHECK -->|Yes terminal| SKIP["`skippedForRun=true`"]
    TX_CHECK -->|Yes non-terminal| UPDATE["`Update job doc
    createdNewJob=false`"]

    NEW --> INC_YES["`createdJobs: FieldValue.increment 1`"]
    SKIP --> INC_SKIP["`skippedSymbolsCount: FieldValue.increment 1`"]
    UPDATE --> ENQUEUE_CHECK

    INC_YES --> ENQUEUE_CHECK{"`TS_TIME_SERIES_TASKS_ENABLED?`"}
    ENQUEUE_CHECK -->|Yes| ENQUEUE["`Enqueue Cloud Task
    payload: marketDate, symbol, endpoint
    phase, jobType, runId, deadlineRun`"]
    ENQUEUE_CHECK -->|No| SKIP_ENQ["`Skip enqueue
    job doc still created`"]
```

## 4. Worker: Fetch Data and Determine Freshness

```mermaid
flowchart TD
    TASK["`**processTimeSeriesJobTask**
    time-series-jobs.task.ts`"] --> WORKER["`**processTimeSeriesJobInternal**
    time-series-jobs.worker.ts`"]

    WORKER --> GATE{"`TS_TIME_SERIES_TASKS_ENABLED
    or FUNCTIONS_EMULATOR?`"}
    GATE -->|No| BAIL["`Return early`"]
    GATE -->|Yes| LOAD["`Load job doc
    realtime-runs/runId/jobs/jobId`"]

    LOAD --> STATUS{"`Current job status?`"}
    STATUS -->|SUCCESS or PERMANENT_FAILURE| NOOP["`No-op idempotent`"]
    STATUS -->|Pending or TransientFailure| PROGRESS["`Mark IN_PROGRESS
    bump attempts`"]

    PROGRESS --> FETCH["`handler.fetch symbol outputsize phase
    AlphaVantageHandlerFactory.createHandler`"]
    FETCH --> VERIFY["`Read lastBarTs from sa-time-series
    Compare to marketDate midnight`"]

    VERIFY --> FRESH{"`dataFreshness?`"}
    FRESH -->|FRESH| FRESH_OK["`status=SUCCESS
    retrySymbols -= symbol
    staleSymbols -= symbol
    retrySuccessSymbols += symbol`"]
    FRESH -->|STALE| DEADLINE{"`deadlineRun? C run?`"}
    FRESH -->|UNKNOWN| STALE_OK

    DEADLINE -->|Yes| THROW["`throw STALE_AT_DEADLINE
    goes to error path`"]
    DEADLINE -->|No| STALE_OK["`status=SUCCESS
    retrySymbols += symbol
    staleSymbols += symbol`"]

    FRESH_OK --> AGG["`**onRealtimeRunJobTerminal** SUCCESS`"]
    STALE_OK --> AGG
```

## 5. Error and Retry Path

```mermaid
flowchart TD
    ERR["`catch error
    Record lastError on job doc`"] --> CHECK{"`attempts >= MAX_JOB_ATTEMPTS 5?`"}
    CHECK -->|Yes| PERM["`status=PERMANENT_FAILURE
    **onRealtimeRunJobTerminal** PERMANENT_FAILURE`"]
    CHECK -->|No| TRANSIENT["`status=TransientFailure
    throw error, Cloud Tasks retries`"]
```

## 6. Run Aggregator and Completion

```mermaid
flowchart TD
    AGG["`**onRealtimeRunJobTerminal**
    realtime-run-aggregator.ts`"] --> TX{"`Terminal status?`"}

    TX -->|SUCCESS| S["`successJobs++, finishedJobs++`"]
    TX -->|PERMANENT_FAILURE| F["`permanentFailureJobs++, finishedJobs++
    permanentFailureSymbols += symbol
    retrySymbols += symbol`"]

    S --> READ["`Read run doc
    created=createdJobs
    finished=finishedJobs`"]
    F --> READ

    READ --> FAST{"`created > 0 AND
    finished === created?`"}
    FAST -->|Yes| COMPLETE["`status=COMPLETE
    runFinishedAt, totalDuration`"]
    FAST -->|No| WINDOW{"`Outside MAX_RUN_DURATION
    60 min window?`"}
    WINDOW -->|Yes| RECONCILE["`**reconcileRunJobs**
    Re-count from jobs subcollection
    Force-complete`"]
    WINDOW -->|No| WAIT["`Wait for more jobs`"]

    COMPLETE --> PDR["`Build Partner Data Ready message`"]
    RECONCILE --> PDR

    PDR --> PDR_TYPE{"`Run type?`"}
    PDR_TYPE -->|A run| PDR_A["`excludeSymbols = retrySymbols`"]
    PDR_TYPE -->|B/C run| PDR_BC["`includeSymbols = retrySuccessSymbols`"]
    PDR_A --> SEND["`**enqueueDataReadyInternal**`"]
    PDR_BC --> SEND
```

## Run ID Format

```
YYYY-MM-DD-DOW-SEQ-INTERVAL-LIVE|MANUAL-POST-HHMM
```

**Example:** `2026-02-13-FRI-A-DAILY-LIVE-POST-1635`

Generated by `RunIdFactory.createRealtime()` in `runid-factory.ts`.

## Firestore Document Structure

```
realtime-runs/
  {runId}/                          ← Run document
    runId, runType, sequence, marketDate, phase, interval, trigger
    status: IN_PROGRESS | COMPLETE
    createdJobs, finishedJobs, successJobs, permanentFailureJobs
    retrySymbols[], staleSymbols[], retrySuccessSymbols[]
    partnerDataReady: { messageSent, sendTime, messagePayload }
    runCreatedAt, runStartedAt, runFinishedAt, totalDuration
    jobsCreationStartedAt, jobsCreationCompletedAt

    jobs/                           ← Job subcollection
      {SYMBOL-ENDPOINT-phase}/      ← Job document
        symbol, endpoint, interval, phase
        status: Pending | InProgress | Success | TransientFailure | PermanentFailure
        attempts, createdAt, updatedAt, firstAttemptedAt, lastAttemptAt
        dataFreshness: FRESH | STALE | UNKNOWN
        periodStatus: IN_PROGRESS | PERIOD_END
        lastError?
```

## Retry Symbol Flow

```mermaid
flowchart LR
    subgraph A_RUN["`**A Run** 4:35 PM`"]
        A_WORKER["`Worker processes symbol`"]
        A_STALE["`STALE: retrySymbols += symbol`"]
        A_FRESH["`FRESH: retrySymbols -= symbol`"]
        A_PFAIL["`PERMANENT_FAILURE: retrySymbols += symbol`"]
        A_WORKER --> A_STALE
        A_WORKER --> A_FRESH
        A_WORKER --> A_PFAIL
    end

    subgraph B_RUN["`**B Run** 9:00 PM`"]
        B_LOOKUP["`getRetrySymbolsForInterval
        Reads A run doc retrySymbols`"]
        B_PROCESS["`Process only those symbols`"]
        B_LOOKUP --> B_PROCESS
    end

    subgraph C_RUN["`**C Run** 7:00 AM next day`"]
        C_LOOKUP["`getLatestRetryRunMarketDateForInterval
        Finds B run marketDate`"]
        C_RETRY["`getRetrySymbolsForInterval
        Reads B run doc retrySymbols`"]
        C_PROCESS["`Process only those symbols
        deadlineRun=true
        STALE throws PERMANENT_FAILURE`"]
        C_LOOKUP --> C_RETRY --> C_PROCESS
    end

    A_RUN -->|retrySymbols on A doc| B_LOOKUP
    B_RUN -->|retrySymbols on B doc| C_RETRY
```
