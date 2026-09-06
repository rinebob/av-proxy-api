# Partner Earnings APIs — Discovery Document

Audience: External partner engineering/admin teams. Read `partner-discovery.md` first for auth model and operational checklist.

Last updated: 2026-08-23

---

## Purpose

Savant exposes three Alpha Vantage earnings endpoints through the `alphaVantageApiV2` gateway function. These provide historical earnings (EPS), analyst estimates, and a forward earnings calendar. Data is fetched live from Alpha Vantage on each request and cached in Firestore with endpoint-specific TTLs.

| Endpoint | AV Function | Scope | TTL | Format |
|---|---|---|---|---|
| Earnings | `EARNINGS` | Per-symbol | 7 days | JSON |
| Earnings Estimates | `EARNINGS_ESTIMATES` | Per-symbol | 7 days | JSON |
| Earnings Calendar | `EARNINGS_CALENDAR` | Global (all tracked symbols) | 1 day | CSV → JSON array |

---

## Gateway Endpoint

All three endpoints are routed through a single gateway Cloud Function.

| Property | Value |
|---|---|
| Function name | `alphaVantageApiV2` |
| HTTP method | `GET` |
| Auth | Origin-restricted (browser-facing). No partner OIDC. |
| Base URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/alphaVantageApiV2` |
| Path format | `/{ENDPOINT}` (e.g., `/EARNINGS`, `/EARNINGS_ESTIMATES`, `/EARNINGS_CALENDAR`) |

### URL and Audience Note (2nd Gen / Cloud Run)

This is a **2nd gen Cloud Function** backed by Cloud Run. It has two URLs:

- **`cloudfunctions.net` URL** — the canonical invoke URL:
  `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/alphaVantageApiV2/{ENDPOINT}`
- **`run.app` URL** — the underlying Cloud Run service URL (visible in deploy output, not used directly):
  `https://alphavantageapiv2-lsluydmucq-uc.a.run.app/{ENDPOINT}`

**Always use the `cloudfunctions.net` URL.**

> **Auth note:** This gateway is browser-facing and protected by Origin checks, not OIDC. It is intended for the Savant Data Maintainer UI. For server-to-server access, partners should use the dedicated partner endpoints (`partnerCompanyOverviewV2`, `partnerTimeSeriesV2`, etc.) which support Google OIDC. If you need server-to-server access to earnings data, contact Savant to request a dedicated partner endpoint.

---

## 1. Earnings (`EARNINGS`)

Returns annual and quarterly earnings (EPS) for a single equity symbol.

### Request

```
GET /alphaVantageApiV2/EARNINGS?symbol=AAPL
```

| Parameter | Required | Type | Description |
|---|---|---|---|
| `symbol` | Yes | string | Ticker symbol (case-insensitive). Example: `AAPL` |

### Response — `200 OK`

```json
{
  "data": {
    "symbol": "AAPL",
    "annualEarnings": [
      { "fiscalDateEnding": "2025-09-30", "reportedEPS": "6.84" },
      { "fiscalDateEnding": "2024-09-30", "reportedEPS": "6.11" }
    ],
    "quarterlyEarnings": [
      {
        "fiscalDateEnding": "2025-06-30",
        "reportedDate": "2025-07-31",
        "reportedEPS": "1.85",
        "estimatedEPS": "1.83",
        "surprise": "0.02",
        "surprisePercentage": "1.09",
        "reportTime": "post-market"
      }
    ]
  },
  "metadata": {
    "timestamp": "2026-08-23T17:00:00.000Z",
    "endpoint": "EARNINGS",
    "ttl": 604800,
    "requestId": "a1b2c3d4",
    "processingTimeMs": 420
  }
}
```

### Field Reference

**Top-level:**

| Field | Type | Description |
|---|---|---|
| `data` | `AvEarningsResponse` | Earnings data object |
| `metadata` | object | Response metadata (timestamp, endpoint, ttl, requestId, processingTimeMs) |

