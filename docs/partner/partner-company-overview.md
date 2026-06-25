# Partner Company Overview API — Discovery Document

Audience: External partner engineering/admin teams. Read `partner-discovery.md` first for auth model and operational checklist.

Last updated: 2026-06-23

---

## Purpose

The **Company Overview** endpoint exposes normalized Alpha Vantage `OVERVIEW` data for a single equity symbol. It reads directly from Firestore (no live AV call on each request) and returns fundamental company metadata plus financial ratios.

This is a read-only partner surface. Data is refreshed by the internal `refreshAlphaVantageDataV2` scheduler on a **7-day TTL** (non-time-series refresh cycle). Company overview is only populated for equity symbols (`type = Equity`); ETFs, indexes, and crypto are excluded from the AV OVERVIEW refresh.

---

## Endpoint

| Property | Value |
|---|---|
| Function name | `partnerCompanyOverviewV2` |
| HTTP method | `GET` |
| Auth | Dual-auth — Google OIDC SA (preferred) or Firebase ID token |
| URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerCompanyOverviewV2` |

### URL and Audience Note (2nd Gen / Cloud Run)

This is a **2nd gen Cloud Function** backed by Cloud Run. It has two URLs:

- **`cloudfunctions.net` URL** — the canonical invoke URL and the correct OIDC token audience:
  `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerCompanyOverviewV2`
- **`run.app` URL** — the underlying Cloud Run service URL (visible in deploy output, not used directly):
  `https://partnercompanyoverviewv2-lsluydmucq-uc.a.run.app`

**Always use the `cloudfunctions.net` URL** as both the request URL and the OIDC token `audience` (`--audiences` flag). Using the `run.app` URL as the audience will result in a `403 Google ID token audience mismatch` error.

---

## Query Parameters

| Parameter | Required | Type | Description |
|---|---|---|---|
| `symbol` | ✅ | string | Ticker symbol (case-insensitive). Example: `AAPL` |

---

## Response Shape

### Success — `200 OK`

```json
{
  "ok": true,
  "symbol": "AAPL",
  "data": {
    "Symbol": "AAPL",
    "AssetType": "Common Stock",
    "Name": "Apple Inc",
    "Description": "Apple Inc. designs, manufactures...",
    "CIK": "0000320193",
    "Exchange": "NASDAQ",
    "Currency": "USD",
    "Country": "USA",
    "Sector": "TECHNOLOGY",
    "Industry": "ELECTRONIC COMPUTERS",
    "Address": "One Apple Park Way, Cupertino, CA 95014",
    "OfficialSite": "https://www.apple.com",
    "FiscalYearEnd": "September",
    "LatestQuarter": "2026-03-31",
    "MarketCapitalization": "3200000000000",
    "EBITDA": "130000000000",
    "PERatio": "32.5",
    "PEGRatio": "2.1",
    "BookValue": "4.50",
    "DividendPerShare": "0.99",
    "DividendYield": "0.0044",
    "EPS": "6.84",
    "RevenuePerShareTTM": "25.10",
    "ProfitMargin": "0.272",
    "OperatingMarginTTM": "0.311",
    "ReturnOnAssetsTTM": "0.222",
    "ReturnOnEquityTTM": "1.62",
    "RevenueTTM": "390000000000",
    "GrossProfitTTM": "170000000000",
    "DilutedEPSTTM": "6.84",
    "QuarterlyEarningsGrowthYOY": "0.082",
    "QuarterlyRevenueGrowthYOY": "0.051",
    "AnalystTargetPrice": "240.00",
    "AnalystRatingStrongBuy": "12",
    "AnalystRatingBuy": "20",
    "AnalystRatingHold": "8",
    "AnalystRatingSell": "1",
    "AnalystRatingStrongSell": "0",
    "TrailingPE": "32.5",
    "ForwardPE": "28.0",
    "PriceToSalesRatioTTM": "8.2",
    "PriceToBookRatio": "50.1",
    "EVToRevenue": "8.0",
    "EVToEBITDA": "24.0",
    "Beta": "1.25",
    "52WeekHigh": "260.10",
    "52WeekLow": "164.08",
    "50DayMovingAverage": "222.50",
    "200DayMovingAverage": "210.30",
    "SharesOutstanding": "15200000000",
    "SharesFloat": "15100000000",
    "PercentInsiders": "0.07",
    "PercentInstitutions": "60.8",
    "DividendDate": "2026-05-15",
    "ExDividendDate": "2026-05-09"
  },
  "metadata": {
    "lastUpdated": "2026-06-20T10:30:00.000Z",
    "nextUpdate": "2026-06-27T10:30:00.000Z",
    "ttlSeconds": 604800,
    "vendor": "alpha_vantage",
    "endpoint": "Company Overview"
  },
  "timestamp": "2026-06-23T16:45:00.000Z",
  "processingTimeMs": 38
}
```

