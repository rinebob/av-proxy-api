**Topic:** Alpha Vantage Endpoint Expansion  
**Issue:** #5  
**Domain:** AV-ENDPOINTS  
**Type:** Test Plan — BE (Hilbert Transform)  
**Status:** Complete  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-15  

---

## Overview

Test plan for the Hilbert Transform technical indicators partner endpoint. On-demand endpoint that calls AV directly — no Firestore persistence to test.

## E2E Journeys

### E2E-1: Valid indicator request
- Request: `GET /technical-indicators?symbol=IBM&indicator=ht_trendline&interval=daily&series_type=close`
- Auth: valid service-account OIDC token
- Symbol IBM exists in `tracked_symbols`
- Expected: 200 with `{ ok: true, symbol: 'IBM', indicator: 'ht_trendline', interval: 'daily', series_type: 'close', data: {...}, timestamp, processingTimeMs }`

### E2E-2: Default params
- Request: `GET /technical-indicators?symbol=IBM&indicator=ht_sine`
- Expected: 200 with `interval: 'daily'`, `series_type: 'close'` (defaults applied)

### E2E-3: All 6 indicators
- Repeat E2E-1 for each: `ht_trendline`, `ht_sine`, `ht_trendmode`, `ht_dcperiod`, `ht_dcphase`, `ht_phasor`
- Expected: each returns 200 with correct AV function called

## Integration Boundaries

### IB-1: Auth
- No token → 401
- Invalid token → 403
- Valid Firebase ID token → 200 (dual-auth)

### IB-2: Symbol enforcement
- Symbol not in `tracked_symbols` → 404
- Symbol in `tracked_symbols` → passes to AV call

### IB-3: AV API errors
- AV returns error (rate limit, invalid symbol, etc.) → 502 with mapped error message
- AV timeout → 502 with timeout error

## Unit Test Targets

### Config validation
- `TECHNICAL_INDICATORS_CONFIG` contains all 6 Hilbert indicators
- Each config entry has correct `function` name matching AV API
- Each config entry has `requiredParams` and `defaultParams`

### Param validation
- Missing `symbol` → 400
- Missing `indicator` → 400
- Invalid `indicator` (e.g., `ht_bogus`) → 400 with list of valid values
- Invalid `interval` (e.g., `2min`) → 400
- Invalid `series_type` (e.g., `median`) → 400
- Valid params with defaults applied → passes validation

### AV API call construction
- Correct `function` param from config
- `symbol` uppercased
- `interval` and `series_type` defaults applied when omitted
- API key included (from secret)

## Test Seams

- **AV API**: Mock axios responses for unit tests. Test against real AV API only in manual integration tests.
- **Firestore**: Mock `tracked_symbols` existence check. Test with Firestore emulator for integration tests.
- **Auth**: Mock `authenticateRequestEither` or use test tokens.

## Edge Cases

- Empty string `symbol` → 400
- Lowercase `symbol` → uppercased before AV call
- `indicator` with different casing (e.g., `HT_TRENDLINE`) → normalize to lowercase or reject?
- AV returns empty response → handle gracefully
- AV rate limit hit → 502 with clear error message
- Concurrent requests for same symbol/indicator → each hits AV separately (no dedup for v1)
