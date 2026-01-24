# Backfill vs Realtime: Complete Separation Architecture

**Principle:** Backfill is a one-time operation. Realtime is forever. They should never share Firestore paths.

**Key Insight:** Separate Firestore paths for job tracking = zero interference. Both systems write to the same `symbol-data` paths.

---

## Firestore Path Separation

### Realtime (Production System)

```
time-series-jobs/
  {marketDate}/              # e.g., "2026-01-23"
    jobs/
      {symbol-endpoint-phase}/
        - symbol, endpoint, interval, phase
        - status, attempts, lastError
        - createdAt, updatedAt
    
    # Date-level summary
    - marketDate
    - totalJobs
    - successJobs
    - permanentFailureJobs
    - status: 'IN_PROGRESS' | 'COMPLETE'
    - dataReadyPublished
```

### Backfill (One-Time Operation)

```
backfill-jobs/
  {runId}/                   # e.g., "2026-01-23-DAILY-FULL_BACKFILL"
    jobs/
      {symbol}/              # Just symbol, since endpoint is in runId
        - symbol
        - status, attempts, lastError
        - createdAt, updatedAt
    
    # Run-level summary
    - runId
    - endpoint: 'TIME_SERIES_DAILY_ADJUSTED'
    - interval: 'daily'
    - expectedJobs: 762      # IMMUTABLE (one endpoint only)
    - successJobs: 0
    - permanentFailureJobs: 0
    - status: 'IN_PROGRESS' | 'COMPLETE'
    - runStartedAt
    - runCompletedAt
```

**Key:** Completely different root collections. Zero overlap.

---

## What Code Can Be Reused?

### ✅ Can Reuse (Worker Logic)

The **Cloud Tasks worker** that processes a single symbol can be 100% reused:

```typescript
// This function doesn't care about Firestore paths
async function processTimeSeriesJob(params: {
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  marketDate: string;
}): Promise<{ success: boolean; error?: string }> {
  // 1. Call Alpha Vantage API
  // 2. Transform data
  // 3. Write to symbol-data/{symbol}/sa-time-series/...
  // 4. Return success/failure
}
```

This is pure business logic. It doesn't know about job tracking.

---

### ❌ Cannot Reuse (Job Management)

Everything that touches Firestore job docs must be separate:

| Function | Realtime Path | Backfill Path |
|----------|---------------|---------------|
| **Create jobs** | `time-series-jobs/{date}/jobs/{id}` | `backfill-jobs/{runId}/jobs/{symbol}` |
| **Update job status** | `time-series-jobs/{date}/jobs/{id}` | `backfill-jobs/{runId}/jobs/{symbol}` |
| **Aggregate counters** | `time-series-jobs/{date}` | `backfill-jobs/{runId}` |
| **Check completion** | `time-series-jobs/{date}` | `backfill-jobs/{runId}` |

---

## Implementation: Two Parallel Systems

### System 1: Realtime (Keep Existing)

**Entry Point:** `runTimeSeriesJobsForEndpoint()` (scheduler)

**Flow:**
1. Scheduler runs daily at 16:00 ET
2. Creates jobs in `time-series-jobs/{today}/jobs/...`
3. Enqueues Cloud Tasks to `time-series-job` queue
4. Worker calls `processTimeSeriesJob()` (shared logic)
5. Worker updates job status in `time-series-jobs/{today}/jobs/...`
6. Aggregator (Firestore trigger) updates `time-series-jobs/{today}` counters
7. When complete, publishes `partner-data-ready` event

**Files:**
- `av-time-series-refresh-manager.ts` (scheduler)
- `time-series-job.worker.ts` (Cloud Tasks handler)
- `time-series-job-aggregator.ts` (Firestore trigger)

---

### System 2: Backfill (New, Separate)

**Entry Point:** `triggerFullBackfillJobs()` (HTTP)

**Flow:**
1. Admin calls HTTP endpoint with `{ includeWeekly, includeMonthly }`
2. Creates run docs in `backfill-jobs/{runId}` (one per endpoint)
3. Creates job docs in `backfill-jobs/{runId}/jobs/{symbol}`
4. Enqueues Cloud Tasks to **same queue** `time-series-job` (rate limiting)
5. Worker calls `processTimeSeriesJob()` (shared logic)
6. Worker updates job status in `backfill-jobs/{runId}/jobs/{symbol}`
7. Aggregator (Firestore trigger) updates `backfill-jobs/{runId}` counters
8. When complete, logs completion (no Pub/Sub needed)

**Files (New):**
- `av-full-backfill-controller.ts` (HTTP + job creation)
- `backfill-job-aggregator.ts` (Firestore trigger)

---

## Detailed Design

### 1. Backfill Controller (HTTP)

**Path:** `functions/src/v2/alpha-vantage/backfill/av-full-backfill-controller.ts`

