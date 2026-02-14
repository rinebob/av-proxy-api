# RS Partner Integration (Single Source)

Audience: Relative Strength (RS) backend consuming Savant partner Data‑Ready Pub/Sub and time‑series HTTPS.

Last updated: 2026-02-14

### Related Documents

This document is part of a four-document set covering the time-series job pipeline:

| Document | Purpose | Audience |
|----------|---------|----------|
| **`pipeline/time-series-job-pipeline-plan.md`** | Design rationale, architecture decisions, migration plan, and future work. The "why + what". | Internal SA engineers |
| **`pipeline/time-series-job-pipeline-deep-dive.md`** | Technical appendix with concrete TypeScript types, code paths, Firestore shapes, and step-by-step algorithms. The "how". | Internal + RS engineering |
| **`partner/rs-partner-integration.md`** (this doc) | Consumer-facing contract: Pub/Sub payloads, subscription filters, `includeSymbols`/`excludeSymbols` semantics, HTTPS endpoints, quick start. | RS backend engineers |
| **`pipeline/abc-run-pipeline-flowchart.md`** | Mermaid flowcharts documenting the A/B/C pipeline visually with filenames and function names. | Internal + RS engineering |

---

## 1) What this covers

- Cadence (ET): POST A/B/C pipeline (16:35, 21:00, 07:00 next day)
- Payload v1, attributes, `runId` and `runType`
- Per-interval END messages and `realtime-runs/{runId}` documents
- A/B/C retry model with `includeSymbols` / `excludeSymbols`
- Manual/correction runs policy
- References to endpoints and auth

---

## 2) Schedules & Cadence (Trading Days, ET)

The POST pipeline uses an **A/B/C sequence model** where each pass covers all three intervals (DAILY/WEEKLY/MONTHLY) and creates per-interval `realtime-runs/{runId}` documents.

| Sequence | Time (ET) | Scheduler | Description |
|----------|-----------|-----------|-------------|
| **A** | 16:35 | `refreshAvTimeSeriesPostAllIntervals` | Initial full-universe run. Processes all tracked symbols for DAILY, WEEKLY, and MONTHLY. |
| **B** | 21:00 | `refreshAvDailyTimeSeriesPostEveningRetry00` | Retry run. Processes only `retrySymbols` from the A run (per interval). |
| **C** | 07:00 next day | `refreshAvDailyTimeSeriesPostMorning0700` | Deadline retry. Processes only `retrySymbols` from the B run. Stale data treated as permanent failure. |

- **PRE schedulers** (intraday hourly, pre-close): Currently **paused** in production. If re-enabled, they must use the `realtime-runs` pipeline.
- **Weekly/Monthly POST schedulers**: Now **no-ops**; all intervals are handled by the A/B/C orchestrator (`runAllTimeSeriesIntervalsPost`).
- **Legacy evening retries** (18:30, 19:30, 20:30 etc.): The `:30` scheduler still exists as a standalone DAILY-only X-sequence run but is **not** part of the A/B/C retry chain.
- **Weekends/Holidays**: No runs.

---

## 2.5) Queue-Based Refresh & Backfill Pipeline (Informational)

This section gives RS a high-level view of **how** Savant keeps time-series data fresh using a job/queue pipeline. It is informational only; the RS contract remains the Pub/Sub `partner-data-ready` messages and HTTPS endpoints described elsewhere.

### 2.5.1 Realtime Refresh (Daily/Weekly/Monthly)

