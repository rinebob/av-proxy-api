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

### Applying Global Quote (GLOBAL_QUOTE)

- We do not persist a standalone `GLOBAL_QUOTE` document.
- Instead, quotes drive updates to the most recent time-series shards. A separate quote request is issued per symbol/interval combination, and applied only to that interval:
  - Pre-close: write intraday-only fields on the current day’s bar:
    - `intradayPrice`, `intradayObservedAt`, `intradayTime`
  - Post-close (EOD): finalize the day’s bar using the quote’s `price` (Global Quote field 05) as the close; reconcile high/low/volume if present.
  - Weekly/monthly: at boundary windows, roll/update the latest week/month bar accordingly.
- Adjusted vs non-adjusted:
  - Intraday updates do not synthesize adjusted values.
  - Adjusted values are refreshed via adjusted endpoints when needed (splits/dividends), not on frequent loops.

### Company Overview for Non-Company Symbols

- `company-overview` is skipped for non-company symbols (e.g., ETFs, crypto). The refresher reads `tracked-symbols/{symbol}.type` and only calls OVERVIEW for equities/companies.

---

## Operational Collections (Internal Jobs)

- runs/{runId}
  - Purpose: state machine tracking processing lifecycle for internal refresh/notification jobs
  - Example path: `/runs/2025-09-11-post`
  - Example fields:
    - `status: 'received' | 'enqueued' | 'processing' | 'completed' | 'failed'`
    - `createdAt, updatedAt: serverTimestamp`
    - `enqueuedAt, processingStartedAt, processingCompletedAt, failureAt: serverTimestamp?`
    - `phase: 'pre' | 'post'`
    - `intervals: string[]`
    - `marketDate: YYYY-MM-DD?`
    - `pubsubMessageId: string?`
    - `counts: { baselinesUpdatedCount?: number | null; symbolsUpdatedCount?: number | null }`
    - `error: string?`

---

## Example Document Paths