```typescript
export const triggerFullBackfillJobs = onRequest({
  timeoutSeconds: 60,
  secrets: ['ARCHIVE_FULL_BACKFILL_ADMIN_SECRET'],
}, async (req, res) => {
  // Auth check...
  
  const { includeWeekly, includeMonthly } = req.body;
  const marketDate = getCurrentMarketDate();
  
  const endpoints = [
    AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
  ];
  if (includeWeekly) endpoints.push(AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED);
  if (includeMonthly) endpoints.push(AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED);
  
  // Get all tracked symbols
  const symbolsSnap = await db.collection('tracked-symbols').get();
  const symbols = symbolsSnap.docs.map(d => d.id);
  
  const runIds: string[] = [];
  
  for (const endpoint of endpoints) {
    const runId = `${marketDate}-${AlphaVantageEndpoint[endpoint]}-FULL_BACKFILL`;
    runIds.push(runId);
    
    // 1. Create run doc
    await db.doc(`backfill-jobs/${runId}`).set({
      runId,
      endpoint: AlphaVantageEndpoint[endpoint],
      interval: getIntervalForEndpoint(endpoint),
      marketDate,
      expectedJobs: symbols.length,  // IMMUTABLE
      successJobs: 0,
      permanentFailureJobs: 0,
      status: 'IN_PROGRESS',
      runStartedAt: Timestamp.now(),
    });
    
    // 2. Create job docs + enqueue tasks
    const queue = getFunctions().taskQueue('time-series-job');
    
    for (const symbol of symbols) {
      // Create job doc
      await db.doc(`backfill-jobs/${runId}/jobs/${symbol}`).set({
        symbol,
        status: 'PENDING',
        attempts: 0,
        createdAt: Timestamp.now(),
      });
      
      // Enqueue task (same queue as realtime for rate limiting)
      await queue.enqueue({
        jobType: 'backfill',  // NEW: tells worker which path to update
        runId,
        symbol,
        endpoint,
        marketDate,
      });
    }
  }
  
  res.status(202).json({ ok: true, runIds });
});
```

**Key Points:**
- Creates run doc **before** job docs
- `expectedJobs` is set once and never changes
- Uses same Cloud Tasks queue for rate limiting
- Adds `jobType: 'backfill'` to task payload

---

### 2. Unified Worker (Reuses Existing Logic)

**Path:** `functions/src/v2/alpha-vantage/jobs/time-series-job.worker.ts`

```typescript
export const processTimeSeriesJobTask = onTaskDispatched({
  retryConfig: { maxAttempts: 5 },
  rateLimits: {
    maxConcurrentDispatches: 75,
    maxDispatchesPerSecond: 1.25,
  },
}, async (req) => {
  const { jobType, runId, symbol, endpoint, marketDate } = req.data;
  
  // Determine job doc path based on jobType
  let jobDocPath: string;
  if (jobType === 'backfill') {
    jobDocPath = `backfill-jobs/${runId}/jobs/${symbol}`;
  } else {
    // Realtime
    const jobId = `${symbol}-${endpoint}-POST`;
    jobDocPath = `time-series-jobs/${marketDate}/jobs/${jobId}`;
  }
  
  const jobRef = db.doc(jobDocPath);
  
  // Update: IN_PROGRESS
  await jobRef.update({
    status: 'IN_PROGRESS',
    attempts: FieldValue.increment(1),
    lastAttemptAt: Timestamp.now(),
  });
  
  try {
    // SHARED BUSINESS LOGIC (doesn't care about job tracking)
    const result = await processTimeSeriesJob({
      symbol,
      endpoint,
      marketDate,
    });
    
    if (result.success) {
      await jobRef.update({
        status: 'SUCCESS',
        updatedAt: Timestamp.now(),
      });
    } else {
      await jobRef.update({
        status: 'PERMANENT_FAILURE',
        lastError: result.error,
        updatedAt: Timestamp.now(),
      });
    }
  } catch (error) {
    await jobRef.update({
      status: 'TRANSIENT_FAILURE',
      lastError: String(error),
      updatedAt: Timestamp.now(),
    });
    throw error; // Cloud Tasks will retry
  }
});
```

**Key Points:**
- Single worker handles both job types
- Routes to correct Firestore path based on `jobType`
- Calls shared `processTimeSeriesJob()` for business logic

---

### 3. Backfill Aggregator (New)

**Path:** `functions/src/v2/alpha-vantage/backfill/backfill-job-aggregator.ts`

```typescript
export const aggregateBackfillJob = onDocumentWritten(
  'backfill-jobs/{runId}/jobs/{symbol}',
  async (event) => {
    const runId = event.params.runId;
    const afterData = event.data?.after?.data();
    const beforeData = event.data?.before?.data();
    
    if (!afterData) return; // Deleted
    
    const beforeStatus = beforeData?.status;
    const afterStatus = afterData.status;
    
    // Only aggregate terminal transitions
    if (beforeStatus === afterStatus) return;
    if (afterStatus !== 'SUCCESS' && afterStatus !== 'PERMANENT_FAILURE') return;
    
    const runRef = db.doc(`backfill-jobs/${runId}`);
    
    // Increment counters
    if (afterStatus === 'SUCCESS') {
      await runRef.update({
        successJobs: FieldValue.increment(1),
      });
    } else if (afterStatus === 'PERMANENT_FAILURE') {
      await runRef.update({
        permanentFailureJobs: FieldValue.increment(1),
      });
    }
    
    // Check completion
    const runSnap = await runRef.get();
    const runData = runSnap.data();
    
    const expected = runData?.expectedJobs || 0;
    const success = runData?.successJobs || 0;
    const failure = runData?.permanentFailureJobs || 0;
    
    if (success + failure >= expected && runData?.status !== 'COMPLETE') {
      await runRef.update({
        status: 'COMPLETE',
        runCompletedAt: Timestamp.now(),
      });
      
      console.log(`Backfill run ${runId} COMPLETE: ${success}/${expected} succeeded`);
    }
  }
);
```