**`data.annualEarnings[]`:**

| Field | Type | Description |
|---|---|---|
| `fiscalDateEnding` | string | Fiscal year end date (`YYYY-MM-DD`) |
| `reportedEPS` | string | Reported earnings per share for the fiscal year |

**`data.quarterlyEarnings[]`:**

| Field | Type | Description |
|---|---|---|
| `fiscalDateEnding` | string | Fiscal quarter end date (`YYYY-MM-DD`) |
| `reportedDate` | string | Date the earnings were reported (`YYYY-MM-DD`) |
| `reportedEPS` | string | Actual reported EPS |
| `estimatedEPS` | string | Consensus estimated EPS |
| `surprise` | string | Difference between reported and estimated EPS |
| `surprisePercentage` | string | Surprise as a percentage of the estimate |
| `reportTime` | string \| undefined | `"pre-market"` or `"post-market"`. Omitted if AV does not provide it. |

> **Note:** All numeric values are strings (as returned by AV). Parse defensively.

### Data Freshness

- **Source:** Firestore `symbol-data/{SYMBOL}/earnings/av-earnings`
- **TTL:** 7 days (604800 seconds)
- **Refresh:** Internal `refreshAlphaVantageDataV2` scheduler
- **Coverage:** Equity symbols only

---

## 2. Earnings Estimates (`EARNINGS_ESTIMATES`)

Returns analyst EPS and revenue estimates for a single equity symbol, including revision history and analyst counts.

### Request

```
GET /alphaVantageApiV2/EARNINGS_ESTIMATES?symbol=AAPL
```

| Parameter | Required | Type | Description |
|---|---|---|---|
| `symbol` | Yes | string | Ticker symbol (case-insensitive). Example: `AAPL` |

### Response — `200 OK`

```json
{
  "data": {
    "symbol": "AAPL",
    "estimates": [
      {
        "date": "2025-09-30",
        "horizon": "fiscal year",
        "eps_estimate_average": "6.85",
        "eps_estimate_high": "7.10",
        "eps_estimate_low": "6.50",
        "eps_estimate_analyst_count": "28",
        "eps_estimate_average_7_days_ago": "6.80",
        "eps_estimate_average_30_days_ago": "6.75",
        "eps_estimate_average_60_days_ago": "6.70",
        "eps_estimate_average_90_days_ago": "6.65",
        "eps_estimate_revision_up_trailing_7_days": "3",
        "eps_estimate_revision_down_trailing_7_days": "1",
        "eps_estimate_revision_up_trailing_30_days": "8",
        "eps_estimate_revision_down_trailing_30_days": "2",
        "revenue_estimate_average": "90000000000000",
        "revenue_estimate_high": "95000000000000",
        "revenue_estimate_low": "85000000000000",
        "revenue_estimate_analyst_count": "25"
      }
    ]
  },
  "metadata": {
    "timestamp": "2026-08-23T17:00:00.000Z",
    "endpoint": "EARNINGS_ESTIMATES",
    "ttl": 604800,
    "requestId": "e5f6g7h8",
    "processingTimeMs": 380
  }
}
```

### Field Reference

**`data.estimates[]`:**

