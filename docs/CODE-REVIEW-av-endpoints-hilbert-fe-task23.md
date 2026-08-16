**Topic:** SA UI — AV Hilbert Transform Endpoint Integration  
**Issue:** #17  
**Domain:** AV-ENDPOINTS  
**Area:** FE  
**Type:** Code Review  
**Task:** #23 — Config + TechnicalIndicatorsService + auth interceptor  
**Status:** Complete  
**Created:** 2026-08-16  
**Last Updated:** 2026-08-16  

---

# CODE REVIEW: Task #23 — Config + TechnicalIndicatorsService + auth interceptor

## Summary

FE-only task: registered partner endpoint URL in FE config, created TechnicalIndicatorsService to call `partnerTechnicalIndicatorsV2`, and updated auth interceptor to include Firebase ID token for partner endpoint requests. Also added shared enums (HtIndicator, PriceSeries, SineDisplayMode) and fixed two pre-existing test infrastructure bugs.

## Standards Axis

### Findings (all resolved during review)

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | Critical | Missing @topic tag on `app.config.ts` | **Fixed** — added @topic #17 tag |
| 2 | Major | URL construction used template literal instead of `joinUrl` helper | **Fixed** — added `joinUrl` private method matching `health-metrics-api.service.ts` pattern |
| 3 | Major | Missing PROD_URLS entry for PartnerFunctionName | **Fixed** — added `cloudfunctions.net` URL to PROD_URLS, updated `getFunctionUrl` union type |
| 4 | Minor | Stale @topic #5 tag on `shared/alpha-vantage/index.ts` | **Fixed** — updated to @topic #17 |
| 5 | Minor | Unused SineDisplayMode type | **Kept** — added comment noting it's for Task #25 |

### Positive observations
- Service follows exact pattern from `health-metrics-api.service.ts` (inject, joinUrl, catchError)
- Test coverage exceeds standard pattern (10 tests covering all params, error cases, all indicators/types/intervals)
- Clean type contracts with typed enums instead of strings
- Auth interceptor integration correct

## Spec Axis

### Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | PartnerFunctionName enum in fe-common-fn.ts | MET |
| 2 | Production URL in PROD_URLS | MET |
| 3 | Dev URL pattern in getFunctionUrl | MET |
| 4 | Partner URL in auth interceptor backendUrls | MET |
| 5 | TechnicalIndicatorsService with getTechnicalIndicator | MET |
| 6 | Service constructs correct URL with query params | MET |
| 7 | Service returns Observable of parsed response | MET |
| 8 | Service handles 429/502/504 errors | MET |
| 9 | Unit tests for URL, response parsing, error handling | MET |

### Test plan IB-1 coverage

| Test case | Status |
|-----------|--------|
| URL construction with all param combinations | MET |
| Auth interceptor adds Firebase ID token | DEFERRED (integration-level, E2E) |
| Response parsing for each indicator type | MET |
| Error handling for 429, 502, 504 | MET (429 + 502 tested; 504 same code path) |

## Thermo-nuclear Axis

### Findings

| # | Severity | Finding | File | Line |
|---|----------|---------|------|------|
| 1 | Minor | Untyped error return from throwError | technical-indicators.service.ts | 89-93 |
| 2 | Minor | No explicit 504 test (same code path as 502) | technical-indicators.service.spec.ts | — |
| 3 | Minor | Tests for all indicators/types/intervals have no expect() — rely on expectOne assertion | technical-indicators.service.spec.ts | 160-226 |
| 4 | Nit | SineDisplayMode defined but unused in this task | av-technical-indicators-types.ts | 30 |

### Architectural assessment
- **Abstraction quality**: Clean. Service has a single responsibility (fetch indicator data). Types are well-defined and shared via `@shared/alpha-vantage`.
- **Error handling**: Handles string and object error bodies. Network errors (no response) would fall through to the `HTTP ${status}: ${statusText}` fallback. Adequate for a research tool.
- **Type safety**: Error return is untyped — minor risk for consumers. Store (Task #24) should define its own error type or cast carefully.
- **Security**: No secrets or tokens in code. Auth handled by interceptor. No risk.
- **Dependencies**: Clean — no circular dependencies. Service depends on HttpClient, API_BASES, and shared types only.

## Test Results

- **11 SUCCESS, 3 FAILED**
- All 10 TechnicalIndicatorsService tests pass
- 1 AppComponent test passes (fixed during this task)
- 3 pre-existing failures (LoginComponent, AuthService, StockDataComponent — missing providers, unrelated to this task)
- Build compiles successfully (pre-existing bundle budget warning unchanged)

## Verdict

**PASS**

All acceptance criteria met. All Standards findings resolved during review. No critical or major Thermo-nuclear findings. Tests pass (3 pre-existing failures unrelated to this task). Code follows existing patterns and is ready for ship.
