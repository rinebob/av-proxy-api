# Firestore Data Structure (Canonical Reference)

_Last updated: 2025-09-12_

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
