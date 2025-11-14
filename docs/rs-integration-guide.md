# Relative Strength (RS) Integration Guide

Audience: Teams building an RS pipeline that consumes Savant’s partner API and Pub/Sub to compute daily relative strength.

Last updated: 2025-11-13

## Objectives

- Trigger RS jobs when daily bars are finalized (post‑close)
- Read normalized OHLCV time series from partner HTTPS
- Ensure idempotent, reliable processing per market day

---

## Discovery (Recommended)

- Topic: `partner-data-ready`
- Subscribe with a filter that targets finalized (POST) runs only:
  ```
  attributes.runType = "ts_daily_post"
  ```
- Key fields in payload v1:
  - `runId`: `YYYY-MM-DD-post[-suffix]` (use for idempotency)
  - `phase`: `post`
  - `marketDate?`: `YYYY-MM-DD` (if present, prefer this for the RS business date)
  - `time`: epoch ms (publish time)
  - `timing.finalizedAtUTC?`: first detection of finalized bars (ISO)
  - `timing.nextRefreshAtUTC`: schedule-driven next refresh (FYI)

See: `docs/rel-str_partner-data-ready-pubsub-integration.md` for full schema/examples.

---

## Daily Cadence: PRE and POST Runs

- PRE (pre‑close):
  - Purpose: publish intraday snapshot fields on the most recent bar (no finalized bar write).
  - Timing (ET): hourly at 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, and then 15:30; emitted with `runType=ts_daily_pre`.

- POST (post‑close):
  - Purpose: write finalized daily bars and update `latestBarTimestamp` per symbol.
  - Timing (ET): begins at 16:35 (post‑close); emitted with `runType=ts_daily_post`.
  - Payload includes `timing.finalizedAtUTC` when the first finalized bar of the day is detected.

  - Overnight cadence and continuation logic:
    - After the initial POST trigger at ~16:35 ET, the system continues targeted fetch attempts to finalize remaining symbols that are not yet updated for the market day.
    - The refresher tracks which symbols were already finalized before the run and which finalized during the run, computing a pending count.
    - When only a small remainder is pending, an acceleration pass issues focused retries for that subset.
    - Payloads may include a small sample of `remainingSymbols` (when any are pending) for observability.
    - The run concludes when all symbols for the day have a `latestBarTimestamp` equal to the target day or when the schedule advances to the next window.

- Weekends/Holidays:
  - No market date change; no POST message for closed days.
  - Next POST corresponds to the next trading day; use the payload `marketDate` (if present) or infer from `runId` date.

- Late Adjustments / Vendor Corrections:
  - Rare late updates may occur after the initial POST; these can produce an additional POST with the same `marketDate` and a distinct `runId` suffix (e.g., `-manual-XXXX`).
  - These events are uncommon and indicate a vendor correction or manual replay.
  - Operator‑triggered only: these manual/correction POSTs are initiated by Savant operators and should be ignored by RS.

- Manual Runs:
  - Marked via `runId` suffix (e.g., `YYYY-MM-DD-post-manual-1905`).
  - Operator‑triggered only and should be ignored by RS.

- Scheduling Notes:
  - `timing.nextRefreshAtUTC` is the consolidated, schedule‑driven next refresh indicator.
  - Do not poll; prefer Pub/Sub to trigger work.

---

## Auth (Server-to-Server)

- Method: Google OIDC ID token from RS service account (SA)
- Requirements:
  - SA allowlisted (`ALLOWED_SERVICE_ACCOUNT_EMAILS`)
  - Cloud Run IAM `roles/run.invoker` on partner endpoints
  - ID token `aud` equals the exact function URL; include `email` claim

Reference: `docs/partner-integration.md`.

---

## Reading Data for RS

- Endpoint: `partnerTimeSeriesV2` (GET)
- Common pattern for daily RS job (per symbol):
  - `symbol`: e.g., `AAPL`
  - `interval`: `DAILY`
  - Suggested range for RS calc: `1y` to ensure stable lookback
  - Optional guardrails: `limit` to cap rows after filtering

Example (bash):
```bash
HOST="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net"
URL_TS="${HOST}/partnerTimeSeriesV2"
TOKEN_TS="$(gcloud auth print-identity-token --audiences="${URL_TS}" --include-email)"

curl -s -H "Authorization: Bearer ${TOKEN_TS}" \
  "${URL_TS}?symbol=AAPL&interval=DAILY&range=1y"
```

Response highlights:
- Ascending bars, compact schema with adjusted fields (`ac`, `dv`, `sc`)
- Optional `d` (YYYY-MM-DD) alongside epoch `t`
- See example shape in `docs/partner-api-surface.md`

---

## Symbol Universe

- Preferred: consume tracked symbols via `partnerListTrackedSymbolsV2` (GET)
  - `?activeOnly=true&limit=500`
- Alternatively: maintain your own allowlisted universe and call timeseries per symbol

---

## Orchestration & Idempotency

- One RS computation per market day
- Deduplicate by `runId` (treat `YYYY-MM-DD-post` as unique logical run; suffixes 
  like `-manual-XXXX` should not produce duplicate RS writes)
- Persist a per-day checkpoint (e.g., `marketDate` → status `processed`) to skip repeats
- If `marketDate` is absent, derive from `runId` date

---

## Failure, Retry, and Replays

- Use Pub/Sub ack deadlines with retry/backoff until RS job completes
- Make reads idempotent (download-only; never mutate upstream)
- For reprocessing a day:
  - Allow a manual replay path that reuses the same `marketDate` and overwrites RS outputs atomically

---

## Concurrency & Throughput

- Batch symbols; limit concurrency to avoid overwhelming your compute
- `partnerTimeSeriesV2` is read-optimized; prefer modest parallelism (e.g., 10–50 concurrent calls) and backoff on 429/5xx
- Soft cap: default daily range is ~252 bars; RS-specific transforms are typically CPU-bound rather than I/O-bound

---

## Monitoring & Alerts

- Track:
  - Pub/Sub subscription lag and undelivered messages
  - Daily RS job status by `marketDate`
  - Error rates on `partnerTimeSeriesV2` calls
- Suggested log fields to include in your pipeline logs:
  - `component=rs`, `marketDate`, `runId`, `symbolsProcessed`, `durationMs`, `status`

---

## Security Notes

- Keep calls server-to-server only; no browser clients
- Rotate SA keys (if any) and prefer keyless workload identity where possible
- Restrict outbound egress if your platform supports it; only allow the partner endpoints’ hosts

---

## Checklist

- Allowlist RS SA and grant Cloud Run invoker
- Create Pub/Sub subscription with filter: `attributes.runType = "ts_daily_post"`
- Implement consumer with dedupe by `runId`; prefer `marketDate` from payload when present
- On message: fetch symbols (tracked or your curated), call `partnerTimeSeriesV2` (DAILY, ~1y)
- Compute and persist RS outputs atomically per `marketDate`
- Monitor lag, failures, and daily completion SLA

---

## References

- Discovery: `docs/partner-discovery.md`
- Pub/Sub schema: `docs/rel-str_partner-data-ready-pubsub-integration.md`
- Partner endpoints & examples: `docs/partner-api-surface.md`
- Integration & auth details: `docs/partner-integration.md`
