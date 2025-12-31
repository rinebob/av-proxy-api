# Partner API: US Market Holidays

## Overview

This endpoint exposes a **unified US equities market holiday calendar** (NYSE/Nasdaq) by **year**.  
Partners (e.g., RS) should treat this as the **source of truth** and mirror the data into their own internal DBs.

Use cases:

- **Determine if tomorrow is a full holiday or early-close** to know whether **today’s bar is the final weekly/monthly bar**.
- Drive other US market calendar logic (e.g., UI badges, scheduling, job control).

---

## Endpoint

> Replace `<BASE_URL>` with the deployed Cloud Functions base for the partner APIs  
> (same host as `partnerTimeSeriesV2`).

**HTTP Method**

- `GET`

**Path**

- `/partnerMarketHolidays`

**Example URL**

```text
GET <BASE_URL>/partnerMarketHolidays?year=2025
```

---

## Authentication

This endpoint uses the **same auth model** as `partnerTimeSeriesV2`:

- **Required**: `Authorization: Bearer <token>`
- Supported tokens:
  - **Google OIDC** service-account tokens for allowlisted service accounts  
  - **Firebase ID tokens** (if applicable)

If auth fails, the endpoint returns `401` or `403` with a JSON error body.

---

## Query Parameters

| Name | Type   | Required | Description                        | Example |
|------|--------|----------|------------------------------------|---------|
| year | string | Yes      | 4-digit year (`YYYY`) to fetch    | `2025`  |

- **No exchange parameter**: holidays are unified for the US equities market (NYSE/Nasdaq).

---

## Response: Success (200)

### Shape

```json
{
  "ok": true,
  "year": "2025",
  "holidays": [
    {
      "name": "New Year's Day",
      "date": "2025-01-01",
      "status": "closed"
    },
    {
      "name": "Martin Luther King, Jr. Day",
      "date": "2025-01-20",
      "status": "closed"
    }
    // ...
  ],
  "processingTimeMs": 5,
  "timestamp": "2025-12-23T18:15:00.000Z"
}
```

### `holidays[]` item schema

```ts
type MarketHolidayStatus = 'closed' | 'early_close';

interface MarketHolidayItem {
  name: string;             // Human-readable holiday name
  date: string;             // YYYY-MM-DD (observed calendar date)
  status: MarketHolidayStatus; // 'closed' or 'early_close'
  earlyCloseEt?: string;    // Optional, e.g. "13:00" for early-close days (ET)
  notes?: string;           // Optional text (e.g. "observed" semantics)
}
```

---

## Current Coverage (Initial SOT)

### 2025 (US Market)

All have `status: "closed"`:

- 2025-01-01 — New Year's Day  
- 2025-01-20 — Martin Luther King, Jr. Day  
- 2025-02-17 — Presidents Day  
- 2025-04-18 — Good Friday  
- 2025-05-26 — Memorial Day  
- 2025-06-19 — Juneteenth National Independence Day  
- 2025-07-04 — Independence Day  
- 2025-09-01 — Labor Day  
- 2025-11-27 — Thanksgiving Day  
- 2025-12-25 — Christmas Day  

### 2026 (US Market)

`status: "closed"`:

- 2026-01-01 — New Year's Day  
- 2026-01-19 — Martin Luther King, Jr. Day  
- 2026-02-16 — Presidents Day  
- 2026-04-03 — Good Friday  
- 2026-05-25 — Memorial Day  
- 2026-06-19 — Juneteenth  
- 2026-07-03 — Independence Day (Observed)  
- 2026-09-07 — Labor Day  
- 2026-11-26 — Thanksgiving Day  
- 2026-12-25 — Christmas Day  

`status: "early_close"`:

- 2026-11-27 — Day After Thanksgiving (Early Close @ **13:00 ET**)  
- 2026-12-24 — Christmas Eve (Early Close @ **13:00 ET**)  

---

## Error Responses

### 400 BAD_REQUEST (invalid or missing year)

```json
{
  "ok": false,
  "error": "BAD_REQUEST",
  "code": "BAD_REQUEST",
  "message": "Missing or invalid year. Expected year=YYYY."
}
```

### 404 NOT_FOUND (no data for requested year)

```json
{
  "ok": false,
  "error": "NOT_FOUND",
  "code": "NOT_FOUND",
  "message": "No holiday data available for year=2027."
}
```

### 401 / 403 (auth issues)

```json
{
  "error": "Unauthorized or Forbidden",
  "message": "Invalid or unauthorized token."
}
```

### 500 INTERNAL_ERROR

```json
{
  "ok": false,
  "error": "Some message",
  "code": "INTERNAL_ERROR",
  "timestamp": "2025-12-23T18:15:00.000Z"
}
```

---

## Usage Patterns for RS

### 1. Initial Sync into RS DB

For each year RS needs (e.g. 2025, 2026):

1. Call:

   ```http
   GET <BASE_URL>/partnerMarketHolidays?year=2025
   Authorization: Bearer <RS token>
   ```

2. Store the resulting `holidays[]` into RS’s internal DB/table.

### 2. “Is Tomorrow a Holiday / Early Close?” Logic

In RS (pseudocode):

```ts
// Assume RS has mirrored holidays for year Y into its DB
function isMarketClosedOn(dateYmd: string): { closed: boolean; earlyClose?: string } {
  const holiday = findHolidayInDb(dateYmd); // look up by YYYY-MM-DD
  if (!holiday) return { closed: false };

  if (holiday.status === 'closed') {
    return { closed: true };
  }

  if (holiday.status === 'early_close') {
    return { closed: false, earlyClose: holiday.earlyCloseEt };
  }

  return { closed: false };
}
```

To determine if **today’s bar is the final weekly/monthly bar**:

1. Compute `todayEt` and `tomorrowEt` as `YYYY-MM-DD` strings (ET).  
2. If `isMarketClosedOn(tomorrowEt).closed === true`, then **today is the last trading day** in that period.  
3. RS can then finalize the weekly/monthly bar accordingly.

