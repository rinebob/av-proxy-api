# RS Partner Integration (Single Source)

Audience: Relative Strength (RS) backend consuming Savant partner Data‑Ready Pub/Sub and time‑series HTTPS.

Last updated: 2025-11-13

---

## 1) What this covers

- Cadence (ET): PRE hourly + 15:30; POST 16:35 + evening/morning retries
- Payload v1, attributes, `runId` and `runType`
- Message behavior (BEGIN/END) and `runs/{runId}` updates
- Finalization markers and overnight continuation (`remainingSymbols`)
- Manual/correction runs policy
- References to endpoints and auth

---

## 2) Schedules & Cadence (Trading Days, ET)

- PRE (intraday snapshots; no finalize)
  - 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 15:30 ET
  - `runType=ts_daily_pre`
- POST (finalized writes)
  - Initial: 16:35 ET
  - Evening retries: 18:30, 19:00, 19:30, 20:00, 20:30, 21:00, 21:30 ET
  - Morning catchups: 06:30, 07:00 ET (next trading morning)
  - `runType=ts_daily_post`
- Weekly/Monthly POST: 16:40 ET (`runType=ts_weekly_post` / `ts_monthly_post`)
- Weekends/Holidays: No runs

---

## 2.5) Queue-Based Refresh & Backfill Pipeline (Informational)

This section gives RS a high-level view of **how** Savant keeps time-series data fresh using a job/queue pipeline. It is informational only; the RS contract remains the Pub/Sub `partner-data-ready` messages and HTTPS endpoints described elsewhere.

### 2.5.1 Realtime Refresh (Daily/Weekly/Monthly)

- **Job documents (Firestore)**
  - For each trading day and symbol, Savant creates **time-series jobs** in Firestore under:
    - `time-series-jobs/{marketDate}/jobs/{symbol-endpoint-phase}`
  - Each job tracks:
    - `symbol`, `endpoint` (DAILY/WEEKLY/MONTHLY adjusted), `phase` (PRE/POST)
    - `status` (`PENDING`, `IN_PROGRESS`, `SUCCESS`, `TRANSIENT_FAILURE`, `PERMANENT_FAILURE`)
    - `attempts`, `lastError`, and timestamps.

  Approximate shape (for reference, simplified from the internal model):

  ```ts
  interface TimeSeriesJobDoc {
    symbol: string;                     // e.g. "AVGO"
    endpoint: string;                   // e.g. "TIME_SERIES_DAILY_ADJUSTED"
    interval: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    phase: 'PRE' | 'POST';

    status:
      | 'PENDING'
      | 'IN_PROGRESS'
      | 'SUCCESS'
      | 'TRANSIENT_FAILURE'
      | 'PERMANENT_FAILURE';

    attempts: number;                   // total attempts so far
    lastError?: string;                 // last error message (if any)

    // Timestamps (Firestore Timestamp in storage)
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt: FirebaseFirestore.Timestamp;
    lastAttemptAt?: FirebaseFirestore.Timestamp;

    // When we confirm that the intended bar exists for this date/interval
    finalizedAtMs?: number;             // epoch millis for the target period
  }
  ```

- **Schedulers → jobs → Cloud Tasks**
  - Scheduled functions (PRE/POST, daily/weekly/monthly) **do not call Alpha Vantage directly**.
  - Instead they:
    - Compute `marketDate` and which endpoints/phases should run.
    - Enumerate the tracked symbol universe.
    - Upsert job docs for `{marketDate, symbol, endpoint, phase}`.
    - Enqueue Cloud Tasks for jobs that are not yet terminal.

- **Workers (Cloud Tasks)**
  - Each job is processed by a single worker function (`processTimeSeriesJobTask`):
    - Calls Alpha Vantage at a bounded rate (queue‑level rate limits + 1s internal delay) to respect AV limits.
    - Writes bars to Firestore via the existing handlers (daily/weekly/monthly, split‑adjusted SA trees).
    - Verifies that the **latest bar timestamp** for the interval is at or after `marketDate`.
    - Updates the job’s `status` to `SUCCESS` or, after repeated failures, `PERMANENT_FAILURE`.