**Key Points:**
- Separate trigger path: `backfill-jobs/{runId}/jobs/{symbol}`
- Updates `backfill-jobs/{runId}` counters
- No Pub/Sub (backfill is admin-only, just log completion)

---

### 4. Realtime Aggregator (Keep Existing)

**Path:** `functions/src/v2/alpha-vantage/jobs/time-series-job-aggregator.ts`

**No changes needed.** It already listens to `time-series-jobs/{date}/jobs/{id}` and updates `time-series-jobs/{date}`.

---

## What Gets Reused vs New

### ✅ Reused (No Changes)

1. **Worker business logic:** `processTimeSeriesJob()` - calls AV API, writes to `symbol-data`
2. **Cloud Tasks queue:** Same `time-series-job` queue (rate limiting)
3. **Realtime scheduler:** `runTimeSeriesJobsForEndpoint()`
4. **Realtime aggregator:** `time-series-job-aggregator.ts`
5. **Data writes:** Both write to same `symbol-data/{symbol}/sa-time-series/...` paths

### 🆕 New (Backfill Only)

1. **Backfill controller:** `av-full-backfill-controller.ts` (HTTP endpoint)
2. **Backfill aggregator:** `backfill-job-aggregator.ts` (Firestore trigger)
3. **Worker routing logic:** Add `jobType` check to route to correct Firestore path

### 📝 Modified (Small Changes)

1. **Worker:** Add `jobType` parameter and path routing logic
2. **HTTP trigger:** Replace current `triggerFullBackfillJobs` with new implementation

---

## Migration Steps

### Step 1: Create Backfill System (Parallel)

1. Create `functions/src/v2/alpha-vantage/backfill/` directory
2. Implement `av-full-backfill-controller.ts`
3. Implement `backfill-job-aggregator.ts`
4. Modify worker to handle `jobType` routing

### Step 2: Test in Emulator

1. Call backfill HTTP endpoint
2. Verify jobs created in `backfill-jobs/{runId}/jobs/...`
3. Verify counters updated in `backfill-jobs/{runId}`
4. Verify completion detection

### Step 3: Run One-Time Backfill

1. Deploy to production
2. Trigger backfill for DAILY/WEEKLY/MONTHLY
3. Monitor `backfill-jobs/` collection
4. Verify data written to `symbol-data/`

### Step 4: Cleanup (Optional)

After backfill completes:
- Archive `backfill-jobs/` collection (export to GCS)
- Remove backfill code (or keep for future use)

---

## Summary

**Before:** Shared `time-series-jobs/{date}` → confusion, moving counters, false completions

**After:** 
- Realtime: `time-series-jobs/{date}/...` (production system)
- Backfill: `backfill-jobs/{runId}/...` (one-time operation)
- Zero overlap, zero confusion

**Reuse:** Worker business logic (AV API calls, data writes)

**New:** Job tracking for backfill (controller, aggregator)

**Effort:** ~2-3 new files, ~50 lines modified in worker

2. **Realtime runs are date-scoped:**
   - `time-series-jobs/{marketDate}` tracks all jobs for that date (any mode).
   - Realtime completion is based on jobs with `mode != FullBackfill`.
   - Multiple realtime runs (retries, evening runs) can safely update the same date doc.

3. **Job docs link to their parent run:**
   - Each job doc has a `runId` field.
   - Backfill jobs have `mode: 'FULL_BACKFILL'` and `runId: '{runId}'`.
   - Realtime jobs have `mode: 'COMPACT'` (or undefined) and `runId: '{date-based-id}'`.

4. **Aggregators are run-aware:**
   - The job aggregator reads `runId` and `mode` from each job.
   - Backfill job updates increment counters on `backfill-runs/{runId}`.
   - Realtime job updates increment counters on `time-series-jobs/{marketDate}`.

---

## Data Model

### 1. Job Documents (Unchanged Location)

**Path:** `time-series-jobs/{marketDate}/jobs/{symbol-endpoint-phase}`

**Fields:**
```typescript
{
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  interval: TimeSeriesInterval;
  phase: TradingPhase;
  status: TimeSeriesJobStatus;
  attempts: number;
  lastError?: string;
  
  // NEW: Links this job to its parent run
  runId: string;
  runType: 'realtime' | 'backfill';
  
  // Execution mode
  mode?: TimeSeriesJobMode; // 'COMPACT' | 'FULL_BACKFILL'
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastAttemptAt?: Timestamp;
  finalizedAtMs?: number;
}
```

**Key Changes:**
- Add `runId` (required): Links job to its parent run.
- Add `runType` (required): Explicit marker for aggregation routing.
- Keep `mode` for worker behavior (COMPACT vs FULL_BACKFILL).

---

### 2. Date-Level Summary (Realtime Runs Only)

**Path:** `time-series-jobs/{marketDate}`

**Fields:**
```typescript
{
  marketDate: string;
  phase: string; // 'post', 'pre'
  
  // Realtime run tracking
  realtimeRunIds: string[]; // List of all realtime runIds for this date
  latestRealtimeRunId: string; // Most recent realtime run
  
  // Counters for REALTIME jobs only (mode != FULL_BACKFILL)
  realtimeTotalJobs: number;
  realtimeSuccessJobs: number;
  realtimePermanentFailureJobs: number;
  
  // Overall date status (for realtime runs)
  status: 'IN_PROGRESS' | 'COMPLETE';
  
  // Symbols processed by realtime runs
  realtimeSymbols: Record<string, {
    daily?: 'success' | 'failure';
    weekly?: 'success' | 'failure';
    monthly?: 'success' | 'failure';
  }>;
  
  // Pub/Sub event tracking
  dataReadyPublished: boolean;
  dataReadyPublishedAt?: Timestamp;
  
  runStartedAt?: Timestamp;
  runCompletedAt?: Timestamp;
  
  // Metadata: total jobs across ALL modes (for diagnostics only)
  _allJobsTotal?: number;
  _allJobsSuccess?: number;
  _allJobsPermanentFailure?: number;
}
```

