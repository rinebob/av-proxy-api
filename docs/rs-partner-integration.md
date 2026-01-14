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

## 3) Payload Schema (v1)

Minimal v1:
```json
{
  "version": "v1",
  "runId": "2025-09-11-post",
  "phase": "post",
  "intervals": ["DAILY"],
  "time": 1736726400000
}
```

Extended fields:
- `marketDate`: `YYYY-MM-DD`
- `counts`: `{ pendingCount, finalizedCountTotal, deltaCount }`
- `timing.finalizedAtUTC`: ISO when first finalized bar was detected (POST)
- `timing.nextRefreshAtUTC`: ISO next scheduled refresh
- Header: `runStatus` → `processing` | `completed`

---

## 4) Attributes & Identifiers

- `runType`: `ts_daily_pre` | `ts_daily_post` | `ts_weekly_post` | `ts_monthly_post`
- `runId`:
  - Scheduled: `YYYY-MM-DD-pre` | `YYYY-MM-DD-post`
  - Manual/test: `YYYY-MM-DD-pre-<suffix>` / `YYYY-MM-DD-post-<suffix>` (1–16 lowercase letters/digits)

Subscription filters (examples):
- Finalized daily: `attributes.runType = "ts_daily_post"`
- Daily only (both): `attributes.runType = "ts_daily_pre" OR attributes.runType = "ts_daily_post"`
- Exclude non‑time‑series: `attributes.runType != "non_time_series"`

---

## 5) Message Behavior and Runs Document

- Every scheduled invocation publishes two messages for the same per‑day/per‑phase `runId`:
  - BEGIN → `runStatus=processing`
  - END → metrics, optional `remainingSymbols` sample (POST only)
- All invocations for the same phase/day update the same Firestore document:
  - `runs/{YYYY-MM-DD-pre}` or `runs/{YYYY-MM-DD-post}`
- END updates are idempotent‑friendly; subsequent invocations will refresh the same `runs` doc fields.

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

- Subscribe to `partner-data-ready` with filter `attributes.runType = "ts_daily_post"`
- On each POST END, read time series via `partnerTimeSeriesV2` as needed
- Ignore messages whose `runId` contains a manual suffix

---

## 9) Optional Symbol‑Level Readiness Stream

For most use cases, RS can continue to treat `partner-data-ready` as the **only** required contract. However, the job‑based time‑series pipeline also exposes an optional, low‑latency symbol‑level stream for partners who want to begin fetching data as soon as individual symbols are finalized.

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

- **Semantics:**
  - Each message contains a **batch of symbols** that have just become fully ready for the given `marketDate` based on job‑doc state in `time-series-jobs/{marketDate}/jobs`.
  - Intervals (DAILY/WEEKLY/MONTHLY) are resolved internally; RS does **not** need to track per‑interval readiness.
  - The stream is **additive**: symbols may appear in one or more batches, but the authoritative completion signal for the run remains the `partner-data-ready` END message.

Suggested usage for RS:

- Continue to treat `partner-data-ready` POST END as the canonical "run finished" marker.
- Optionally subscribe to `partner-symbols-ready` to:
  - Maintain a per‑day set of symbols that are already finalized.
  - Start issuing `partnerTimeSeriesV2` requests for those symbols without waiting for the entire universe to complete.

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