- **What RS should take from this**
  - Savant has **per‑symbol, per‑endpoint, per‑day job state** behind the scenes.
  - The **all‑intervals POST `partner-data-ready` message** RS consumes is emitted **after** the relevant jobs for the RS universe have reached terminal states for that day (success or permanent failure).
  - If a small number of symbols fail permanently, the run will eventually report `completed_with_errors` in a future payload version; RS can still treat the day as “done” while optionally inspecting failures.

> For deeper internals, see `docs/time-series-job-pipeline-plan.md`. RS does not need that document for normal operations.

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

Minimal v1 (current implementation):
```json
{
  "version": "v1",
  "runId": "2026-01-16-post-all-intervals-v1",
  "marketDate": "2026-01-16",
  "phase": "post",
  "intervals": ["DAILY", "WEEKLY", "MONTHLY"],
  "time": 1737043200000,
  "status": "end",
  "finalizedCountTotal": 742,
  "pendingCount": 0
}
```

Extended fields (current):
- `marketDate`: `YYYY-MM-DD`
- `phase`: `"pre"` | `"post"`
- `intervals`: array of `TimeSeriesInterval` values (e.g. `"DAILY"`, `"WEEKLY"`, `"MONTHLY"`)
- `time`: epoch millis when the event was published
- `finalizedCountTotal`: number of successful time-series jobs for this `marketDate`
- `pendingCount`: always `0` for END events

Trigger semantics:

- `trigger` is an optional field in the JSON body and a mirrored Pub/Sub
  attribute. RS uses it as an advisory hint for how to treat the message:
  - `"scheduled"`: normal production run (RS processes the message).
  - `"manual"`: ad-hoc/manual run (RS may log or optionally process).
  - `"test"`: **dry-run / no-op** – RS receives the message but skips normal
    ingestion logic. This is useful when SA wants to validate payload shape or
    wiring without advancing RS state.

Planned extensions (not yet emitted but reserved for future versions):
- `universeVersion`: semantic version of the RS universe/config (e.g. `"v1"`)
- `runStatus`: one of `"completed"` or `"completed_with_errors"` (from `PartnerRunStatus`), derived from `successJobs` vs `permanentFailureJobs`
- `timing.finalizedAtUTC`: ISO timestamp when the first finalized bar was detected (POST)
- `timing.nextRefreshAtUTC`: ISO timestamp for the next scheduled refresh

---

## 4) Attributes & Identifiers

- `runType` (time‑series jobs): `ts-daily-pre` | `ts-daily-post` | `ts-weekly-post` | `ts-monthly-post` 
- `runType` (all-intervals POST / universe-ready): `ts-post-all-intervals`.
- `runId`:
  - Conventionally follows `YYYY-MM-DD-pre-*` or `YYYY-MM-DD-post-*` patterns (with optional manual/test suffix), but the backend only requires a non-empty string. The exact format is for human readability and subscriber filters, not enforced.

Subscription filters (examples):
- All-intervals TS universe POST (RS primary): `attributes.runType = "ts-post-all-intervals" AND attributes.phase = "post"` 
- Finalized daily only (legacy/non-RS): `attributes.runType = "ts-daily-post"` 
- Daily only (both): `attributes.runType = "ts-daily-pre" OR attributes.runType = "ts-daily-post"` 
- Exclude non‑time‑series: `attributes.runType != "non-time-series"` 

---

## 5) Message Behavior and Runs Document

- Every scheduled invocation publishes two messages for the same per‑day/per‑phase `runId`:
  - BEGIN → `runStatus=processing`
  - END → metrics, optional `remainingSymbols` sample (POST only)
- All invocations for the same phase/day update the same Firestore document:
  - `runs/{YYYY-MM-DD-pre}` or `runs/{YYYY-MM-DD-post}`
- END updates are idempotent‑friendly; subsequent invocations will refresh the same `runs` doc fields.

### 3.2 All-Intervals POST "Universe Ready" (RS contract)

RS subscribes to a **single run‑level all-intervals POST message** per trading day on the existing `partner-data-ready` topic. Conceptual payload:
```json
{
  "version": "v1",
  "runId": "2026-01-16-post-all-intervals-v1",
  "marketDate": "2026-01-16",
  "phase": "post",
  "intervals": ["DAILY", "WEEKLY", "MONTHLY"],
  "universeVersion": "v1",
  "status": "completed"  // or "completed_with_errors"
}
```