**Key Changes:**
- Prefix realtime counters with `realtime*` to make scope explicit.
- Add `realtimeRunIds` array to track multiple realtime runs per date.
- Keep `_allJobs*` fields for diagnostics but don't use for completion logic.
- Remove `totalJobs`, `successJobs`, `permanentFailureJobs` (ambiguous).

**Completion Logic (Realtime):**
```typescript
const isComplete = 
  realtimeSuccessJobs + realtimePermanentFailureJobs >= realtimeTotalJobs;
```

---

### 3. Backfill Run Documents (Run-Level Aggregation)

**Path:** `backfill-runs/{runId}`

**Fields:**
```typescript
{
  runId: string; // e.g., '2026-01-23-THU-POST-2-FULL_BACKFILL'
  runType: 'full_backfill';
  
  marketDate: string;
  endpoint: string; // 'TIME_SERIES_DAILY_ADJUSTED'
  interval: TimeSeriesInterval;
  phase: TradingPhase; // Always 'POST' for backfills
  
  // Immutable job count (set at run creation)
  expectedJobs: number;
  symbolCount: number;
  symbols: string[]; // Optional: list of symbols in this run
  
  // Run-level counters (incremented by aggregator)
  successJobs: number;
  permanentFailureJobs: number;
  transientFailureJobs: number;
  inProgressJobs: number;
  pendingJobs: number;
  
  // Completion tracking
  status: 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';
  
  // Timestamps
  runStartedAt: Timestamp;
  runCompletedAt?: Timestamp;
  lastJobUpdateAt?: Timestamp;
  
  // Metadata
  createdBy?: string; // 'system' | 'admin' | 'http-trigger'
  trigger?: string; // 'manual' | 'scheduled' | 'http'
}
```

**Completion Logic (Backfill):**
```typescript
const isComplete = successJobs + permanentFailureJobs >= expectedJobs;
const status = isComplete ? 'COMPLETE' : 'IN_PROGRESS';
```

**Key Properties:**
- `expectedJobs` is **immutable** after run creation.
- Counters are incremented only by the aggregator, never by job creators.
- `symbols` array is optional but useful for diagnostics.

---

### 4. Run Registry (Optional, for UI/Observability)

**Path:** `time-series-runs/{runId}`

**Purpose:** Unified view of all runs (realtime + backfill) for UI/dashboards.

**Fields:**
```typescript
{
  runId: string;
  runType: 'realtime' | 'backfill';
  marketDate: string;
  
  // For backfills
  endpoint?: string;
  interval?: TimeSeriesInterval;
  expectedJobs?: number;
  
  // For realtime
  intervals?: TimeSeriesInterval[]; // ['daily', 'weekly', 'monthly']
  
  status: 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';
  
  runStartedAt: Timestamp;
  runCompletedAt?: Timestamp;
  
  // Link to aggregation doc
  aggregationDocPath: string; // 'backfill-runs/{runId}' or 'time-series-jobs/{date}'
}
```

**Usage:**
- Query all runs: `time-series-runs` collection.
- Filter by type: `runType == 'backfill'`.
- Filter by date: `marketDate == '2026-01-23'`.
- UI can display both realtime and backfill runs in a unified timeline.

---

## Function Changes

### 1. Job Creation Functions

#### `createOrUpdateTimeSeriesJobAndMaybeEnqueueTask`

**Changes:**
1. Accept `runType: 'realtime' | 'backfill'` parameter.
2. Write `runId` and `runType` to job doc.
3. For **realtime** jobs:
   - Increment `realtimeTotalJobs` on date doc (if new job).
   - Add `runId` to `realtimeRunIds` array.
4. For **backfill** jobs:
   - Do NOT increment date doc counters.
   - Increment `_allJobsTotal` (diagnostics only).

