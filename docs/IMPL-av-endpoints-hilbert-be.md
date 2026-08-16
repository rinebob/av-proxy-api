**Topic:** Alpha Vantage Endpoint Expansion  
**Issue:** #5  
**Domain:** AV-ENDPOINTS  
**Type:** Implementation Plan — BE (Hilbert Transform)  
**Status:** Draft  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-15  

---

## Overview

Implement the 6 Alpha Vantage Hilbert Transform technical indicators as a single config-driven on-demand partner endpoint. No Firestore persistence, no refresh manager — the endpoint calls AV directly on each request.

## Architecture

```
GET /technical-indicators?symbol=IBM&indicator=ht_trendline&interval=daily&series_type=close
  → authenticateRequestEither (service-account OIDC)
  → validate params (symbol, indicator, interval, series_type)
  → check tracked_symbols Firestore collection for symbol existence
  → look up indicator config → resolve AV function name + required params
  → call AV API directly (axios GET /query?function=HT_TRENDLINE&symbol=IBM&interval=daily&series_type=close)
  → return response in standard envelope
```

## Components

### 1. Indicator Config (`shared/alpha-vantage/av-technical-indicators-config.ts`)

A config file mapping indicator names to AV function names + required params. Hilbert indicators are the first entries.

```typescript
interface TechnicalIndicatorConfig {
  /** AV API function name (e.g., 'HT_TRENDLINE') */
  function: string;
  /** Required AV params beyond symbol (e.g., ['interval', 'series_type']) */
  requiredParams: string[];
  /** Optional AV params with defaults (e.g., { series_type: 'close' }) */
  defaultParams?: Record<string, string>;
}

export const TECHNICAL_INDICATORS_CONFIG: Record<string, TechnicalIndicatorConfig> = {
  ht_trendline: { function: 'HT_TRENDLINE', requiredParams: ['interval', 'series_type'], defaultParams: { series_type: 'close', interval: 'daily' } },
  ht_sine:      { function: 'HT_SINE',      requiredParams: ['interval', 'series_type'], defaultParams: { series_type: 'close', interval: 'daily' } },
  ht_trendmode: { function: 'HT_TRENDMODE', requiredParams: ['interval', 'series_type'], defaultParams: { series_type: 'close', interval: 'daily' } },
  ht_dcperiod:  { function: 'HT_DCPERIOD',  requiredParams: ['interval', 'series_type'], defaultParams: { series_type: 'close', interval: 'daily' } },
  ht_dcphase:   { function: 'HT_DCPHASE',   requiredParams: ['interval', 'series_type'], defaultParams: { series_type: 'close', interval: 'daily' } },
  ht_phasor:    { function: 'HT_PHASOR',    requiredParams: ['interval', 'series_type'], defaultParams: { series_type: 'close', interval: 'daily' } },
};
```

### 2. Enum Entries (`shared/alpha-vantage/av-endpoints.ts`)

Add to `AlphaVantageEndpoint` enum:
```typescript
HT_TRENDLINE = 'HT_TRENDLINE',
HT_SINE = 'HT_SINE',
HT_TRENDMODE = 'HT_TRENDMODE',
HT_DCPERIOD = 'HT_DCPERIOD',
HT_DCPHASE = 'HT_DCPHASE',
HT_PHASOR = 'HT_PHASOR',
```

Add to `AV_IMPLEMENTED_ENDPOINTS` set (all 6).

### 3. Endpoint Configs (`shared/alpha-vantage/av-endpoint-configs.ts`)

Add entries to `AV_ENDPOINT_CONFIGS` for all 6 with `ttl: 0` and `firestorePath: ''` (on-demand, not persisted).

### 4. Partner Endpoint (`functions/src/v2/partner/technical-indicators-partner.ts`)

Single file following the pattern of `company-overview-partner.ts` but calling AV directly instead of reading Firestore:

- `onRequest` with `allowedServiceAccounts` + `expectedGoogleAudience` secrets
- `authenticateRequestEither` for auth
- Validate `symbol` (required, uppercase), `indicator` (required, must be in config), `interval` (optional, default daily), `series_type` (optional, default close)
- Check `tracked_symbols` Firestore collection for symbol existence
- Build AV API request from config: `function`, `symbol`, `interval`, `series_type`
- Call AV via axios (reuse base URL/timeout from `DATA_PROVIDERS`)
- Return standard envelope: `{ ok, symbol, indicator, interval, series_type, data, timestamp, processingTimeMs }`
- Error handling: 400 for bad params, 404 for untracked symbol, 502 for AV API errors, 500 for internal

### 5. Export (`functions/src/index.ts`)

Export the partner endpoint function.

## Task Breakdown

### Phase: Hilbert Transform Implementation

| Task | Description | Files |
|---|---|---|
| 1 | Add enum entries + endpoint configs + indicator config | `av-endpoints.ts`, `av-endpoint-configs.ts`, `av-technical-indicators-config.ts` |
| 2 | Create partner endpoint | `technical-indicators-partner.ts` |
| 3 | Export + deploy | `index.ts`, deploy workflow |

Tasks 1 and 2 are sequential (endpoint depends on config). Task 3 depends on task 2.

## Key Decisions

- **Config-driven**: Indicator → AV function mapping in a config file, not hardcoded in the endpoint. Future indicators (SMA, EMA, OBV) are added via config entries.
- **On-demand**: No Firestore, no TTL, no refresh manager. Each request hits AV directly.
- **Raw passthrough**: No response transformation. AV response returned as-is in the `data` field of the standard envelope.
- **Defaults**: `interval` → `daily`, `series_type` → `close`
- **Single endpoint**: `technical-indicators` with `indicator` param, not 6 separate endpoints
