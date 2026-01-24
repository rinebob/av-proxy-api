# Code Audit: Backfill vs Realtime Separation

**Date:** January 23, 2026  
**Purpose:** Validate the proposed two-path architecture against existing code

---

## Executive Summary

**Good news:** The existing code is well-structured and the proposed design is viable with minimal changes.

**Key finding:** The business logic is NOT cleanly separated. The worker (`processTimeSeriesJobInternal`) is tightly coupled to the realtime job tracking paths. We cannot simply "reuse" it - we need to refactor it first.

---

## Existing Code Structure

### 1. Worker (`time-series-jobs.worker.ts`)

**Function:** `processTimeSeriesJobInternal(payload: ProcessTimeSeriesJobPayload)`

**What it does:**
1. Reads job doc from `time-series-jobs/{date}/jobs/{id}` (line 110)
2. Updates job status to `IN_PROGRESS` (lines 135-152)
3. Calls `AlphaVantageHandlerFactory.createHandler(endpoint)` (line 157)
4. Calls `handler.fetch()` with symbol/outputsize (lines 176-183)
5. Verifies bar exists for marketDate (lines 190-207)
6. Updates job status to `SUCCESS` or `PERMANENT_FAILURE` (lines 216-224, 297-303)
7. Calls `onTimeSeriesJobTerminal()` aggregator (lines 250-255, 306-311)
8. Publishes `symbols-ready` event (lines 230-236)

**Critical issue:** The worker directly reads/writes to `time-series-jobs/{date}/jobs/{id}` paths. It's NOT a pure business logic function.

**What's actually reusable:**
- Lines 157-183: The AV API call logic (`handler.fetch()`)
- Lines 190-207: Bar verification logic

**What's NOT reusable:**
- Lines 110-152: Job doc path and status updates (hardcoded to realtime paths)
- Lines 216-224: Success status update (hardcoded path)
- Lines 250-255: Aggregator call (realtime-specific)
- Lines 297-311: Failure handling (hardcoded path)

---

### 2. Task Handler (`time-series-jobs.task.ts`)

**Function:** `processTimeSeriesJobTask` (Cloud Tasks entry point)

**What it does:**
- Receives `ProcessTimeSeriesJobPayload` from Cloud Tasks
- Calls `processTimeSeriesJobInternal(payload)`

**Payload structure:**
```typescript
interface ProcessTimeSeriesJobPayload {
  marketDate: string;
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  phase: TradingPhase;
  mode?: TimeSeriesJobMode; // 'COMPACT' | 'FULL_BACKFILL'
}
```

**Rate limits:**
- `maxConcurrentDispatches: 20`
- `maxDispatchesPerSecond: 1.0`
- Queue name: `time-series-job` (from CloudTask constant)

**Critical finding:** The payload does NOT include a `jobType` field. Adding it would be backward-compatible (optional field).

---

### 3. Aggregator (`time-series-jobs.aggregator.ts`)

**Function:** `onTimeSeriesJobTerminal(args: OnTimeSeriesJobTerminalArgs)`

**What it does:**
1. Reads `time-series-jobs/{marketDate}` doc (line 55)
2. Increments `successJobs` or `permanentFailureJobs` counters (lines 82-95)
3. Tracks per-symbol interval completion (lines 97-104)
4. Checks if `successJobs + permanentFailureJobs === totalJobs` (line 118)
5. If complete, sets `status: 'COMPLETE'` and publishes event (lines 118-124)

**Critical issue:** This is called directly by the worker (line 250, 306). It's realtime-specific.

**What's needed for backfill:**
- Separate aggregator function that updates `backfill-jobs/{runId}` instead
- Separate completion check based on `expectedJobs` (immutable)

---

### 4. Current Backfill System

**HTTP Endpoint:** `triggerFullBackfillJobs` (`av-full-backfill.http.ts`)

**What it does:**
1. Accepts `{ marketDate?, symbols?, includeWeekly, includeMonthly }`
2. Enqueues tasks to `CloudTask.FULL_BACKFILL_RUN` queue (line 69)
3. Enqueues one task per endpoint (DAILY/WEEKLY/MONTHLY)

**Task Handler:** `processFullBackfillRunTask` (`av-full-backfill.task.ts`)

