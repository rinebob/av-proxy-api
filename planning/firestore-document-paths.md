# Firestore Data Structure (Canonical Reference)

_Last updated: 2025-09-16_

This document describes the canonical Firestore data structure for the Financial Data Proxy API Surface project.

---

## Top-Level Collections

| Collection         | First-Level Doc ID | Example Path                                      | Purpose/Notes                                   |
|--------------------|-------------------|---------------------------------------------------|-------------------------------------------------|
| tracked-symbols    | Symbol            | /tracked-symbols/MSFT                             | List of all tracked symbols                     |
| symbol-data        | Symbol            | /symbol-data/AAPL/time-series/av-daily            | **All symbol-specific data grouped by symbol**  |
| market-data        | Request-based     | /market-data/bz-ipos                              | Market-wide or endpoint-specific data           |
| economics          | Request-based     | /economics/bz-economic-calendar                   | Macroeconomic data (e.g., GDP, CPI)             |
| news               | Request-based     | /news/<doc-name>                                  | News articles, sentiment, or related data       |
| runs               | Run ID            | /runs/2025-09-11-post                              | Processing state machine for internal jobs      |

---

## Symbol Data Subcollections

Under each `symbol-data/{symbol}` document, the following subcollections may exist:

| Subcollection      | Example Path                                            | Purpose/Notes                         |
|--------------------|--------------------------------------------------------|---------------------------------------|
| time-series        | /symbol-data/AAPL/time-series/av-daily                  | Symbol time-series data (by canonical AV doc id) |
| earnings           | /symbol-data/AAPL/earnings/bz-earnings                 | Earnings data for the symbol          |
| dividends          | /symbol-data/AAPL/dividends/bz-dividends               | Dividend data for the symbol          |
| company-overview   | /symbol-data/AAPL/company-overview/av-company-overview | Company overview/fundamental data     |
| ...                | ...                                                    | Add new subcollections as needed      |

---

## Time-Series Sharded Storage (Alpha Vantage)

- Canonical path per interval: `symbol-data/{symbol}/time-series/{provider-interval}` (e.g., `av-daily-adjusted`).
- Shards by day: `days/{YYYY-MM-DD}/bars/{ISO_TIMESTAMP}` holding compact bars.
- Top-level time-series doc stores only metadata and `latestBarTimestamp`.

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

## Operational Collections (Internal Jobs)

- runs/{runId}
  - Purpose: state machine tracking processing lifecycle for internal refresh/notification jobs
  - Example path: `/runs/2025-09-11-post-1000`
  - Canonical fields (lean schema):
    - `status: 'received' | 'enqueued' | 'processing' | 'completed' | 'completed_with_errors' | 'failed'`
    - `phase: 'pre' | 'post'`
    - `intervals: string[]` (e.g., `["daily"]`)
    - `marketDate: string` (YYYY-MM-DD)
    - `counts: {`
      - `symbolsUpdated: number`
      - `baselinesUpdated: number`
      - `symbolsUpdatedCount: number` (legacy mirror)
      - `baselinesUpdatedCount: number` (legacy mirror)
      - `}`
    - `header: { runStatus: 'processing' | 'completed' | 'completed_with_errors' | null }`
    - `timing: {`
      - `createdAt: serverTimestamp`
      - `updatedAt: serverTimestamp`
      - `enqueuedAt: serverTimestamp | null`
      - `endTimeUTC: string | null` (RFC3339 UTC)
      - `nextRefreshAtUTC: string | null` (RFC3339 UTC)
      - `}`
    - `runMeta: {`
      - `requestId: string`
      - `messageId: string | null` (Pub/Sub message id)
      - `publisherEmail: string`
      - `env: string`
      - `runType: string` (e.g., `ts-daily-pre`, `heartbeat`)
      - `trigger: 'manual' | 'scheduled' | 'heartbeat' | undefined`
      - `payloadVersion: 'v1'`
      - `}`
    - `warnings?: string[]`
    - `error?: string`

  - Notes:
    - We do not persist the full inbound payload or Pub/Sub attributes in this document.
    - `header.runStatus` reflects the payload's `runStatus` (not legacy `status` begin/end).
    - Legacy count keys remain during transition; prefer reading normalized keys.

---

## Example Document Paths