| Field | Type | Description |
|---|---|---|
| `date` | string | Period end date (`YYYY-MM-DD`) |
| `horizon` | string \| undefined | `"fiscal year"` or `"fiscal quarter"` |
| `eps_estimate_average` | string | Consensus average EPS estimate |
| `eps_estimate_high` | string | Highest EPS estimate among analysts |
| `eps_estimate_low` | string | Lowest EPS estimate among analysts |
| `eps_estimate_analyst_count` | string | Number of analysts providing EPS estimates |
| `eps_estimate_average_7_days_ago` | string | Consensus EPS estimate 7 days ago |
| `eps_estimate_average_30_days_ago` | string | Consensus EPS estimate 30 days ago |
| `eps_estimate_average_60_days_ago` | string | Consensus EPS estimate 60 days ago |
| `eps_estimate_average_90_days_ago` | string | Consensus EPS estimate 90 days ago |
| `eps_estimate_revision_up_trailing_7_days` | string \| null | Upward revisions in trailing 7 days. `null` if no revisions. |
| `eps_estimate_revision_down_trailing_7_days` | string \| null | Downward revisions in trailing 7 days. `null` if no revisions. |
| `eps_estimate_revision_up_trailing_30_days` | string \| null | Upward revisions in trailing 30 days. `null` if no revisions. |
| `eps_estimate_revision_down_trailing_30_days` | string \| null | Downward revisions in trailing 30 days. `null` if no revisions. |
| `revenue_estimate_average` | string | Consensus average revenue estimate |
| `revenue_estimate_high` | string | Highest revenue estimate |
| `revenue_estimate_low` | string | Lowest revenue estimate |
| `revenue_estimate_analyst_count` | string | Number of analysts providing revenue estimates |

> **Notes:**
> - All numeric values are strings (as returned by AV). Parse defensively.
> - Revision count fields can be `null` when no revisions have occurred.
> - `horizon` can be omitted if AV does not provide it.

### Data Freshness

- **Source:** Firestore `symbol-data/{SYMBOL}/earnings/av-earnings-estimates`
- **TTL:** 7 days (604800 seconds)
- **Refresh:** Internal `refreshAlphaVantageDataV2` scheduler
- **Coverage:** Equity symbols only

---

## 3. Earnings Calendar (`EARNINGS_CALENDAR`)

Returns a 12-month forward earnings calendar for all tracked symbols. This is a **global** endpoint — no symbol parameter is required. The handler fetches the full AV calendar, parses the CSV, and filters to only symbols in the `tracked-symbols` Firestore collection.

### Request

```
GET /alphaVantageApiV2/EARNINGS_CALENDAR
```

| Parameter | Required | Type | Description |
|---|---|---|---|
| `symbol` | No | string | Optional. If provided, filters to a single symbol. If omitted, returns all tracked symbols. |
| `horizon` | No | string | Time horizon. Default: `12month`. Options: `3month`, `6month`, `12month`. |

### Response — `200 OK`

```json
{
  "data": [
    {
      "symbol": "AAPL",
      "name": "Apple Inc",
      "reportDate": "2026-10-29",
      "fiscalDateEnding": "2026-09-30",
      "estimate": "1.85",
      "currency": "US",
      "timeOfTheDay": "after close"
    },
    {
      "symbol": "MSFT",
      "name": "Microsoft Corp",
      "reportDate": "2026-10-22",
      "fiscalDateEnding": "2026-09-30",
      "estimate": "3.10",
      "currency": "US",
      "timeOfTheDay": "after close"
    }
  ],
  "metadata": {
    "timestamp": "2026-08-23T17:00:00.000Z",
    "endpoint": "EARNINGS_CALENDAR",
    "ttl": 86400,
    "requestId": "i9j0k1l2",
    "processingTimeMs": 1250
  }
}
```

### Field Reference

**`data[]` (array of entries):**

| Field | Type | Description |
|---|---|---|
| `symbol` | string | Ticker symbol |
| `name` | string | Company name |
| `reportDate` | string | Expected earnings report date (`YYYY-MM-DD`) |
| `fiscalDateEnding` | string | Fiscal period end date (`YYYY-MM-DD`) |
| `estimate` | string | Consensus EPS estimate. **Can be empty string** if AV has no estimate. |
| `currency` | string | Exchange/market identifier (e.g., `US`). AV returns this as `exchange`; we map it to `currency`. |
| `timeOfTheDay` | string | Reporting time (e.g., `before open`, `after close`). **Can be empty string** if AV has no timing data. |