- **Run and job documents (Firestore)**
  - Each A/B/C pass creates **one run document per interval** under:
    - `realtime-runs/{runId}` — aggregate counters, status, retry/stale symbol lists.
  - Each run has a **jobs subcollection**:
    - `realtime-runs/{runId}/jobs/{symbol-endpoint-phase}` — one job per symbol.
  - The `runId` format is: `YYYY-MM-DD-DOW-SEQ-INTERVAL-LIVE|MANUAL-PHASE-HHMM`
    - Example: `2026-02-13-THU-A-DAILY-LIVE-POST-1635`

  Approximate run doc shape (simplified from `RealtimeRun` interface):

  ```ts
  interface RealtimeRunDoc {
    runId: string;
    runType: 'ts-post-all-intervals-initial' | 'ts-post-all-intervals-retry';
    sequence: string;                   // 'A', 'B', or 'C'
    marketDate: string;                 // YYYY-MM-DD
    phase: 'POST';
    interval: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    trigger: 'scheduler' | 'manual';
    status: 'IN_PROGRESS' | 'COMPLETE';

    createdJobs: number;
    finishedJobs: number;
    successJobs: number;
    permanentFailureJobs: number;

    retrySymbols?: string[];            // symbols needing retry on next pass
    retrySuccessSymbols?: string[];     // symbols that became fresh in this pass
    staleSymbols?: string[];            // symbols with stale vendor data
    permanentFailureSymbols?: string[];

    totalDuration?: number;             // ms from runStartedAt to runFinishedAt
    totalDurationFormatted?: string;    // "MM:SS"

    partnerDataReady?: {
      messageSent: boolean;
      sendTime: Timestamp;
      messagePayload?: DataReadyPayloadV1;
    };
  }
  ```

  Approximate job doc shape (simplified from `TimeSeriesJob` interface):

  ```ts
  interface TimeSeriesJobDoc {
    symbol: string;                     // e.g. "AVGO"
    endpoint: string;                   // e.g. "TIME_SERIES_DAILY_ADJUSTED"
    interval: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    phase: 'POST';

    status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS'
          | 'TRANSIENT_FAILURE' | 'PERMANENT_FAILURE';

    attempts: number;
    lastError?: string;
    dataFreshness?: 'UNKNOWN' | 'FRESH' | 'STALE';

    createdAt: Timestamp;
    updatedAt: Timestamp;
    firstAttemptedAt?: Timestamp;       // when first AV fetch started
    lastAttemptAt?: Timestamp;
  }
  ```

- **Schedulers → orchestrator → jobs → Cloud Tasks**
  - The A/B/C schedulers call `runAllTimeSeriesIntervalsPost()` which:
    1. Derives `marketDate`, builds per-interval `runId`s via `RunIdFactory.createRealtime()`.
    2. Initializes 3 `realtime-runs/{runId}` docs (MONTHLY, WEEKLY, DAILY) with `createdJobs=0, status=IN_PROGRESS`.
    3. For **A runs**: enumerates the full tracked-symbol universe per interval.
    4. For **B/C runs**: calls `getRetrySymbolsForInterval()` to read `retrySymbols` from the prior sequence's run doc (B reads A, C reads B). If no retry symbols exist, the run is immediately marked `COMPLETE` with `createdJobs=0`.
    5. Creates job docs under `realtime-runs/{runId}/jobs/` and enqueues Cloud Tasks.

- **Workers (Cloud Tasks)**
  - Each job is processed by `processTimeSeriesJobTask` → `processTimeSeriesJobInternal`:
    - Calls Alpha Vantage at a bounded rate (queue-level rate limits + fixed delay).
    - Writes bars to Firestore (split-adjusted SA trees).
    - Determines **`dataFreshness`** by comparing `lastBarTs` to `marketDate` midnight:
      - `FRESH`: latest bar is at or after the target period end.
      - `STALE`: bar exists but is before the target period end.
      - `UNKNOWN`: no bar timestamp available.
    - Updates the parent run doc's `retrySymbols` / `staleSymbols` / `retrySuccessSymbols` arrays based on freshness.
    - For **deadline runs** (C run, `deadlineRun=true`): if data is STALE, throws `STALE_AT_DEADLINE` which routes through the retry/permanent-failure path.
    - After `MAX_JOB_ATTEMPTS` (5), marks the job `PERMANENT_FAILURE`.

- **Aggregator (`realtime-run-aggregator.ts`)**
  - `onRealtimeRunJobTerminal()` increments `successJobs`/`permanentFailureJobs`/`finishedJobs` on the run doc.
  - **Fast path**: when `finishedJobs === createdJobs`, marks run `COMPLETE` and emits a `partner-data-ready` END message.
  - **Slow path**: if outside `MAX_RUN_DURATION_MS` window, calls `reconcileRunJobs()` to re-count from the jobs subcollection and force-complete.

- **What RS should take from this**
  - Savant has **per-symbol, per-interval, per-run job state** behind the scenes.
  - Each interval run emits its own `partner-data-ready` END message when complete.
  - Runs with permanent failures report `runStatus: "completed_with_errors"`. RS can still treat the day as "done" while optionally inspecting failures.
  - The `includeSymbols` / `excludeSymbols` fields on the PDR message tell RS exactly which symbols to fetch (see Section 3).

> For deeper internals, see `docs/pipeline/abc-run-pipeline-flowchart.md`. RS does not need that document for normal operations.

### 2.5.2 Full Backfill (Admin‑Only, One‑Off)

Full backfills are **operator‑initiated maintenance runs** that rebuild complete Alpha Vantage time‑series history for part or all of the universe. They use the same worker and queue machinery but are **not** part of RS’s normal daily cadence.

