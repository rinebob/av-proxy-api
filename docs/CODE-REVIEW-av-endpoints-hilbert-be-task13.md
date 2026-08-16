**Topic:** Alpha Vantage Endpoint Expansion — Hilbert Transform  
**Issue:** #5  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-15  

---

# Code Review: Task #13 — Technical Indicators Partner Endpoint

## Summary

Three review axes (Standards, Spec, Thermo-nuclear) were run in parallel against Task #13. The task creates a config-driven on-demand partner endpoint that calls Alpha Vantage directly for Hilbert Transform technical indicators.

### Findings by severity

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | All resolved |
| Major | 0 | All resolved |
| Minor | 2 | Noted (pre-existing pattern inconsistencies) |
| Nit | 0 | All resolved |

---

## Standards axis

### Findings (all resolved during review)

1. **CRITICAL → FIXED: Missing error code enum**  
   File: `technical-indicators-partner.ts`  
   The handler used string literals for error codes instead of a typed enum.  
   Resolution: Created `technical-indicators-request.utils.ts` with `TechnicalIndicatorsErrorCode` enum and `mapTechnicalIndicatorsProviderError` function, following the `historical-options-request.utils.ts` pattern. All error codes now use the enum.

2. **MAJOR → FIXED: Missing typed error mapping for upstream failures**  
   File: `technical-indicators-partner.ts`  
   The upstream error handling was generic (catch any error → 502) instead of using the typed `AlphaVantageUpstreamError` pattern.  
   Resolution: Imported `toAlphaVantageUpstreamError` and `mapTechnicalIndicatorsProviderError`. Now maps TIMEOUT → 504, RATE_LIMITED → 429, UPSTREAM_ERROR → 502 with correct error codes.

3. **MAJOR → FIXED: Missing response size validation**  
   File: `technical-indicators-partner.ts`  
   No validation of response payload size, unlike `historical-options-partner.ts`.  
   Resolution: Added `MAX_RESPONSE_BYTES = 10 * 1024 * 1024` check with 413 response and `RESPONSE_TOO_LARGE` error code.

4. **NIT → FIXED: Test variable naming**  
   File: `technical-indicators-partner.test.ts`  
   Renamed `rs` to `responseState` for consistency with `historical-options-partner.test.ts`.

### Noted (not fixed — pre-existing pattern inconsistency)

5. **MINOR: OPTIONS handling inconsistency**  
   The new endpoint returns 204 for OPTIONS (matching `company-overview-partner.ts`), while `historical-options-partner.ts` returns 405. This is a pre-existing inconsistency in the codebase. 204 is correct for CORS preflight — the `withCors` middleware handles OPTIONS, and the handler's 204 is a fallback. Not changing.

6. **MINOR: Missing `assertEqual` helper**  
   The test file uses direct `expect()` calls instead of the `assertEqual` helper from `historical-options-partner.test.ts`. Direct `expect()` is cleaner and more idiomatic jest. Not adding the helper.

### Positive findings
- `@topic` tags present on all new files
- Dependency injection pattern correctly matches `historical-options-partner.ts`
- Service-account-only auth enforcement
- CORS middleware correctly used in `onRequest` export
- Logging pattern consistent with existing endpoints
- File sizes appropriate (316 lines handler, 378 lines tests)
- Single responsibility — handler focuses on one endpoint

---

## Spec axis

### Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Create `technical-indicators-partner.ts` | **MET** |
| 2 | `onRequest` with `allowedServiceAccounts` + `expectedGoogleAudience` secrets | **MET** |
| 3 | `authenticateRequestEither` for auth | **MET** |
| 4 | Validate `symbol` (required, uppercased) | **MET** |
| 5 | Validate `indicator` (required, must be in config, 400 with valid list) | **MET** |
| 6 | Validate `interval` (optional, default daily, valid AV interval) | **MET** |
| 7 | Validate `series_type` (optional, default close, OHLC only) | **MET** |
| 8 | Check `tracked_symbols` Firestore (404 if not found) | **MET** |
| 9 | Build AV API request from config + API key | **MET** |
| 10 | Call AV via axios (reuse DATA_PROVIDERS) | **MET** |
| 11 | Return standard envelope | **MET** |
| 12 | Error handling: 400/403/404/502/500 | **MET** (401 handled internally by `authenticateRequestEither`) |
| 13 | Request logging via `createLogger` | **MET** |
| 14 | CORS via `withCors` | **MET** |
| 15 | Unit tests for param validation, config lookup, AV call construction | **MET** (21 tests) |
| 16 | Build passes | **MET** |

**16/16 MET.**

---

## Thermo-nuclear axis

(Performed by parent agent — thermo-nuclear subagent couldn't access files.)

### Findings

1. **Dependency injection pattern**: Clean and consistent with `historical-options-partner.ts`. The `TechnicalIndicatorsPartnerDependencies` interface matches the established pattern. Default dependencies are production-ready, test dependencies are injectable.

2. **Test quality**: Tests verify external behavior (HTTP status codes, response envelopes, AV call params) not implementation details. 21 tests cover all critical paths including:
   - Method/auth gates (5 tests)
   - Param validation (5 tests)
   - Symbol enforcement (1 test)
   - Happy path with AV call verification (4 tests)
   - Typed error mapping (4 tests — timeout, rate limit, generic, non-typed)
   - Response size validation (1 test)
   - Internal error (1 test)

3. **Error handling**: Comprehensive after fixes. Typed error mapping covers all `AlphaVantageUpstreamErrorCategory` values. Response size validation prevents memory issues.

4. **Single responsibility**: Handler is one endpoint with clear sections (auth → validation → symbol check → AV call → response). 316 lines is comparable to `historical-options-partner.ts` (232 lines) — the extra size is from config-driven validation logic.

5. **withCors consistency**: The `onRequest` export wraps the handler with `withCors`, matching `company-overview-partner.ts`. Tests call the handler directly (not through withCors), which is consistent with `historical-options-partner.test.ts`. CORS behavior is tested separately by the cors-middleware tests.

---

## Test results

```
PASS tests/v2/partner/technical-indicators-partner.test.ts
  21 tests passed
```

Build results:
- `npm run build:shared` — PASS
- `npm run build:functions` — PASS

---

## Verdict: **PASS**

All critical and major findings were resolved during the review. The handler now follows the established patterns: typed error codes, typed upstream error mapping, response size validation. All 16 acceptance criteria are met. 21 tests pass. Builds are green.
