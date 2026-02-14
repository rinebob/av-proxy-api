# Firestore Data Structure (Canonical Reference)

_Last updated: 2026-02-14_

This document describes the canonical Firestore data structure for the Financial Data Proxy API Surface project.

---

## Top-Level Collections

| Collection         | First-Level Doc ID | Example Path                                      | Purpose/Notes                                   |
|--------------------|-------------------|---------------------------------------------------|-------------------------------------------------|
| tracked-symbols    | Symbol            | /tracked-symbols/MSFT                             | List of all tracked symbols                     |
| symbol-data        | Symbol            | /symbol-data/AAPL/sa-time-series/av-daily-adjusted | **All symbol-specific data grouped by symbol**  |
| realtime-runs      | Run ID            | /realtime-runs/2026-02-14-FRI-A-DAILY-LIVE-POST-1635 | **Time-series job pipeline run tracking (A/B/C)** |
| backfill-runs      | Run ID            | /backfill-runs/{runId}                            | **Full backfill run tracking**                  |
| jobs               | Job ID            | /jobs/{runId}_{symbol}_{endpoint}                 | **Individual time-series job documents**         |
| market-data        | Request-based     | /market-data/bz-ipos                              | Market-wide or endpoint-specific data           |
| economics          | Request-based     | /economics/bz-economic-calendar                   | Macroeconomic data (e.g., GDP, CPI)             |
| news               | Request-based     | /news/<doc-name>                                  | News articles, sentiment, or related data       |
| runs               | Run ID            | /runs/2025-09-11-post                              | **Legacy** — PDR publisher run tracking (pre-pipeline) |

---

## Symbol Data Subcollections

Under each `symbol-data/{symbol}` document, the following subcollections may exist:

| Subcollection      | Example Path                                            | Purpose/Notes                         |
|--------------------|--------------------------------------------------------|---------------------------------------|
| sa-time-series     | /symbol-data/AAPL/sa-time-series/av-daily-adjusted      | **Canonical** split-adjusted time-series (D/W/M) |
| earnings           | /symbol-data/AAPL/earnings/bz-earnings                 | Earnings data for the symbol          |
| dividends          | /symbol-data/AAPL/dividends/bz-dividends               | Dividend data for the symbol          |
| company-overview   | /symbol-data/AAPL/company-overview/av-company-overview | Company overview/fundamental data     |
| ...                | ...                                                    | Add new subcollections as needed      |

> **Legacy note:** The older `time-series` subcollection has been **wiped in production** and is no longer written. All OHLCV reads now use `sa-time-series` exclusively.

---

## Time-Series Sharded Storage (Alpha Vantage)

- Canonical path per interval: `symbol-data/{symbol}/sa-time-series/{provider-interval}` (e.g., `av-daily-adjusted`).
- Shards by year: `years/{YYYY}` holding arrays of compact bars. See the detailed shape in "Symbol Data: Year‑Sharded Time‑Series Doc Shape" below.
- The top-level time-series doc may store minimal metadata such as `latestBarTimestamp` and derived fields for freshness; all bars live in year documents.

### Applying Time Series Updates (No GLOBAL_QUOTE)

- We do not persist or use a standalone `GLOBAL_QUOTE` document for time-series updates.
- Initialization:
  - On symbol add, call the corresponding time-series endpoint with `outputsize=full` and write all bars via sharded writers.
- Ongoing updates:
  - Daily time series: run twice each trading day — pre-close and post-close — calling the daily endpoint with `outputsize=compact` and applying the most recent element.
  - Weekly and monthly time series: run every trading day post-close, also with `outputsize=compact`. There is no special week/month-end rollup; we always request the same endpoints each trading day and use the most recent element.
  - There is no separate boundary-window logic.
- Field usage:
  - Persist only fields present in the time-series payload: open, high, low, close, adjusted close, volume, dividend amount, split coefficient.
  - Do NOT calculate or persist `previous close`, `change`, or `change percent` on time-series documents.

### Company Overview for Non-Company Symbols

- `company-overview` is skipped for non-company symbols (e.g., ETFs, crypto). The refresher reads `tracked-symbols/{symbol}.type` and only calls OVERVIEW for equities/companies.

---

## Operational Collections (Time-Series Job Pipeline)

The time-series job pipeline uses three collections. For full details see `docs/pipeline/time-series-job-pipeline-deep-dive.md`.

### realtime-runs/{runId}

- Purpose: Tracks A/B/C scheduled run lifecycle, per-interval job counts, retry symbols, and PDR publishing.
- Run ID format: `YYYY-MM-DD-DOW-SEQ-INTERVAL-LIVE|MANUAL-PHASE-HHMM`
- Example: `/realtime-runs/2026-02-14-FRI-A-DAILY-LIVE-POST-1635`
- Key fields:
  - `status: 'IN_PROGRESS' | 'COMPLETE'`
  - `sequence: 'A' | 'B' | 'C'`
  - `runType: 'REALTIME'`
  - `createdJobs, finishedJobs, successJobs, permanentFailureJobs` (atomic counters)
  - `retrySymbols, retrySuccessSymbols, staleSymbols, permanentFailureSymbols` (arrays)
  - `partnerDataReady: { publishedAt, messageId }` (set when PDR is emitted)
  - `runCreatedAt, runStartedAt, runFinishedAt` (Timestamps)