**Pseudo-code:**
```typescript
async function createOrUpdateTimeSeriesJobAndMaybeEnqueueTask(params: {
  marketDate: string;
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  phase: TradingPhase;
  runId: string;
  runType: 'realtime' | 'backfill';
  mode?: TimeSeriesJobMode;
  // ...
}): Promise<void> {
  const { runType, runId, mode } = params;
  
  const jobRef = db.doc(getTimeSeriesJobDocPath(...));
  const dateRef = db.doc(`time-series-jobs/${marketDate}`);
  
  let createdNewJob = false;
  
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    
    if (!snap.exists) {
      // Create new job
      tx.set(jobRef, {
        symbol,
        endpoint,
        interval,
        phase,
        status: TimeSeriesJobStatus.Pending,
        attempts: 0,
        mode,
        runId,        // NEW
        runType,      // NEW
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      
      createdNewJob = true;
    } else {
      // Update existing job (backfill resets, realtime preserves)
      const data = snap.data();
      const isFullBackfill = mode === TimeSeriesJobMode.FullBackfill;
      
      tx.set(jobRef, {
        status: isFullBackfill ? TimeSeriesJobStatus.Pending : data.status,
        attempts: isFullBackfill ? 0 : data.attempts,
        mode,
        runId,        // NEW: Update to current run
        runType,      // NEW
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
    
    // Initialize date doc if needed
    if (!dateSnap.exists) {
      tx.set(dateRef, {
        marketDate,
        phase: 'post',
        status: 'IN_PROGRESS',
        realtimeRunIds: [],
        realtimeTotalJobs: 0,
        realtimeSuccessJobs: 0,
        realtimePermanentFailureJobs: 0,
        realtimeSymbols: {},
        dataReadyPublished: false,
      });
    }
  });
  
  // Outside transaction: increment counters
  if (createdNewJob) {
    if (runType === 'realtime') {
      // Increment realtime counters
      await dateRef.set({
        realtimeTotalJobs: FieldValue.increment(1),
        realtimeRunIds: FieldValue.arrayUnion(runId),
        latestRealtimeRunId: runId,
      }, { merge: true });
    } else {
      // Backfill: only increment diagnostic counter
      await dateRef.set({
        _allJobsTotal: FieldValue.increment(1),
      }, { merge: true });
    }
  }
  
  // Enqueue task...
}
```

---

#### `runTimeSeriesJobsForEndpoint` (Realtime Scheduler)

**Changes:**
1. Set `runType: 'realtime'`.
2. Generate realtime-specific `runId`: `{marketDate}-{DOW}-{PHASE}-{endpoint}-LIVE`.
3. Pass `runType` to job creator.

**Pseudo-code:**
```typescript
export async function runTimeSeriesJobsForEndpoint(options: {
  endpoint: AlphaVantageEndpoint;
  phase: TradingPhase;
  trigger: RefreshTrigger;
  marketDate?: string;
  symbols?: string[];
}): Promise<void> {
  // ... existing logic ...
  
  const runType = 'realtime';
  const runId = `${marketDate}-${dowStr}-${phaseStrUpper}-${endpoint}-LIVE`;
  
  for (const symbol of symbols) {
    await createOrUpdateTimeSeriesJobAndMaybeEnqueueTask({
      marketDate,
      symbol,
      endpoint,
      phase,
      runId,
      runType,        // NEW
      mode: undefined, // or TimeSeriesJobMode.Compact
      // ...
    });
  }
}
```

---

#### `enqueueFullBackfillJobsForEndpoint` (Backfill Controller)

**Changes:**
1. Set `runType: 'backfill'`.
2. Generate backfill-specific `runId`: `{marketDate}-{DOW}-POST-{endpoint}-FULL_BACKFILL`.
3. Create `backfill-runs/{runId}` doc **before** creating jobs.
4. Set `expectedJobs` to symbol count (immutable).
5. Pass `runType` to job creator.

**Pseudo-code:**
```typescript
export async function enqueueFullBackfillJobsForEndpoint(options: {
  endpoint: AlphaVantageEndpoint;
  marketDate?: string;
  symbols?: string[];
}): Promise<{ marketDate: string; runId: string; symbolCount: number; }> {
  // ... existing logic ...
  
  const runType = 'backfill';
  const runId = `${marketDate}-${dowStr}-POST-${endpoint}-FULL_BACKFILL`;
  
  // 1. Create backfill run doc FIRST
  const runDocRef = db.doc(`backfill-runs/${runId}`);
  await runDocRef.set({
    runId,
    runType: 'full_backfill',
    marketDate,
    endpoint: endpointName,
    interval: intervalForEndpoint,
    phase: TradingPhase.POST,
    expectedJobs: symbols.length,  // IMMUTABLE
    symbolCount: symbols.length,
    symbols,                        // Optional: store list
    successJobs: 0,
    permanentFailureJobs: 0,
    transientFailureJobs: 0,
    inProgressJobs: 0,
    pendingJobs: symbols.length,
    status: 'IN_PROGRESS',
    runStartedAt: Timestamp.now(),
    createdBy: 'http-trigger',
    trigger: 'manual',
  });
  
  // 2. Create jobs
  for (const symbol of symbols) {
    await createOrUpdateTimeSeriesJobAndMaybeEnqueueTask({
      marketDate,
      symbol,
      endpoint,
      phase: TradingPhase.POST,
      runId,
      runType,        // NEW
      mode: TimeSeriesJobMode.FullBackfill,
      // ...
    });
  }
  
  return { marketDate, runId, symbolCount: symbols.length };
}
```

**Critical:** The backfill run doc is created **before** jobs, so `expectedJobs` is known and immutable.

---

### 2. Aggregator Function

**Path:** `functions/src/v2/alpha-vantage/jobs/time-series-job-aggregator.ts`

**Current Behavior:**
- Firestore trigger on `time-series-jobs/{marketDate}/jobs/{jobId}`.
- Updates counters on `time-series-jobs/{marketDate}`.
- Publishes completion event when `successJobs + permanentFailureJobs === totalJobs`.

**New Behavior:**
- Read `runType` and `runId` from job doc.
- Route updates to correct aggregation doc:
  - **Realtime jobs** → update `time-series-jobs/{marketDate}`.
  - **Backfill jobs** → update `backfill-runs/{runId}`.
- Check completion independently for each run type.

