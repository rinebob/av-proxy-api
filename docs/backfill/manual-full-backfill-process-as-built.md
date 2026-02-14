# Manual Full Backfill Process - As Built

> **Related Planning Documents:**
> - [Backfill vs Realtime Architecture](./backfill-vs-realtime-architecture.md) - Original design proposal
> - [Backfill/Realtime Code Audit](./backfill-realtime-code-audit.md) - Pre-implementation code audit and findings

## Overview
The backfill system fetches full historical time-series data for all symbols across multiple intervals (daily, weekly, monthly) and writes it to Firestore. Jobs are tracked separately from realtime jobs to avoid interference.

**Key Stats:**
- **762 symbols** from `TIME_SERIES_MASTER_SYMBOL_ORDER`
- **3 intervals:** DAILY, WEEKLY, MONTHLY
- **2,286 total jobs** (762 × 3)
- **Rate limit:** 75 req/min (Cloud Tasks: 1.0 req/sec)
- **Expected duration:** 2-3 hours for full backfill

---

## Step 1: HTTP Trigger (Entry Point)

**File:** `functions/src/v2/alpha-vantage/data-refresher/av-full-backfill.http.ts`  
**Function:** `triggerFullBackfillJobs`

**What happens:**
- Receives HTTP POST request with:
  - `marketDate` (required)
  - `symbols` (optional - defaults to all 762 symbols)
  - `includeWeekly` (optional - default false)
  - `includeMonthly` (optional - default false)
- Validates admin secret (`x-admin-secret` header) for security
- If no symbols provided, uses all symbols from `TIME_SERIES_MASTER_SYMBOL_ORDER`
- Determines which endpoints to run:
  - `TIME_SERIES_DAILY_ADJUSTED` (always included)
  - `TIME_SERIES_WEEKLY_ADJUSTED` (if `includeWeekly: true`)
  - `TIME_SERIES_MONTHLY_ADJUSTED` (if `includeMonthly: true`)
- Enqueues Cloud Tasks to `processFullBackfillRunTask` for each endpoint (1-3 tasks)
- Returns 202 Accepted response

**Example Request:**
```bash
curl -X POST https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/triggerFullBackfillJobs \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: <YOUR_ADMIN_SECRET>" \
  -d '{"marketDate": "2026-01-24", "includeWeekly": true, "includeMonthly": true}'
```

> **Note:** Replace `<YOUR_ADMIN_SECRET>` with the actual admin secret value stored in GCP Secret Manager.

---

## Step 2: Task Handler (Per-Endpoint Processing)

**File:** `functions/src/v2/alpha-vantage/data-refresher/av-full-backfill.task.ts`  
**Function:** `processFullBackfillRunTask`

**What happens:**
- Receives task payload with `marketDate`, `symbols`, `endpoint`
- Generates unique `runId` with format:
  - `{date}-{dow}-{phase}-{endpoint}-FULL_BACKFILL`
  - Example: `2026-01-24-FRI-POST-TIME_SERIES_DAILY_ADJUSTED-FULL_BACKFILL`
- Creates run-level document in Firestore at `backfill-runs/{runId}` with:
  - `expectedJobs`: count of symbols (e.g., 762)
  - `successJobs: 0`
  - `permanentFailureJobs: 0`
  - `status: "IN_PROGRESS"`
  - `marketDate`, `endpoint`, timestamps
- Calls `enqueueFullBackfillJobsForEndpoint` to create individual symbol jobs

**Firestore Structure Created:**
```
backfill-runs/
  └── 2026-01-24-FRI-POST-TIME_SERIES_DAILY_ADJUSTED-FULL_BACKFILL/
      ├── expectedJobs: 762
      ├── successJobs: 0
      ├── permanentFailureJobs: 0
      └── status: "IN_PROGRESS"
```

---

## Step 3: Job Creation & Enqueueing

**File:** `functions/src/v2/alpha-vantage/data-refresher/av-time-series-refresh-manager.ts`  
**Function:** `enqueueFullBackfillJobsForEndpoint`

