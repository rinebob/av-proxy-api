**Topic:** Alpha Vantage Endpoint Expansion — Hilbert Transform  
**Issue:** #5  
**Domain:** AV-ENDPOINTS  
**Type:** API Reference  
**Status:** Complete  
**Created:** 2026-08-15  

---

# API Reference: Technical Indicators Partner Endpoint

## Endpoint

```
GET https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTechnicalIndicatorsV2
```

## Auth

Service-account OIDC ID token only (Firebase ID tokens rejected with 403). Token audience must match the function URL. See `docs/partner/partner-auth-and-audience.md`.

## Query Parameters

| Param | Required | Default | Valid Values | Description |
|-------|----------|---------|--------------|-------------|
| `symbol` | Yes | — | Any tracked symbol | Ticker symbol, case-insensitive (uppercased before AV call) |
| `indicator` | Yes | — | See list below | Indicator name (lowercase) |
| `interval` | No | `daily` | `1min`, `5min`, `15min`, `30min`, `60min`, `daily`, `weekly`, `monthly` | Time interval |
| `series_type` | No | `close` | `open`, `high`, `low`, `close` | Price series to calculate on |

## Valid Indicators

| Indicator | AV Function |
|-----------|-------------|
| `ht_trendline` | `HT_TRENDLINE` |
| `ht_sine` | `HT_SINE` |
| `ht_trendmode` | `HT_TRENDMODE` |
| `ht_dcperiod` | `HT_DCPERIOD` |
| `ht_dcphase` | `HT_DCPHASE` |
| `ht_phasor` | `HT_PHASOR` |

## Response (200)

```json
{
  "ok": true,
  "symbol": "IBM",
  "indicator": "ht_trendline",
  "interval": "daily",
  "series_type": "close",
  "data": { ... raw AV response ... },
  "timestamp": "2026-08-15T00:00:00.000Z",
  "processingTimeMs": 1106
}
```

## Error Responses

| Status | Code | Description |
|--------|------|-------------|
| 400 | `BAD_REQUEST` | Missing/invalid params (includes `validIndicators` list for invalid indicator) |
| 403 | `FORBIDDEN` | Firebase ID token used (service-account only) |
| 404 | `NOT_FOUND` | Symbol not in `tracked_symbols` |
| 413 | `RESPONSE_TOO_LARGE` | Response exceeds 10MB |
| 429 | `RATE_LIMITED` | AV API rate limit hit |
| 500 | `INTERNAL_ERROR` | Internal server error |
| 502 | `UPSTREAM_ERROR` | AV API error |
| 504 | `UPSTREAM_TIMEOUT` | AV API timeout |

## Examples

```
GET ?symbol=IBM&indicator=ht_trendline
GET ?symbol=IBM&indicator=ht_sine&interval=weekly&series_type=open
GET ?symbol=aapl&indicator=ht_dcperiod
```