**Pseudo-code:**
```typescript
export const aggregateTimeSeriesJob = onDocumentWritten(
  'time-series-jobs/{marketDate}/jobs/{jobId}',
  async (event) => {
    const afterData = event.data?.after?.data();
    const beforeData = event.data?.before?.data();
    
    if (!afterData) return; // Job deleted
    
    const { status, runId, runType, symbol, endpoint, interval } = afterData;
    const marketDate = event.params.marketDate;
    
    const beforeStatus = beforeData?.status;
    const afterStatus = status;
    
    // Only aggregate terminal transitions
    const isTerminalTransition = 
      beforeStatus !== afterStatus &&
      (afterStatus === 'SUCCESS' || afterStatus === 'PERMANENT_FAILURE');
    
    if (!isTerminalTransition) return;
    
    // Route to correct aggregation doc
    if (runType === 'realtime') {
      await aggregateRealtimeJob({
        marketDate,
        symbol,
        endpoint,
        interval,
        status: afterStatus,
        runId,
      });
    } else if (runType === 'backfill') {
      await aggregateBackfillJob({
        runId,
        symbol,
        endpoint,
        interval,
        status: afterStatus,
      });
    }
  }
);

async function aggregateRealtimeJob(params: {
  marketDate: string;
  symbol: string;
  endpoint: string;
  interval: string;
  status: string;
  runId: string;
}): Promise<void> {
  const { marketDate, symbol, endpoint, interval, status } = params;
  const dateRef = db.doc(`time-series-jobs/${marketDate}`);
  
  // Increment realtime counters
  const updates: any = {
    lastJobUpdateAt: Timestamp.now(),
  };
  
  if (status === 'SUCCESS') {
    updates.realtimeSuccessJobs = FieldValue.increment(1);
    updates[`realtimeSymbols.${symbol}.${interval}`] = 'success';
  } else if (status === 'PERMANENT_FAILURE') {
    updates.realtimePermanentFailureJobs = FieldValue.increment(1);
    updates[`realtimeSymbols.${symbol}.${interval}`] = 'failure';
  }
  
  await dateRef.set(updates, { merge: true });
  
  // Check completion
  const dateSnap = await dateRef.get();
  const dateData = dateSnap.data();
  
  const total = dateData?.realtimeTotalJobs || 0;
  const success = dateData?.realtimeSuccessJobs || 0;
  const failure = dateData?.realtimePermanentFailureJobs || 0;
  
  const isComplete = success + failure >= total;
  
  if (isComplete && dateData?.status !== 'COMPLETE') {
    await dateRef.set({
      status: 'COMPLETE',
      runCompletedAt: Timestamp.now(),
    }, { merge: true });
    
    // Publish realtime completion event
    await publishRealtimeRunComplete({ marketDate });
  }
}

async function aggregateBackfillJob(params: {
  runId: string;
  symbol: string;
  endpoint: string;
  interval: string;
  status: string;
}): Promise<void> {
  const { runId, status } = params;
  const runRef = db.doc(`backfill-runs/${runId}`);
  
  // Increment backfill counters
  const updates: any = {
    lastJobUpdateAt: Timestamp.now(),
  };
  
  if (status === 'SUCCESS') {
    updates.successJobs = FieldValue.increment(1);
    updates.pendingJobs = FieldValue.increment(-1);
  } else if (status === 'PERMANENT_FAILURE') {
    updates.permanentFailureJobs = FieldValue.increment(1);
    updates.pendingJobs = FieldValue.increment(-1);
  }
  
  await runRef.set(updates, { merge: true });
  
  // Check completion
  const runSnap = await runRef.get();
  const runData = runSnap.data();
  
  const expected = runData?.expectedJobs || 0;
  const success = runData?.successJobs || 0;
  const failure = runData?.permanentFailureJobs || 0;
  
  const isComplete = success + failure >= expected;
  
  if (isComplete && runData?.status !== 'COMPLETE') {
    await runRef.set({
      status: 'COMPLETE',
      runCompletedAt: Timestamp.now(),
    }, { merge: true });
    
    // Publish backfill completion event
    await publishBackfillRunComplete({ runId });
  }
}
```

**Key Points:**
- Aggregator routes updates based on `runType`.
- Realtime and backfill runs have independent completion logic.
- No shared counters between run types.

---

### 3. Completion Publishers

#### Realtime Run Completion

**Function:** `publishRealtimeRunComplete`

**Behavior:**
- Publishes to Pub/Sub topic: `partner-data-ready`.
- Payload includes `marketDate`, `intervals`, `symbolCount`.
- Only publishes once per date (check `dataReadyPublished` flag).

**Pseudo-code:**
```typescript
async function publishRealtimeRunComplete(params: {
  marketDate: string;
}): Promise<void> {
  const { marketDate } = params;
  const dateRef = db.doc(`time-series-jobs/${marketDate}`);
  
  // Check if already published
  const snap = await dateRef.get();
  if (snap.data()?.dataReadyPublished) return;
  
  // Publish event
  await pubsub.topic('partner-data-ready').publish({
    marketDate,
    runType: 'realtime',
    intervals: ['daily', 'weekly', 'monthly'],
    timestamp: new Date().toISOString(),
  });
  
  // Mark as published
  await dateRef.set({
    dataReadyPublished: true,
    dataReadyPublishedAt: Timestamp.now(),
  }, { merge: true });
}
```

---

#### Backfill Run Completion

**Function:** `publishBackfillRunComplete`

**Behavior:**
- Publishes to Pub/Sub topic: `backfill-run-complete`.
- Payload includes `runId`, `endpoint`, `symbolCount`.
- Publishes every time a backfill run completes (no dedup needed).