> **Notes:**
> - The response is a **JSON array** (not an object like the other two endpoints).
> - `estimate` and `timeOfTheDay` can be empty strings — parse defensively.
> - The `currency` field is mapped from AV's `exchange` column. It represents the exchange (e.g., `US`), not a currency code (e.g., `USD`).
> - The calendar is filtered to tracked symbols only (~100 symbols). The full AV response has ~1,814 rows; after filtering, the stored doc is ~60-80KB.

### Data Freshness

- **Source:** Firestore `market-data/av-earnings-calendar` (global, no symbol in path)
- **TTL:** 1 day (86400 seconds)
- **Refresh:** Internal `refreshAlphaVantageDataV2` scheduler — processes global endpoints once per refresh cycle (not per-symbol)
- **Coverage:** All tracked symbols (filtered from AV's full 12-month calendar)

---

## Error Responses

All three endpoints share the same error format:

### Error — `400 Bad Request`

```json
{
  "error": "Missing required parameter: symbol",
  "code": "BAD_REQUEST",
  "details": {},
  "timestamp": "2026-08-23T17:00:00.000Z",
  "requestId": "a1b2c3d4",
  "processingTimeMs": 2
}
```

### Error — `403 Forbidden` (origin not allowed)

```json
{
  "error": "Forbidden",
  "message": "This endpoint is only accessible from approved origins.",
  "allowedOrigins": ["https://www.savantapi.com"],
  "requestId": "a1b2c3d4"
}
```

### Error — `404 Not Found` (endpoint not registered)

```json
{
  "error": "Not Found",
  "message": "No handler found for endpoint: INVALID_ENDPOINT"
}
```

### Error — `500 Internal Server Error`

```json
{
  "error": "An unknown error occurred",
  "code": "UNKNOWN_ERROR",
  "details": {},
  "timestamp": "2026-08-23T17:00:00.000Z",
  "requestId": "a1b2c3d4",
  "processingTimeMs": 5000
}
```

---

## Example Requests

```bash
# Earnings (per-symbol)
curl "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/alphaVantageApiV2/EARNINGS?symbol=AAPL" \
  -H "Origin: https://www.savantapi.com"

# Earnings Estimates (per-symbol)
curl "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/alphaVantageApiV2/EARNINGS_ESTIMATES?symbol=AAPL" \
  -H "Origin: https://www.savantapi.com"

# Earnings Calendar (global, no symbol)
curl "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/alphaVantageApiV2/EARNINGS_CALENDAR" \
  -H "Origin: https://www.savantapi.com"

# Earnings Calendar (3-month horizon)
curl "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/alphaVantageApiV2/EARNINGS_CALENDAR?horizon=3month" \
  -H "Origin: https://www.savantapi.com"

# Earnings Calendar (filtered to single symbol)
curl "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/alphaVantageApiV2/EARNINGS_CALENDAR?symbol=AAPL" \
  -H "Origin: https://www.savantapi.com"
```

---

## Firestore Storage Paths

| Endpoint | Firestore Path | Scope |
|---|---|---|
| Earnings | `symbol-data/{SYMBOL}/earnings/av-earnings` | Per-symbol |
| Earnings Estimates | `symbol-data/{SYMBOL}/earnings/av-earnings-estimates` | Per-symbol |
| Earnings Calendar | `market-data/av-earnings-calendar` | Global |

All paths are readable by authenticated clients (Firestore rules allow public reads on `symbol-data` and `market-data` collections). Writes are restricted to admin tokens and backend functions (Admin SDK bypasses rules).

---

## Related Documents

- `docs/partner/partner-discovery.md` — Auth model, operational checklist, full endpoint inventory
- `docs/partner/partner-company-overview.md` — Company Overview API (similar per-symbol pattern)
- `docs/partner/partner-integration.md` — Step-by-step integration examples
- `docs/topics/33-earnings/PRD-av-sa-earnings-endpoints.md` — Internal PRD for earnings endpoints
