# Split Adjustment & Data Consistency Design

## Overview

This system implements a **Dual-Write Architecture** to handle stock splits and dividend adjustments robustly. It maintains two parallel time-series collections in Firestore:

1.  **`time-series` (Legacy/Raw) — REMOVED**
    *   **Status:** This collection has been **wiped in production** and is no longer written.
    *   **Historical purpose:** Stored data exactly as returned by the Alpha Vantage API.
    *   **Current state:** All reads and writes now use `sa-time-series` exclusively.

2.  **`sa-time-series` (Split-Adjusted)**
    *   **Purpose:** Stores fully adjusted OHLCV data.
    *   **Use Case:** Technical analysis, long-term charting (10+ years), and performance comparison.
    *   **Behavior:**
        *   **Full History:** Always stores the complete available history (20+ years).
        *   **Continuity:** Historic prices are mathematically adjusted backwards from the latest split factor to ensure a smooth chart without artificial gaps.

---

## 1. Real-Time Updates (Daily Flow)

When the system runs its daily update (e.g., via `TIME_SERIES_DAILY_ADJUSTED`):

1.  **Fetch:** The handler fetches the latest daily bar (and up to 100 recent bars in compact mode).
2.  **Dual Write:**
    *   It writes the **Raw** bar to `time-series/{symbol}/years/{year}`.
    *   It writes the **Adjusted** bar to `sa-time-series/{symbol}/years/{year}`.
3.  **Split Detection (Forward Pass):**
    *   During the write to `sa-time-series`, the system checks the `splitCoefficient` field of the incoming bar.
    *   **If `splitCoefficient != 1.0`:**
        1.  **Event Logging:** A document is immediately created in the global `split-events` collection.
        2.  **Local History:** The split event is appended to `symbol-data/{symbol}` -> `splitHistory`.
        3.  **Remediation Enqueue:** The system detects that historical data is now "stale" relative to the new price level. It enqueues a **Split Remediation Task** (Cloud Task) to re-fetch and rewrite the entire history for that symbol in the background.

**Implication for End Users:**
Real-time data appears instantly. If a split occurs today, the chart might look "broken" (gap down/up) for a few seconds/minutes until the background remediation task completes and backfills the adjusted history.

---

## 2. Manual Backfill (Full History)

A "Backfill" is a request with `outputsize=full`. This fetches the entire 20+ year history from Alpha Vantage.

### Behavior
1.  **Bypass Truncation:** The system explicitly disables emulator truncation flags when writing to `sa-time-series`, ensuring deep history is preserved even locally.
2.  **Backwards Pass Adjustment:**
    *   The system iterates through the 5000+ bars *in memory*.
    *   It identifies all split events in the timeline.
    *   It calculates the cumulative split factor for every historical date.
    *   It adjusts `open`, `high`, `low`, `close`, and `volume` for all past bars so they align with the *current* price level.
3.  **Split Event Persistence:**
    *   Unlike the daily flow (which sees one split at a time), the backfill sees *all* historical splits at once.
    *   It batch-writes these events to `split-events` and `symbol-data/{symbol}`.

### How to Invoke Manually

To force a full, split-adjusted backfill for a specific symbol (e.g., AAPL), use the following command. This is useful if data appears corrupted or if you are initializing a new symbol in a dev environment.

**PowerShell Command:**
```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:5001/alpha-vantage-proxy-api/us-central1/alphaVantageApiV2/TIME_SERIES_DAILY_ADJUSTED?symbol=AAPL&outputsize=full&__checkWriteToggle=false" `
  -Headers @{ "Origin" = "http://localhost:4200" }
```

**Parameters:**
*   `symbol=AAPL`: The ticker to backfill.
*   `outputsize=full`: **Critical**. Tells Alpha Vantage to return the full 20+ year CSV/JSON.
*   `__checkWriteToggle=false`: **Critical**. Bypasses the manual write protection normally enforced by the gateway/UI.

---

## 3. Data Schema Differences

This system performs **Split Adjustments Only**. It does **not** adjust for dividends.

| Field | `time-series` (Raw) | `sa-time-series` (Split-Adjusted) |
| :--- | :--- | :--- |
| `c` (Close) | Raw closing price. | **Adjusted** closing price. |
| `o` (Open) | Raw open. | **Adjusted** open. |
| `h` (High) | Raw high. | **Adjusted** high. |
| `l` (Low) | Raw low. | **Adjusted** low. |
| `v` (Volume) | Raw volume. | **Raw** volume (Volume is **not** adjusted). |
| `ch` (Change) | Raw change ($). | **Adjusted** change ($). |
| `cp` (Change %) | Raw change %. | **Raw** change % (invariant under linear scaling). |
| `sc` (Split Coeff) | Included if present. | Included if present (used to derive the series). |
| `ac` (Adj Close) | Included if present. | **Provider Adjusted** (Kept as-is; already includes splits/dividends). |

> **Note:** The `ac` field from Alpha Vantage typically includes dividend adjustments. However, our `sa-time-series` calculation is strictly based on the Split Coefficient (`sc`). Therefore, `sa-time-series` preserves the price action relative to splits but does not strip out dividend drops.

## 4. Troubleshooting Missing Splits

If `sa-time-series` does not seem to reflect a known split:

1.  **Check `split-events` collection:** Does a document exist for `YYYY-MM-DD-{SYMBOL}-{FACTOR}`?
2.  **Check Logs:** Look for "Backwards Pass" or "Split Detected" logs in the Cloud Functions console.
3.  **Force Backfill:** Run the manual command above. This is self-healing; it will re-detect all splits and re-write the entire adjusted timeline.

## 5. API Access (Partner Endpoint)

External applications (like RelStr) can access the split-adjusted data via the `partnerTimeSeriesV2` endpoint.

### Request Format

Append the `adjusted=true` query parameter to the request.

```http
GET /partnerTimeSeriesV2?symbol={SYMBOL}&interval={INTERVAL}&adjusted=true
```

### Parameters

*   `symbol`: The stock ticker (e.g., `NVDA`).
*   `interval`: Time resolution (`daily`, `weekly`, `monthly`).
*   `adjusted`: **Boolean** (optional).
    *   `true` (or omitted): Returns data from the `sa-time-series` collection (Split-Adjusted). This is the default.
    *   The legacy `time-series` (raw) collection has been **wiped in production**, so all reads effectively return split-adjusted data.

### Example

```http
https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2?symbol=NVDA&interval=daily
```