- A small aggregator monitors job completion for the RS universe.
- When the universe is finalized for `{marketDate, phase=POST}`, it emits a **single all-intervals POST message** on `partner-data-ready` with `runType = "ts-post-all-intervals"` and updates a corresponding `runs/{runId}` or `system/time-series-status` doc with aggregate status.
- RS treats this all-intervals POST message as its **only required Pub/Sub trigger**.

---

## 6) Finalization & Overnight Continuation (POST)

- Finalization markers:
  - `timing.finalizedAtUTC` appears when first finalized bars are detected for the day
  - Root transparency doc: `system/time-series-finalization/daily-adjusted/{marketDate}` (FYI)
- Continuation logic:
  - Tracks symbols finalized before run start vs those finalized during the run
  - Computes pending; when few remain, runs a targeted acceleration pass
  - END payload may include a small `remainingSymbols` sample if pending > 0

Manual/correction runs:
- Operator‑triggered with `runId` suffix (e.g., `-manual-1905`)
- RS policy: ignore these runs

---

## 7) Endpoints & Auth (Pointers)

- HTTPS endpoints:
  - Time series: `partnerTimeSeriesV2` (GET)
  - Tracked symbols: `partnerListTrackedSymbolsV2` (GET)
- Auth: Google OIDC ID token (SA allowlisted, `aud` set to function URL, include email)

See:
- API surface: `docs/partner-api-surface.md`
- Discovery: `docs/partner-discovery.md`
- Integration (auth/examples): `docs/partner-integration.md`

---

## 8) Quick Start (RS‑focused)

- Subscribe to `partner-data-ready` with filter `attributes.runType = "ts-post-all-intervals" AND attributes.phase = "post"` (and `ts_weekly_post` / `ts_monthly_post` if/when RS wants those intervals).
- On each POST **END** message, treat the run as the *only* canonical signal that the time-series universe for that date/phase is as complete as SA can make it.
- After receiving POST END, read time series via `partnerTimeSeriesV2` as needed for RS ingestion.
- Ignore messages whose `runId` contains a manual suffix.

---

## 9) Optional Symbol‑Level Readiness Stream

For most use cases, **including RS**, `partner-data-ready` is the **only required contract**. The job‑based time‑series pipeline also exposes an optional, low‑latency symbol‑level stream for partners who explicitly choose to react to per‑symbol readiness. RS does **not** currently use this stream for its core ingestion path.

- **Topic:** `partner-symbols-ready`
- **Payload (conceptual):

  ```json
  {
    "version": "v1",
    "marketDate": "YYYY-MM-DD",
    "runId": "YYYY-MM-DD-HHMM-post",   // optional link to run-level event
    "symbols": ["AVGO", "MSFT", "SPY"],
    "reason": "scheduled"              // or "backfill"
  }
  ```

-- **Semantics:**
  - Each message contains symbols that have just become fully ready for the given `marketDate` based on job‑doc state in `time-series-jobs/{marketDate}/jobs`.
  - Intervals (DAILY/WEEKLY/MONTHLY) are resolved internally; consumers do **not** need to track per‑interval readiness unless they choose to.
  - The stream is **additive**: symbols may appear in one or more messages, but the authoritative completion signal for the run remains the `partner-data-ready` END message.

Suggested usage for RS:

- Continue to treat `partner-data-ready` POST END as the canonical "run finished" marker and the **only** required signal for core RS ingestion.
- RS should **not** depend on `partner-symbols-ready` for correctness. If RS ever chooses to consume this stream in the future, it should be used only as an optimization layer (e.g., for previews or incremental updates) on top of the run-level contract.

---

## 10) Troubleshooting

- Ensure subscription filter matches exact `runType`
- Expect multiple BEGIN/END pairs per trading day for the same POST `runId` (evening/morning retries)
- Use `marketDate` (if present) to key per‑day logic

---

## 10) Operational Appendix (RS)

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
- `docs/partner-integration.md` (auth details, examples)
- `docs/partner-api-surface.md` (endpoints overview)