**What happens:**
- Loops through all symbols for the given endpoint
- For each symbol:
  - **Creates job document** in `backfill-runs/{runId}/jobs/{symbol-endpoint-phase}`:
    - `symbol`: Symbol ticker (e.g., "AAPL")
    - `endpoint`: Endpoint name (e.g., "TIME_SERIES_DAILY_ADJUSTED")
    - `phase: "POST"` (trading phase)
    - `mode: TimeSeriesJobMode.FullBackfill` ⚠️ **Critical for full history**
    - `status: "PENDING"`
    - `attempts: 0`
    - Timestamps
  - **Enqueues Cloud Task** to `processTimeSeriesJobTask` with payload:
    - `marketDate`, `symbol`, `endpoint`, `phase`
    - `jobType: TimeSeriesJobType.BACKFILL` (for routing)
    - `runId` (for aggregation)
    - `mode: TimeSeriesJobMode.FullBackfill` (triggers `outputsize=full`)
- Cloud Tasks queue (`time-series-job`) is rate-limited to **1.0 req/sec** (75 req/min)

**Firestore Structure Created:**
```
backfill-runs/
  └── 2026-01-24-FRI-POST-TIME_SERIES_DAILY_ADJUSTED-FULL_BACKFILL/
      └── jobs/
          ├── AAPL-TIME_SERIES_DAILY_ADJUSTED-POST
          ├── GOOGL-TIME_SERIES_DAILY_ADJUSTED-POST
          └── ... (762 total)
```

---

## Step 4: Worker Execution (Per-Symbol Job)

**File:** `functions/src/v2/alpha-vantage/jobs/time-series-jobs.worker.ts`  
**Function:** `processTimeSeriesJobInternal`

**What happens:**
- Receives task payload with `symbol`, `endpoint`, `phase`, `jobType`, `runId`, `mode`
- **Routing Logic #1 - Job Path:** Determines Firestore job document path based on `jobType`:
  - If `jobType === TimeSeriesJobType.BACKFILL`:
    - Path: `backfill-runs/{runId}/jobs/{symbol-endpoint-phase}`
  - If `jobType === TimeSeriesJobType.REALTIME`:
    - Path: `time-series-jobs/{date}/jobs/{symbol-endpoint-phase}`
- Updates job doc to `status: "IN_PROGRESS"`, increments `attempts`
- Calls Alpha Vantage API handler:
  - If `mode: TimeSeriesJobMode.FullBackfill`:
    - **Deletes existing data** for the symbol/endpoint (destructive rebuild)
    - Uses `outputsize: "full"` (fetches complete 20+ year history)
  - If `mode: Compact` (realtime):
    - Uses `outputsize: "compact"` (fetches recent ~100 bars)
- Handler writes data to **shared** Firestore path:
  - `symbol-data/{symbol}/sa-time-series/{year}/`
  - This path is shared between backfill and realtime systems
- On success:
  - Updates job doc to `status: "SUCCESS"`
  - **Routing Logic #2 - Aggregator:** Calls appropriate aggregator based on `jobType`:
    - If `jobType === TimeSeriesJobType.BACKFILL`: calls `onBackfillJobTerminal`
    - If `jobType === TimeSeriesJobType.REALTIME`: calls `onTimeSeriesJobTerminal`
- On permanent failure:
  - Updates job doc to `status: "PERMANENT_FAILURE"`
  - Routes to same aggregator with `PERMANENT_FAILURE` status
- **Skips** `publishSymbolsReadyBatch` for backfill jobs (no partner notifications needed)

**Key Behavior:**
- `mode: FullBackfill` → `outputsize: "full"` → Complete historical data
- `mode: Compact` → `outputsize: "compact"` → Recent ~100 bars only

---

## Step 5: Aggregation (Run-Level Tracking)

**File:** `functions/src/v2/alpha-vantage/jobs/backfill-job-aggregator.ts`  
**Function:** `onBackfillJobTerminal`