**What it does:**
1. Receives `{ marketDate?, symbols?, endpoint }`
2. Calls `enqueueFullBackfillJobsForEndpoint()` (line 66)
3. That function (in `av-time-series-refresh-manager.ts`) creates jobs in `time-series-jobs/{date}/jobs/...` with `mode: 'FULL_BACKFILL'`

**Critical finding:** The current backfill system ALREADY creates jobs in the realtime path. This is the root cause of the confusion.

---

## Design Conflicts

### Conflict 1: Worker is not a pure function

**Proposed design assumed:**
```typescript
// Pure business logic (doesn't know about job tracking)
async function processTimeSeriesJob(params: {
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  marketDate: string;
}): Promise<{ success: boolean; error?: string }> {
  // Call AV API, write to symbol-data, return result
}
```

**Reality:**
The worker is tightly coupled to job tracking. It reads/writes job docs, calls aggregators, publishes events.

**Impact on design:**
We cannot "reuse" the worker as-is. We need to either:
1. **Refactor:** Extract the business logic into a pure function, then wrap it in two separate workers (realtime + backfill)
2. **Route:** Add `jobType` routing to the existing worker (like the design proposes)

**Recommendation:** Option 2 (routing) is simpler and less risky. Refactoring would be a large change.

---

### Conflict 2: Aggregator is called by worker

**Proposed design assumed:**
Aggregators are Firestore triggers that listen to job doc changes.

**Reality:**
The aggregator is a regular function called directly by the worker (not a trigger).

**Impact on design:**
We need to route the aggregator call based on job type:
```typescript
if (jobType === 'backfill') {
  await onBackfillJobTerminal({ runId, symbol, interval, status });
} else {
  await onTimeSeriesJobTerminal({ marketDate, symbol, interval, status });
}
```

**Recommendation:** This is fine. The routing logic is simple.

---

### Conflict 3: Current backfill uses realtime paths

**Proposed design assumed:**
Backfill is a new system. Realtime is existing.

**Reality:**
The current backfill system (`enqueueFullBackfillJobsForEndpoint`) creates jobs in `time-series-jobs/{date}/jobs/...` with `mode: 'FULL_BACKFILL'`.

**Impact on design:**
We need to replace the entire backfill job creation logic, not just add to it.

**Recommendation:** Delete the current `enqueueFullBackfillJobsForEndpoint` and replace it with the new backfill controller that creates jobs in `backfill-jobs/{runId}/jobs/...`.

---

## What's Actually Reusable

### ✅ Can Reuse (No Changes)

1. **AV API call logic:**
   - `AlphaVantageHandlerFactory.createHandler(endpoint)`
   - `handler.fetch({ symbol, outputsize, __phase, __checkWriteToggle })`
   - This writes to `symbol-data/{symbol}/sa-time-series/...` (shared path)

2. **Bar verification logic:**
   - Read `lastBarTs` from year/all docs
   - Check if `lastBarTs >= targetTs`

3. **Cloud Tasks queue:**
   - Queue name: `time-series-job`
   - Rate limits: 1.0 req/sec (stays under AV 75/min limit)

4. **Backfill delete helpers:**
   - `deleteDailyAdjustedForSymbol(symbol)`
   - `deleteWeeklyAdjustedForSymbol(symbol)`
   - `deleteMonthlyAdjustedForSymbol(symbol)`

---

### 🔄 Needs Modification

1. **Worker (`processTimeSeriesJobInternal`):**
   - Add `jobType` parameter to payload
   - Route job doc path based on `jobType`:
     ```typescript
     const jobPath = jobType === 'backfill'
       ? `backfill-jobs/${runId}/jobs/${symbol}`
       : getTimeSeriesJobDocPath(marketDate, symbol, endpoint, phase);
     ```
   - Route aggregator call based on `jobType`:
     ```typescript
     if (jobType === 'backfill') {
       await onBackfillJobTerminal({ runId, symbol, interval, status });
     } else {
       await onTimeSeriesJobTerminal({ marketDate, symbol, interval, status });
     }
     ```
   - Skip `publishSymbolsReadyBatch` for backfill jobs (lines 230-236)

2. **Task payload (`ProcessTimeSeriesJobPayload`):**
   - Add optional `jobType?: 'realtime' | 'backfill'` field
   - Add optional `runId?: string` field (for backfill)

3. **Scheduler (`runTimeSeriesJobsForEndpoint`):**
   - Pass `jobType: 'realtime'` when enqueuing tasks