### backfill-runs/{runId}

- Purpose: Tracks full-backfill run lifecycle (same shape as realtime-runs but `runType: 'BACKFILL'`).
- Example: `/backfill-runs/2026-01-23-BACKFILL-DAILY-1200`

### jobs/{jobId}

- Purpose: Individual per-symbol/per-endpoint job documents.
- Job ID format: `{runId}_{SYMBOL}_{ENDPOINT}`
- Key fields:
  - `status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'TRANSIENT_FAILURE' | 'PERMANENT_FAILURE'`
  - `symbol, endpoint, interval, phase, marketDate, runId`
  - `attempts, maxAttempts` (retry tracking)
  - `dataFreshness: 'UNKNOWN' | 'FRESH' | 'STALE'`
  - `createdAt, updatedAt, firstAttemptedAt`

### runs/{runId} (Legacy)

> **Deprecated.** The `runs` collection was used by the pre-pipeline PDR publisher. It is still written by the direct publisher script but is not used by the A/B/C pipeline.

- Example path: `/runs/2025-09-11-post-1000`
- See git history for the legacy schema.

---

## Example Document Paths

---

## System Finalization and Status (Daily Adjusted)

- Finalization marker (created only after dataset validation passes):
  - Path: `/system/time-series-finalization/daily-adjusted/{YYYY-MM-DD}`
  - Fields:
    - `marketDate: string` (YYYY-MM-DD)
    - `finalizedAtUTC: string` (ISO UTC)
    - `finalizedAtET: string` (ET wall clock, YYYY-MM-DD HH:mm:ss)
    - `totalSymbols: number`
    - `finalizedCountTotal: number`
    - `phase: 'post'`
    - `source: 'av-refresh-manager'`
    - `timing: { createdAt: Timestamp, updatedAt: Timestamp }`
  - Trigger:
    - Firestore onCreate publishes a single partner data-ready POST message (ts-daily-post).

- Status doc (run summaries, validation, remediation):
  - Path: `/system/time-series-status/daily-adjusted/{YYYY-MM-DD}`
  - Fields (subset):
    - `runs[]` and `currentRun` snapshots for begin/end bookkeeping
    - `counts: { totalSymbols, finalizedCountTotal, pendingCount, deltaCount }`
    - `validation: { totalSymbols, checked, failures, warnings, failedSymbolsSample[], updatedAt }`
    - `remediation: { needsRemediation: boolean, failedSymbolsSample[], updatedAt }`
  - Notes:
    - Validation runs before finalization. If it fails, `needsRemediation=true` is set and an inline remediation re-fetch runs for failed symbols, then validation re-runs. Finalization is written only on pass.

---

## Symbol Data: Year‑Sharded Time‑Series Doc Shape (Alpha Vantage, Adjusted Only)

- Path pattern (DAILY_ADJUSTED, **sa-time-series**):
  - `/symbol-data/{SYMBOL}/sa-time-series/av-daily-adjusted/years/{YYYY}`

- Year doc fields:
  ```json
  {
    "bars": [
      {
        "t": 1731542400000,
        "d": "2024-11-14",
        "dow": 4,
        "o": 189.12,
        "h": 191.02,
        "l": 188.50,
        "c": 190.77,
        "v": 45678900,
        "ac": 190.77,
        "dv": 0,
        "sc": 1,
        "pc": 188.40,
        "ch": 2.37,
        "cp": 1.26,
        "ip": 190.70,
        "io": 1731619200000,
        "it": "16:00",
        "ic": 0.30,
        "ipc": 0.16,
        "fz": 1731621312000
      }
    ],
    "count": 252,
    "firstBarTs": 1704672000000,
    "lastBarTs": 1732060800000,
    "latest": { /* last non-placeholder bar (same shape as a bar) */ },
    "latestUtcIso": "2024-11-20T00:00:00.000Z",
    "latestEtDateTime": "2024-11-19 16:00:00",
    "latestIoUtcIso": "2024-11-19T21:00:00.000Z",
    "latestIoEtDateTime": "2024-11-19 16:00:00",
    "version": "1732060800000-252",
    "updatedAt": "<Timestamp>"
  }
  ```

- Notes
  - `bars` is an array of CompactBar objects sorted ascending by `t` (UTC midnight of market date).
  - `fz` (finalized-at ms) is stamped when the daily bar first finalizes post-close and is present only for non-placeholder bars.
  - `io/it/ip/ic/ipc` are intraday snapshot fields and may be present from pre-close writes.
  - `latest*` fields are derived conveniences: last non-placeholder bar, its UTC/ET strings, and latest intraday observation timestamps.
  - Monthly uses a single `all` doc at `/symbol-data/{SYMBOL}/sa-time-series/av-monthly-adjusted/all` with the same `bars` shape.