- **Trigger**
  - Admins call a guarded HTTPS endpoint (internal to Savant) to start a full backfill run for one or more intervals (DAILY/WEEKLY/MONTHLY) and an optional symbol subset.
  - That endpoint enqueues a background Cloud Task (`processFullBackfillRunTask`).

- **Run and jobs (backfill‑specific)**
  - The backfill task creates a **run document** and associated jobs under:
    - `backfill-runs/{runId}` – aggregate counters and status for the backfill.
    - `backfill-runs/{runId}/jobs/{symbol-endpoint-phase}` – one **full‑backfill job per symbol/endpoint**.
  - Each backfill job:
    - Uses the same worker code as realtime jobs, but with `mode=FULL_BACKFILL`.
    - Deletes existing SA time‑series data for that symbol+endpoint.
    - Fetches **full history** from Alpha Vantage and rewrites the series from scratch.

- **Completion and RS impact**
  - A separate backfill aggregator updates `backfill-runs/{runId}` as jobs reach `SUCCESS` or `PERMANENT_FAILURE` and marks the run `COMPLETE` once all jobs are terminal.
  - During a backfill, regular realtime jobs continue to run; RS’s contract via `partner-data-ready` remains unchanged.
  - If a backfill materially changes historical data, Savant may communicate that out of band (e.g., “history for symbol X from 2010–2015 was rebuilt”). From RS’s perspective, subsequent HTTPS reads will simply see corrected history.

---

## 3) Payload Schema (v1)

Each `partner-data-ready` END message covers a **single interval** for a single A/B/C run. Example payload for an A-run DAILY completion:

```json
{
  "version": "v1",
  "runId": "2026-02-13-THU-A-DAILY-LIVE-POST-1635",
  "marketDate": "2026-02-13",
  "phase": "post",
  "intervals": ["DAILY"],
  "time": 1739487600000,
  "status": "end",
  "runStatus": "completed",
  "durationMs": 245000,
  "finalizedCountTotal": 742,
  "pendingCount": 0,
  "env": "prod",
  "trigger": "scheduled",
  "excludeSymbols": ["ACME", "XYZ"]
}
```

Example payload for a B-run retry completion:

```json
{
  "version": "v1",
  "runId": "2026-02-13-THU-B-DAILY-LIVE-POST-2100",
  "marketDate": "2026-02-13",
  "phase": "post",
  "intervals": ["DAILY"],
  "time": 1739505600000,
  "status": "end",
  "runStatus": "completed",
  "durationMs": 32000,
  "finalizedCountTotal": 5,
  "pendingCount": 0,
  "env": "prod",
  "trigger": "scheduled",
  "includeSymbols": ["ACME", "XYZ"]
}
```

### Field reference (actively emitted)

| Field | Type | Description |
|-------|------|-------------|
| `version` | `"v1"` | Schema version. |
| `runId` | string | Canonical run ID (see Section 4). |
| `marketDate` | `YYYY-MM-DD` | Trading date in ET. |
| `phase` | `"post"` | Always `"post"` for the A/B/C pipeline. |
| `intervals` | string[] | **Single-element array**: `["DAILY"]`, `["WEEKLY"]`, or `["MONTHLY"]`. |
| `time` | number | Epoch millis when the message was published. |
| `status` | `"end"` | Always `"end"` for completion messages. |
| `runStatus` | string | `"completed"` or `"completed_with_errors"` (if any permanent failures). |
| `durationMs` | number | Run duration in milliseconds (runStartedAt → runFinishedAt). |
| `finalizedCountTotal` | number | Count of successful jobs for this run. |
| `pendingCount` | number | Always `0` for END events. |
| `env` | string | Environment label (e.g. `"prod"`, `"dev"`). |
| `trigger` | string | `"scheduled"` or `"manual"`. |
| `includeSymbols` | string[] | **B/C retry runs only**: symbols that became FRESH in this pass. RS should fetch only these. |
| `excludeSymbols` | string[] | **A initial runs only**: symbols that are still STALE/failed. RS should fetch the full universe minus these. |

### Symbol semantics for RS

- **A run** (`ts-post-all-intervals-initial`): RS treats the universe as `tracked-symbols \ excludeSymbols`. If `excludeSymbols` is empty/absent, the entire universe is ready.
- **B/C run** (`ts-post-all-intervals-retry`): RS treats `includeSymbols` as the exact set of symbols that became fresh. If `includeSymbols` is empty/absent, no new symbols became fresh in this pass.