**Pseudo-code:**
```typescript
async function publishBackfillRunComplete(params: {
  runId: string;
}): Promise<void> {
  const { runId } = params;
  const runRef = db.doc(`backfill-runs/${runId}`);
  
  const snap = await runRef.get();
  const runData = snap.data();
  
  // Publish event
  await pubsub.topic('backfill-run-complete').publish({
    runId,
    runType: 'backfill',
    endpoint: runData?.endpoint,
    interval: runData?.interval,
    symbolCount: runData?.symbolCount,
    successJobs: runData?.successJobs,
    permanentFailureJobs: runData?.permanentFailureJobs,
    timestamp: new Date().toISOString(),
  });
}
```

---

## Migration Strategy

### Phase 1: Add New Fields (Non-Breaking)

1. **Update job creation functions:**
   - Add `runType` and `runId` fields to new jobs.
   - Keep writing to old counters (`totalJobs`, `successJobs`) for backward compatibility.

2. **Update date doc schema:**
   - Add `realtimeTotalJobs`, `realtimeSuccessJobs`, etc.
   - Keep old counters for now.

3. **Deploy aggregator changes:**
   - Read `runType` from jobs.
   - Write to both old and new counters (dual-write).

**Result:** New jobs have `runType`, old jobs still work.

---

### Phase 2: Backfill Run Docs

1. **Create `backfill-runs` collection:**
   - Update `enqueueFullBackfillJobsForEndpoint` to create run docs.
   - Set `expectedJobs` before creating jobs.

2. **Update aggregator:**
   - Route backfill job updates to `backfill-runs/{runId}`.
   - Continue dual-write for realtime jobs.

**Result:** Backfill runs are tracked independently.

---

### Phase 3: Switch Completion Logic

1. **Update realtime completion:**
   - Use `realtimeTotalJobs` instead of `totalJobs`.
   - Ignore backfill jobs in realtime completion checks.

2. **Update backfill completion:**
   - Use `backfill-runs/{runId}` counters.
   - Publish separate completion events.

**Result:** Completion logic is clean and separated.

---

### Phase 4: Remove Old Fields (Breaking)

1. **Stop writing to old counters:**
   - Remove `totalJobs`, `successJobs`, `permanentFailureJobs` from date docs.
   - Remove dual-write logic from aggregator.

2. **Update UI/dashboards:**
   - Query `backfill-runs` for backfill status.
   - Query `time-series-jobs/{date}` for realtime status.

**Result:** Clean, single-purpose data model.

---

## Querying Examples

### "Is today's realtime run complete?"

```typescript
const dateRef = db.doc(`time-series-jobs/2026-01-23`);
const snap = await dateRef.get();
const data = snap.data();

const isComplete = data?.status === 'COMPLETE';
const progress = `${data?.realtimeSuccessJobs || 0} / ${data?.realtimeTotalJobs || 0}`;
```

---

### "Is the WEEKLY backfill run complete?"

```typescript
const runId = '2026-01-23-THU-POST-TIME_SERIES_WEEKLY_ADJUSTED-FULL_BACKFILL';
const runRef = db.doc(`backfill-runs/${runId}`);
const snap = await runRef.get();
const data = snap.data();

const isComplete = data?.status === 'COMPLETE';
const progress = `${data?.successJobs || 0} / ${data?.expectedJobs || 0}`;
```

---

### "List all backfill runs for today"

```typescript
const runsSnap = await db.collection('backfill-runs')
  .where('marketDate', '==', '2026-01-23')
  .get();

for (const doc of runsSnap.docs) {
  const data = doc.data();
  console.log(`${data.endpoint}: ${data.successJobs}/${data.expectedJobs} (${data.status})`);
}
```

---

### "Show all runs (realtime + backfill) for today"

```typescript
// Realtime
const dateRef = db.doc(`time-series-jobs/2026-01-23`);
const dateSnap = await dateRef.get();
const realtimeData = dateSnap.data();

// Backfills
const backfillsSnap = await db.collection('backfill-runs')
  .where('marketDate', '==', '2026-01-23')
  .get();

console.log('Realtime:', realtimeData?.status, `${realtimeData?.realtimeSuccessJobs}/${realtimeData?.realtimeTotalJobs}`);

for (const doc of backfillsSnap.docs) {
  const data = doc.data();
  console.log(`Backfill (${data.endpoint}):`, data.status, `${data.successJobs}/${data.expectedJobs}`);
}
```

---

## Preventing "Stuck at N jobs" Behavior

### Problem Scenario (Current)

```
1. Live run: totalJobs=1406, successJobs=1406, status='COMPLETE'
2. Backfill starts: totalJobs=3692 (1406 + 2286)
3. Backfill jobs complete: successJobs=2500, totalJobs=3692, status='COMPLETE' (???)
```

### Solution (New Architecture)

```
1. Live run: realtimeTotalJobs=1406, realtimeSuccessJobs=1406, status='COMPLETE'
2. Backfill starts: creates backfill-runs/{runId} with expectedJobs=762
3. Backfill jobs complete: backfill-runs/{runId} shows successJobs=762, status='COMPLETE'
4. Date doc unchanged: realtimeTotalJobs=1406, realtimeSuccessJobs=1406, status='COMPLETE'
```

**Key Differences:**
- Backfill jobs don't increment `realtimeTotalJobs`.
- Date doc `status` reflects realtime completion only.
- Backfill completion is tracked in `backfill-runs/{runId}`.
- No shared counters → no confusion.