**What happens:**
- Receives `runId`, `symbol`, `interval`, `status` (SUCCESS or PERMANENT_FAILURE)
- Uses Firestore transaction to atomically update `backfill-runs/{runId}` document:
  - If `status === SUCCESS`: increments `successJobs++`
  - If `status === PERMANENT_FAILURE`: increments `permanentFailureJobs++`
  - Updates `updatedAt` timestamp
- Checks if run is complete:
  - Condition: `(successJobs + permanentFailureJobs) >= expectedJobs`
- If complete:
  - Updates run doc: `status: "COMPLETE"`
  - Sets `runCompletedAt` timestamp
  - Logs completion event: `backfill.run.complete`
- All updates use Firestore transactions for consistency and race condition safety

**Final Firestore State:**
```
backfill-runs/
  └── 2026-01-24-FRI-POST-TIME_SERIES_DAILY_ADJUSTED-FULL_BACKFILL/
      ├── expectedJobs: 762
      ├── successJobs: 762
      ├── permanentFailureJobs: 0
      ├── status: "COMPLETE"
      └── runCompletedAt: <timestamp>
```

---

## Step 6: Completion

**Result:**
- **3 run documents** in `backfill-runs/` collection (one per interval: DAILY, WEEKLY, MONTHLY)
- Each run has `status: "COMPLETE"` and accurate job counts
- **2,286 job documents** across all runs (762 symbols × 3 intervals)
- All historical data written to `symbol-data/{symbol}/sa-time-series/` (shared with realtime)
- **No interference** with `time-series-jobs/` collection (complete separation achieved)

---

## Key Design Principles

### ✅ Complete Path Separation
- **Backfill job tracking:** `backfill-runs/{runId}/jobs/`
- **Realtime job tracking:** `time-series-jobs/{date}/jobs/`
- No shared documents, no completion state confusion

### ✅ Shared Data Writes
- Both systems write to same path: `symbol-data/{symbol}/sa-time-series/`
- Data is consistent regardless of source (backfill vs realtime)

### ✅ Routing Logic
- Worker and aggregator route based on `jobType` field in payload
- Single codebase handles both backfill and realtime with conditional logic

### ✅ Mode-Driven Behavior
- `mode: FullBackfill` → `outputsize: "full"` → Complete 20+ year history
- `mode: Compact` → `outputsize: "compact"` → Recent ~100 bars

### ✅ Rate Limiting
- Cloud Tasks queue enforces 1.0 req/sec (75 req/min)
- Respects Alpha Vantage API rate limits
- Prevents throttling and API key suspension

### ✅ Atomic Aggregation
- Firestore transactions ensure accurate job counting
- Safe for concurrent job completions
- No race conditions in run completion detection

---

## Monitoring

### Firestore Console
**URL:** https://console.firebase.google.com/project/alpha-vantage-proxy-api/firestore

**What to check:**
- Navigate to `backfill-runs/` collection
- Find your 3 run documents (DAILY, WEEKLY, MONTHLY)
- Watch `successJobs` increment from 0 → 762
- Verify `status` changes from `"IN_PROGRESS"` → `"COMPLETE"`

### Cloud Logging
**URL:** https://console.cloud.google.com/logs/query?project=alpha-vantage-proxy-api

**Query for all backfill activity:**
```
resource.type="cloud_function"
resource.labels.function_name=~"triggerFullBackfillJobs|processFullBackfillRunTask|processTimeSeriesJobTask"
jsonPayload.jobType="backfill"
timestamp>="2026-01-24T21:00:00Z"
```

**Query for completion events:**
```
resource.type="cloud_function"
jsonPayload.message=~"backfill.run.complete"
timestamp>="2026-01-24T21:00:00Z"
```

**Query for errors:**
```
resource.type="cloud_function"
severity>=ERROR
jsonPayload.jobType="backfill"
timestamp>="2026-01-24T21:00:00Z"
```

---

## Troubleshooting

### Issue: Jobs stuck in PENDING
- **Cause:** Cloud Tasks not enabled or rate limit too low
- **Fix:** Check `TS_TIME_SERIES_TASKS_ENABLED=true` in environment

