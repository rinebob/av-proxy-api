**Topic:** Alpha Vantage Endpoint Expansion — Hilbert Transform  
**Issue:** #5  
**Domain:** AV-ENDPOINTS  
**Type:** As-Built  
**Status:** Complete  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-15  

---

# As-Built: Alpha Vantage Endpoint Expansion (Hilbert Transform)

## What was built

A config-driven, on-demand partner HTTPS endpoint that calls Alpha Vantage directly for Hilbert Transform technical indicators. No Firestore persistence, no refresh manager — each request hits AV and returns the result in a standard envelope.

## Architecture

```
GET /partnerTechnicalIndicatorsV2?symbol=IBM&indicator=ht_trendline&interval=daily&series_type=close
  → authenticateRequestEither (service-account OIDC only)
  → validate params (symbol, indicator, interval, series_type)
  → check tracked_symbols Firestore collection for symbol existence
  → look up indicator config → resolve AV function name + required params
  → call AV API directly (axios GET /query?function=HT_TRENDLINE&symbol=IBM&...)
  → return standard envelope: { ok, symbol, indicator, interval, series_type, data, timestamp, processingTimeMs }
```

## Components

### 1. Indicator Config (`shared/alpha-vantage/av-technical-indicators-config.ts`)
Maps indicator names to AV function names + required params. 6 Hilbert indicators:
- `ht_trendline` → `HT_TRENDLINE`
- `ht_sine` → `HT_SINE`
- `ht_trendmode` → `HT_TRENDMODE`
- `ht_dcperiod` → `HT_DCPERIOD`
- `ht_dcphase` → `HT_DCPHASE`
- `ht_phasor` → `HT_PHASOR`

Adding a new indicator is a config entry — no code change needed.

### 2. Enum Entries (`shared/alpha-vantage/av-endpoints.ts`)
6 new `AlphaVantageEndpoint` enum entries + `AV_IMPLEMENTED_ENDPOINTS` set entries.

### 3. Endpoint Configs (`shared/alpha-vantage/av-endpoint-configs.ts`)
6 new `AV_ENDPOINT_CONFIGS` entries with `ttl: 0` and `firestorePath: ''` (on-demand, not persisted).

### 4. Partner Endpoint (`functions/src/v2/partner/technical-indicators-partner.ts`)
- `onRequest` with `allowedServiceAccounts` + `expectedGoogleAudience` + `ALPHAVANTAGE_API_KEY` secrets
- Dependency injection pattern (matching `historical-options-partner.ts`)
- Typed error mapping via `AlphaVantageUpstreamError` (TIMEOUT→504, RATE_LIMITED→429, UPSTREAM_ERROR→502)
- Response size validation (10MB limit, 413 on exceed)
- CORS via `withCors`, logging via `createLogger`

### 5. Error Utils (`functions/src/v2/partner/technical-indicators-request.utils.ts`)
`TechnicalIndicatorsErrorCode` enum + `mapTechnicalIndicatorsProviderError` function.

### 6. Export (`functions/src/index.ts`)
`export { partnerTechnicalIndicatorsV2 } from './v2/partner/technical-indicators-partner';`

## Deviations from original design

None. The implementation follows the PRD exactly.

## Key decisions

- **Config-driven**: Indicator → AV function mapping in a config file, not hardcoded. Future indicators added via config.
- **On-demand**: No Firestore, no TTL, no refresh manager. Each request hits AV directly.
- **Raw passthrough**: No response transformation. AV response returned as-is in the `data` field.
- **Defaults**: `interval` → `daily`, `series_type` → `close`
- **Single endpoint**: `technical-indicators` with `indicator` param, not 6 separate endpoints
- **Service-account only**: Rejects Firebase ID tokens (403), matching the on-demand endpoint pattern

## Deployment

- Function URL: `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTechnicalIndicatorsV2`
- Cloud Run service: `partnertechnicalindicatorsv2`
- `EXPECTED_GOOGLE_AUDIENCE` secret updated (version 15)
- IAM `roles/run.invoker` granted to 3 service accounts
- Verified: `GET ?symbol=IBM&indicator=ht_trendline` returns 200 with real AV data

## Tasks shipped

| Task | Description | Commits |
|------|-------------|---------|
| #12 | Add Hilbert enum entries + endpoint configs + indicator config | 5 |
| #13 | Create technical-indicators partner endpoint | 6 |
| #14 | Export + deploy technical-indicators endpoint | 3 |
| **Total** | | **14** |

## Test coverage

- 9 config tests (Task #12)
- 21 partner endpoint tests (Task #13)
- **30 total tests, all passing**