---

### 🆕 Needs to be Created

1. **Backfill controller (`av-full-backfill-controller.ts`):**
   - Replace current HTTP endpoint
   - Create `backfill-jobs/{runId}` run doc with `expectedJobs`
   - Create `backfill-jobs/{runId}/jobs/{symbol}` job docs
   - Enqueue tasks with `jobType: 'backfill'` and `runId`

2. **Backfill aggregator (`onBackfillJobTerminal`):**
   - Update `backfill-jobs/{runId}` counters
   - Check completion: `successJobs + permanentFailureJobs >= expectedJobs`
   - Log completion (no Pub/Sub)

3. **Backfill job doc path helper:**
   - `getBackfillJobDocPath(runId: string, symbol: string): string`
   - Returns `backfill-jobs/${runId}/jobs/${symbol}`

---

### ❌ Needs to be Deleted/Replaced

1. **Current backfill task (`processFullBackfillRunTask`):**
   - Currently calls `enqueueFullBackfillJobsForEndpoint`
   - This creates jobs in realtime paths (wrong)
   - Replace with new controller that uses backfill paths

2. **Current backfill enqueue function (`enqueueFullBackfillJobsForEndpoint`):**
   - Lines 509-665 in `av-time-series-refresh-manager.ts`
   - Creates jobs in `time-series-jobs/{date}/jobs/...`
   - Replace with new logic that creates jobs in `backfill-jobs/{runId}/jobs/...`

---

## Implementation Checklist

### Phase 1: Add Routing to Worker

- [ ] Add `jobType?: 'realtime' | 'backfill'` to `ProcessTimeSeriesJobPayload`
- [ ] Add `runId?: string` to `ProcessTimeSeriesJobPayload`
- [ ] Modify `processTimeSeriesJobInternal` to route job doc path based on `jobType`
- [ ] Modify `processTimeSeriesJobInternal` to route aggregator call based on `jobType`
- [ ] Skip `publishSymbolsReadyBatch` for backfill jobs
- [ ] Update `runTimeSeriesJobsForEndpoint` to pass `jobType: 'realtime'`

### Phase 2: Create Backfill System

- [ ] Create `functions/src/v2/alpha-vantage/backfill/` directory
- [ ] Create `backfill-job-aggregator.ts` with `onBackfillJobTerminal` function
- [ ] Create `av-full-backfill-controller.ts` (new HTTP endpoint)
- [ ] Create `getBackfillJobDocPath` helper function
- [ ] Delete old `processFullBackfillRunTask` from `av-full-backfill.task.ts`
- [ ] Delete old `enqueueFullBackfillJobsForEndpoint` from `av-time-series-refresh-manager.ts`

### Phase 3: Test in Emulator

- [ ] Test realtime scheduler (verify `jobType: 'realtime'` works)
- [ ] Test backfill HTTP endpoint (verify jobs created in `backfill-jobs/`)
- [ ] Test backfill aggregator (verify counters updated correctly)
- [ ] Test backfill completion (verify `status: 'COMPLETE'` when done)

### Phase 4: Deploy & Run

- [ ] Deploy to production
- [ ] Trigger backfill for DAILY/WEEKLY/MONTHLY
- [ ] Monitor `backfill-jobs/` collection
- [ ] Verify data written to `symbol-data/`

---

## Estimated Effort

**Lines of code to modify:** ~100 lines
**New files to create:** 2-3 files (~300 lines total)
**Files to delete:** 1 function (~150 lines)

**Total effort:** 4-6 hours of focused work + testing

---

## Risk Assessment

### Low Risk

- Adding `jobType` to payload (backward-compatible, optional field)
- Creating new backfill paths (no impact on realtime)
- Routing logic in worker (simple if/else)

### Medium Risk

- Deleting old backfill enqueue function (need to verify nothing else calls it)
- Aggregator routing (need to ensure both paths work correctly)

### High Risk

- None identified. The design is sound and the changes are isolated.

---

## Conclusion

**The proposed design is viable, but the "reusable business logic" assumption was wrong.**

The worker is tightly coupled to job tracking. We need to add routing logic to the worker, not extract a pure function.

**The good news:** The routing logic is simple and low-risk. The design still achieves complete separation at the Firestore path level.

**Next step:** Implement Phase 1 (add routing to worker) and test in emulator.