### Trigger semantics

- `trigger` is an optional field in the JSON body and a mirrored Pub/Sub attribute:
  - `"scheduled"`: normal production run (RS processes the message).
  - `"manual"`: ad-hoc/manual run (RS may log or optionally process).
  - `"test"`: **dry-run / no-op** – RS skips normal ingestion logic.

### Reserved fields (not yet emitted)

- `universeVersion`: semantic version of the RS universe/config (e.g. `"v1"`)
- `finalizedAtUTC`: ISO timestamp when the first finalized bar was detected
- `nextRefreshAtUTC`: ISO timestamp for the next scheduled refresh

---

## 4) Attributes & Identifiers

- `runType` (Pub/Sub attribute): `ts-post-all-intervals` for all A/B/C POST messages. This is the only `runType` RS needs to filter on.
- `runId` format: `YYYY-MM-DD-DOW-SEQ-INTERVAL-LIVE|MANUAL-PHASE-HHMM`
  - Example: `2026-02-13-THU-A-DAILY-LIVE-POST-1635`
  - Components: marketDate, day-of-week, sequence (A/B/C/X), interval (DAILY/WEEKLY/MONTHLY), LIVE or MANUAL, phase (POST), ET clock label (HHMM).
- `interval` attribute: `DAILY`, `WEEKLY`, or `MONTHLY` — mirrors the single element in the payload's `intervals` array.

Subscription filters (examples):

- **RS primary** (all-intervals POST): `attributes.runType = "ts-post-all-intervals" AND attributes.phase = "post"`
  This yields **up to 9 messages per trading day** (3 intervals × 3 sequences A/B/C). B/C runs with no retry symbols emit no message (run completes with 0 jobs).
- Exclude non‑time‑series: `attributes.runType != "non-time-series"`

---

## 5) Message Behavior and Run Documents

- The new pipeline emits **only END messages** (no BEGIN). Each END message is published when a `realtime-runs/{runId}` document transitions to `COMPLETE`.
- Each A/B/C pass produces **one `realtime-runs/{runId}` document per interval** (up to 3 per pass: DAILY, WEEKLY, MONTHLY).
- The `partnerDataReady` field on the run doc records whether the PDR message was sent, when, and the full payload for debugging.

### All-Intervals POST "Universe Ready" (RS contract)

RS subscribes to **run-level POST messages** on the `partner-data-ready` topic. Savant emits **one message per interval per logical run (A/B/C)**:

- The `realtime-run-aggregator` monitors job completion for each `(marketDate, interval, sequence)` run.
- When all jobs for a run reach terminal state, the aggregator marks the run `COMPLETE` and publishes a single `partner-data-ready` END message with `runType = "ts-post-all-intervals"`.
- The message includes `includeSymbols` or `excludeSymbols` based on the run type (see Section 3).
- RS treats these per-interval END messages as its **required Pub/Sub triggers**. For core correctness, RS can treat the **C-run END messages** as the canonical "universe ready" signals and treat earlier A/B messages as optional early/partial signals.

---

## 6) A/B/C Retry Model & Manual Runs

### Retry flow

The A/B/C pipeline replaces the legacy finalization/continuation logic:

1. **A run** (16:35 ET): Processes the full universe. Symbols with STALE data are added to `retrySymbols` on the run doc.
2. **B run** (21:00 ET): Reads `retrySymbols` from the A run doc (per interval). Processes only those symbols.
3. **C run** (07:00 ET next day): Reads `retrySymbols` from the B run doc. Processes only those symbols with `deadlineRun=true` — STALE data is treated as `PERMANENT_FAILURE`.

Symbols that become FRESH during a B/C run are recorded in `retrySuccessSymbols` and surfaced as `includeSymbols` in the PDR message.

### Manual/correction runs

- Operator-triggered runs use `MANUAL` in the runId (e.g., `2026-02-13-THU-A-DAILY-MANUAL-POST-1635`).
- RS policy: ignore messages where `trigger === "manual"` or where the runId contains `MANUAL`.

---

## 7) Endpoints & Auth (Pointers)

- HTTPS endpoints:
  - Time series: `partnerTimeSeriesV2` (GET)
  - Tracked symbols: `partnerListTrackedSymbolsV2` (GET)
- Auth: Google OIDC ID token (SA allowlisted, `aud` set to function URL, include email)

See:
- Discovery: `docs/partner/partner-discovery.md`
- Integration (auth/examples): `docs/partner/partner-integration.md`

---

## 8) Quick Start (RS‑focused)