---

## Handling Overlapping Runs

### Scenario: Live Run + Backfill Running Simultaneously

**Timeline:**
```
16:00 ET: Live run starts (DAILY/WEEKLY/MONTHLY)
16:05 ET: Admin triggers full backfill (DAILY/WEEKLY/MONTHLY)
16:10 ET: Live run completes
16:45 ET: Backfill completes
```

**Behavior:**

1. **Live run (16:00):**
   - Creates jobs with `runType='realtime'`, `runId='2026-01-23-THU-POST-2-LIVE'`.
   - Increments `realtimeTotalJobs` on date doc.

2. **Backfill (16:05):**
   - Creates `backfill-runs/{runId}` with `expectedJobs=762`.
   - Creates jobs with `runType='backfill'`, `runId='2026-01-23-THU-POST-2-FULL_BACKFILL'`.
   - Does NOT increment `realtimeTotalJobs`.

3. **Live run completes (16:10):**
   - Date doc: `realtimeSuccessJobs=1406`, `realtimeTotalJobs=1406`, `status='COMPLETE'`.
   - Publishes `partner-data-ready` event.

4. **Backfill completes (16:45):**
   - Backfill run doc: `successJobs=762`, `expectedJobs=762`, `status='COMPLETE'`.
   - Publishes `backfill-run-complete` event.
   - Date doc unchanged (still shows realtime completion).

**Result:** Both runs complete independently without interfering.

---

## Rate Limiting and Cloud Tasks

**No changes required.** The Cloud Tasks queue (`time-series-job`) already handles rate limiting via `rateLimits` config:

```typescript
{
  maxConcurrentDispatches: 75,
  maxDispatchesPerSecond: 1.25, // ~75 per minute
}
```

Both realtime and backfill jobs are enqueued to the same queue, so the AV API limit is respected globally.

---

## UI/Dashboard Implications

### Health Dashboard

**Current View:**
- Shows `totalJobs`, `successJobs` for a date.
- Confusing when backfills run.

**New View:**
- **Realtime Tab:**
  - Shows `realtimeTotalJobs`, `realtimeSuccessJobs`.
  - Status: `COMPLETE` when realtime jobs finish.
- **Backfill Tab:**
  - Lists all backfill runs for the date.
  - Each run shows `expectedJobs`, `successJobs`, `status`.
  - Separate progress bars per endpoint.

**Example:**
```
Date: 2026-01-23

[Realtime Run]
Status: COMPLETE
Progress: 1406 / 1406 (100%)
Completed at: 16:10 ET

[Backfill Runs]
DAILY:   762 / 762 (100%) - COMPLETE
WEEKLY:  762 / 762 (100%) - COMPLETE
MONTHLY: 762 / 762 (100%) - COMPLETE
```

---

## Summary of Key Changes

| Component | Current | New |
|-----------|---------|-----|
| **Job docs** | No `runType` or `runId` | Add `runType`, `runId` |
| **Date doc counters** | `totalJobs`, `successJobs` (shared) | `realtimeTotalJobs`, `realtimeSuccessJobs` (realtime only) |
| **Backfill aggregation** | Uses date doc (shared) | Uses `backfill-runs/{runId}` (isolated) |
| **Completion logic** | `successJobs + failures === totalJobs` (ambiguous) | Separate logic per run type |
| **Pub/Sub events** | Single `partner-data-ready` | `partner-data-ready` (realtime), `backfill-run-complete` (backfill) |
| **Observability** | Date-level only | Date-level (realtime) + run-level (backfill) |

---

## Benefits

1. **Clear separation:** Backfill and realtime runs never interfere.
2. **Immutable expectations:** `expectedJobs` is fixed at run creation.
3. **Independent completion:** Each run type has its own completion logic.
4. **Better observability:** Query backfill runs independently.
5. **No "stuck at N jobs" behavior:** Counters are scoped to run type.
6. **Safe overlapping runs:** Multiple runs can coexist without confusion.

---

## Next Steps

1. **Review this design** with the team.
2. **Implement Phase 1** (add new fields, dual-write).
3. **Test with emulator** (create realtime + backfill runs, verify separation).
4. **Deploy to production** (gradual rollout).
5. **Update UI/dashboards** to use new data model.
6. **Remove old fields** (Phase 4) after validation.

---

## Appendix: RunId Formats

### Realtime Runs

**Format:** `{marketDate}-{DOW}-{PHASE}-{endpoint}-LIVE`

**Examples:**
- `2026-01-23-THU-POST-2-LIVE` (DAILY)
- `2026-01-23-THU-POST-3-LIVE` (WEEKLY)
- `2026-01-23-THU-POST-4-LIVE` (MONTHLY)

### Backfill Runs

**Format:** `{marketDate}-{DOW}-POST-{endpoint}-FULL_BACKFILL`

**Examples:**
- `2026-01-23-THU-POST-2-FULL_BACKFILL` (DAILY)
- `2026-01-23-THU-POST-3-FULL_BACKFILL` (WEEKLY)
- `2026-01-23-THU-POST-4-FULL_BACKFILL` (MONTHLY)

### Manual Runs

**Format:** `{marketDate}-{DOW}-{PHASE}-{endpoint}-MANUAL`

**Examples:**
- `2026-01-23-THU-POST-2-MANUAL` (triggered via HTTP)

---

**End of Document**