### Error — `400 Bad Request`

```json
{ "ok": false, "error": "Missing symbol", "code": "BAD_REQUEST" }
```

### Error — `404 Not Found`

```json
{ "ok": false, "error": "No company overview data found for AAPL", "code": "NOT_FOUND" }
```

### Error — `401 / 403`

```json
{ "ok": false, "error": "Unauthorized", "code": "UNAUTHORIZED" }
```

### Error — `500 Internal Server Error`

```json
{ "ok": false, "error": "...", "code": "INTERNAL_ERROR", "timestamp": "..." }
```

---

## Field Reference

All `data` fields are strings (as returned by Alpha Vantage). Numeric values should be parsed by the consumer.

| Field | Description |
|---|---|
| `Symbol` | Ticker symbol |
| `AssetType` | E.g., `Common Stock` |
| `Name` | Full company name |
| `Description` | Business description |
| `CIK` | SEC CIK number |
| `Exchange` | Exchange the symbol trades on |
| `Currency` | Trading currency |
| `Country` | Country of incorporation |
| `Sector` | Sector classification |
| `Industry` | Industry classification |
| `FiscalYearEnd` | Month name (e.g., `September`) |
| `LatestQuarter` | Date of most recent reported quarter (`YYYY-MM-DD`) |
| `MarketCapitalization` | Market cap in USD |
| `EPS` | Trailing 12-month EPS |
| `PERatio` | Trailing price-to-earnings ratio |
| `ForwardPE` | Forward price-to-earnings |
| `Beta` | Beta vs S&P 500 |
| `52WeekHigh` / `52WeekLow` | 52-week price range |
| `DividendPerShare` | Annual dividend per share |
| `DividendYield` | Dividend yield (decimal, e.g., `0.0044`) |
| `AnalystTargetPrice` | Consensus analyst target price |
| `AnalystRating*` | Analyst rating counts (StrongBuy, Buy, Hold, Sell, StrongSell) |

> **Note:** Fields with value `"None"` indicate AV returned no data for that field (e.g., non-dividend-paying stocks will have `DividendYield: "None"`). Parse defensively.

---

## Data Freshness

- **Source:** Firestore `symbol-data/{SYMBOL}/company-overview/av-company-overview`
- **TTL:** 7 days (604800 seconds)
- **Refresh:** Internal `refreshAlphaVantageDataV2` scheduled function
- **Coverage:** Equity symbols only. If a symbol is tracked but not an equity (ETF, index, crypto), no OVERVIEW doc will exist → `404`.
- **Latency:** Reads from Firestore only. No live AV call per partner request.

---

## Example Requests

```bash
# Single symbol
GET /partnerCompanyOverviewV2?symbol=AAPL
Authorization: Bearer <id_token>
```

```bash
# Case-insensitive symbol
GET /partnerCompanyOverviewV2?symbol=msft
Authorization: Bearer <id_token>
```

---

## Limits and Behavior

- One symbol per request (no bulk endpoint).
- Returns `404` if no Firestore document exists (symbol not tracked or not an equity).
- `metadata.lastUpdated` and `metadata.nextUpdate` are ISO strings derived from Firestore Timestamps.
- Symbols must be tracked by the backend. Contact Savant to add new symbols.

---

## Onboarding

Authentication and allowlisting are identical to other partner endpoints. See `docs/partner/partner-discovery.md` and `docs/partner/partner-integration.md`.

The `partnerCompanyOverviewV2` function must be added to your `ALLOWED_SERVICE_ACCOUNT_EMAILS` allowlist on the deployed revision.