1. Subscribe to `partner-data-ready` with filter `attributes.runType = "ts-post-all-intervals" AND attributes.phase = "post"`.
2. Expect **multiple END messages per trading day** — one per interval per A/B/C sequence that has work to do. Each message covers a single interval (e.g. `intervals: ["DAILY"]`).
3. On receiving an **A-run** END message: fetch the full universe minus `excludeSymbols` (if present) via `partnerTimeSeriesV2`.
4. On receiving a **B/C-run** END message: fetch only the symbols listed in `includeSymbols` (if present). These are symbols that became fresh in this retry pass.
5. For core correctness, RS can treat the **C-run END messages** as the canonical "universe ready" signals and treat earlier A/B messages as optional early/partial signals.
6. Ignore messages where `trigger === "manual"` or where the `runId` contains `MANUAL`.

---

## 9) Optional Symbol‑Level Readiness Stream

For most use cases, **including RS**, `partner-data-ready` is the **only required contract**. The job‑based time‑series pipeline also exposes an optional, low‑latency symbol‑level stream for partners who explicitly choose to react to per‑symbol readiness. RS does **not** currently use this stream for its core ingestion path.

- **Topic:** `partner-symbols-ready`
- **Payload (conceptual):**

  ```json
  {
    "version": "v1",
    "marketDate": "YYYY-MM-DD",
    "runId": "2026-02-13-THU-A-DAILY-LIVE-POST-1635",
    "symbols": ["AVGO", "MSFT", "SPY"],
    "reason": "scheduled"
  }
  ```

- **Semantics:**
  - Each message contains symbols that have just reached SUCCESS for a given `marketDate` based on job state in `realtime-runs/{runId}/jobs/`.
  - Intervals (DAILY/WEEKLY/MONTHLY) are resolved internally; consumers do **not** need to track per‑interval readiness unless they choose to.
  - The stream is **additive**: symbols may appear in one or more messages, but the authoritative completion signal for the run remains the `partner-data-ready` END message.

Suggested usage for RS:

- Continue to treat `partner-data-ready` POST END as the canonical "run finished" marker and the **only** required signal for core RS ingestion.
- RS should **not** depend on `partner-symbols-ready` for correctness. If RS ever chooses to consume this stream in the future, it should be used only as an optimization layer (e.g., for previews or incremental updates) on top of the run-level contract.

---

## 10) Troubleshooting

- Ensure subscription filter matches exact `runType` (`ts-post-all-intervals`).
- Expect **multiple END messages per trading day** — up to one per interval per A/B/C sequence. There are no BEGIN messages in the new pipeline.
- Use `marketDate` to key per-day logic. Use `runId` to deduplicate.
- If a B/C run has no retry symbols, it completes immediately with `createdJobs=0` and **no PDR message is emitted**.
- Check `realtime-runs/{runId}` in Firestore for run-level diagnostics including `partnerDataReady`, `retrySymbols`, `permanentFailureSymbols`, and `nonSuccessJobs`.

---

## 11) Operational Appendix (RS)

- Auth (server‑to‑server):
  - Google OIDC ID token from an allowlisted service account (SA)
  - Cloud Run IAM: grant `roles/run.invoker` to the SA
  - Token: `aud` must equal the function URL; include the `email` claim (`--include-email`)

- Symbol universe:
  - `partnerListTrackedSymbolsV2` (GET): `?activeOnly=true&limit=500`

- Example (curl):
  ```bash
  HOST="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net"
  URL_TS="${HOST}/partnerTimeSeriesV2"
  TOKEN_TS="$(gcloud auth print-identity-token --audiences="${URL_TS}" --include-email)"
  curl -s -H "Authorization: Bearer ${TOKEN_TS}" \
    "${URL_TS}?symbol=AAPL&interval=DAILY&range=1y"
  ```

- Idempotency & checkpointing:
  - Treat one RS compute per trading day; dedupe with `runId`/`marketDate`
  - Persist a per‑day checkpoint (processed/completed) to avoid repeats

- Monitoring:
  - Track subscription lag, errors, and RS daily completion by `marketDate`
  - Suggested log fields: `component=rs`, `marketDate`, `runId`, `symbolsProcessed`, `durationMs`, `status`

- Security:
  - Server‑to‑server only; rotate SA credentials; prefer keyless workload identity where possible

References:
- `docs/partner/partner-integration.md` (auth details, examples)
- `docs/pipeline/abc-run-pipeline-flowchart.md` (Mermaid flowcharts of the A/B/C pipeline internals)