### Issue: Only ~100 bars fetched instead of full history
- **Cause:** `mode: FullBackfill` not set in job doc or payload
- **Fix:** Verify job doc has `mode: "FULL_BACKFILL"` field

### Issue: Run never completes
- **Cause:** Some jobs failed and weren't counted
- **Fix:** Check logs for errors, verify `successJobs + permanentFailureJobs === expectedJobs`

### Issue: API rate limit errors
- **Cause:** Cloud Tasks dispatching too fast
- **Fix:** Verify queue `maxDispatchesPerSecond: 1.0` setting

---

## Related Files

### Core Implementation
- `av-full-backfill.http.ts` - HTTP trigger
- `av-full-backfill.task.ts` - Per-endpoint task handler
- `av-time-series-refresh-manager.ts` - Job creation and enqueueing
- `time-series-jobs.worker.ts` - Worker with routing logic
- `backfill-job-aggregator.ts` - Backfill-specific aggregator
- `time-series-jobs.model.ts` - Shared enums and types

### Data Models
- `TimeSeriesJobType` enum: `REALTIME`, `BACKFILL`
- `TimeSeriesJobMode` enum: `Compact`, `FullBackfill`
- `TimeSeriesJobStatus` enum: `Pending`, `InProgress`, `Success`, `PermanentFailure`
- `TimeSeriesJobTerminalStatus` enum: `SUCCESS`, `PERMANENT_FAILURE`
- `TimeSeriesRunStatus` enum: `IN_PROGRESS`, `COMPLETE`

### Configuration
- Master symbol list: `ts-master-order.ts` (762 symbols)
- Cloud Task queue: `time-series-job` (rate: 1.0 req/sec)
- Admin secret: Stored in GCP Secret Manager (required for HTTP endpoint authentication)

---

## Production Usage

**Deploy functions:**
```bash
firebase deploy --only functions --project alpha-vantage-proxy-api
```

**Trigger full backfill (all symbols, all intervals):**
```powershell
Invoke-WebRequest -Uri "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/triggerFullBackfillJobs" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"; "x-admin-secret"="<YOUR_ADMIN_SECRET>"} `
  -Body '{"marketDate": "2026-01-24", "includeWeekly": true, "includeMonthly": true}' `
  -UseBasicParsing
```

> **Note:** Replace `<YOUR_ADMIN_SECRET>` with the actual admin secret value from GCP Secret Manager.

**Expected response:**
```json
{
  "ok": true,
  "enqueued": true,
  "marketDate": "2026-01-24",
  "includeWeekly": true,
  "includeMonthly": true,
  "symbols": "ALL",
  "endpoints": [
    "TIME_SERIES_MONTHLY_ADJUSTED",
    "TIME_SERIES_WEEKLY_ADJUSTED",
    "TIME_SERIES_DAILY_ADJUSTED"
  ]
}
```

**Expected completion time:** 2-3 hours for 2,286 jobs at 75 req/min

---

## Monitoring & Troubleshooting

### Check Backfill Run Status

**Firestore Console:**
```
backfill-runs/
  └── {runId}/
      ├── status: "IN_PROGRESS" | "COMPLETE"
      ├── expectedJobs: 762
      ├── successJobs: <count>
      ├── permanentFailureJobs: <count>
      └── jobs/ (subcollection)
```

### Find Failed Symbols

**Script:** `functions/scripts/find-backfill-failures.ts`

```powershell
npm run ts:scripts scripts/find-backfill-failures.ts
```

**Output:**
- Lists all symbols that failed in each interval (Daily, Weekly, Monthly)
- Shows symbols that failed across multiple intervals
- Provides summary counts

**Example:**
```
DAILY Failures (1):
  - MMC

WEEKLY Failures (2):
  - MMC
  - MNMD

Symbols failing in multiple intervals (2):
  - MMC [D, W, M]
  - MNMD [W, M]
```

### Cloud Logging Query

```
resource.type="cloud_function"
resource.labels.function_name="processTimeSeriesJobTask"
jsonPayload.jobType="BACKFILL"
severity>=ERROR
```

---

*Document created: 2026-01-24*  
*Last updated: 2026-01-24*
