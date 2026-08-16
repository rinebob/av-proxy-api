**Topic:** Alpha Vantage Endpoint Expansion  
**Issue:** #5  
**Domain:** AV-ENDPOINTS  
**Type:** PRD — Hilbert Transform  
**Status:** Approved  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-15  

---

## 1. Overview

The 6 Alpha Vantage Hilbert Transform endpoints are DSP-based technical indicators (pioneered by John Ehlers) that decompose price data into In-Phase and Quadrature components via a 90-degree phase shift. They enable cycle identification, phase/timing detection, trend-vs-cycle distinction, and lag reduction.

### Endpoints

| AV Function | Name | Output |
|---|---|---|
| `HT_TRENDLINE` | Hilbert Transform - Trendline | Smoothed price with reduced lag (overlays on price chart) |
| `HT_SINE` | Hilbert Transform - SineWave | Sine + lead-sine of cycle phase angle |
| `HT_TRENDMODE` | Hilbert Transform - Trend vs Cycle | Trend/cycle mode classification |
| `HT_DCPERIOD` | Hilbert Transform - DC Period | Dominant cycle period in bars |
| `HT_DCPHASE` | Hilbert Transform - DC Phase | Phase angle in degrees (0-360) |
| `HT_PHASOR` | Hilbert Transform - Phasor Components | In-Phase + Quadrature components |

All 6 share the same AV API parameters: `symbol`, `interval`, `series_type` (open/high/low/close).

### Architecture: On-Demand, Config-Driven

The partner endpoint calls Alpha Vantage directly on each request and returns the response immediately. A config file maps indicator names to AV function names and their required parameters, making the endpoint extensible to future technical indicators (SMA, EMA, OBV, etc.) without code changes — just a config entry.

- **No Firestore writes** — indicator values are computed by AV on-the-fly and are not cached
- **No TTL** — no refresh manager, no Cloud Tasks, no scheduler involvement
- **No persistence layer** — each request hits AV and returns the result
- **Config-driven** — indicator → AV function mapping lives in a config file, not hardcoded

---

## 2. User Stories

### US-HT-1: Config-Driven Partner Endpoint with Indicator Param

**As a** partner consumer,  
**I want to** retrieve any of the 6 Hilbert Transform indicators via a single endpoint with an `indicator` parameter,  
**so that** I can integrate cycle analysis, trend detection, and phase timing into my application without managing 6 separate endpoints.

**Acceptance criteria:**
- [ ] Partner endpoint `technical-indicators` accepts `symbol`, `indicator`, `interval`, `series_type` query params
- [ ] A config file maps indicator names to AV function names + required params (Hilbert indicators are the first entries; future indicators like SMA/EMA/OBV are added via config, not new endpoints)
- [ ] `indicator` param accepts: `ht_trendline`, `ht_sine`, `ht_trendmode`, `ht_dcperiod`, `ht_dcphase`, `ht_phasor`
- [ ] Invalid `indicator` value returns 400 with the list of valid values
- [ ] `interval` accepts standard AV intervals (1min, 5min, 15min, 30min, 60min, daily, weekly, monthly), defaults to `daily`
- [ ] `series_type` accepts: open, high, low, close, defaults to `close`
- [ ] Endpoint calls AV directly with the appropriate `function` param (e.g., `HT_TRENDLINE`) and returns the response
- [ ] Response uses standard envelope: `{ ok, symbol, indicator, interval, series_type, data, timestamp, processingTimeMs }`
- [ ] Service-account-only auth via `authenticateRequestEither` (consistent with all partner endpoints)
- [ ] Symbol enforcement via `tracked_symbols` Firestore collection (document existence check)
- [ ] Operational guards: upstream error mapping, request logging, timeout handling

### US-HT-2: HT_TRENDLINE — Instantaneous Trendline

**As a** partner consumer,  
**I want to** retrieve HT_TRENDLINE values,  
**so that** I can overlay a low-lag smoothed price line on my charts.

**Acceptance criteria:**
- [ ] `indicator=ht_trendline` maps to AV function `HT_TRENDLINE`
- [ ] Returns time-series of trendline values

### US-HT-3: HT_SINE — Sine Wave

**As a** partner consumer,  
**I want to** retrieve HT_SINE values (sine + lead-sine),  
**so that** I can detect cycle tops and bottoms via crossovers.

**Acceptance criteria:**
- [ ] `indicator=ht_sine` maps to AV function `HT_SINE`
- [ ] Returns both sine and lead-sine time-series

### US-HT-4: HT_TRENDMODE — Trend vs Cycle Mode

**As a** partner consumer,  
**I want to** retrieve HT_TRENDMODE values,  
**so that** I can switch between trend-following and cycle-trading strategies based on market regime.

**Acceptance criteria:**
- [ ] `indicator=ht_trendmode` maps to AV function `HT_TRENDMODE`
- [ ] Returns time-series of trend/cycle mode classification

### US-HT-5: HT_DCPERIOD — Dominant Cycle Period

**As a** partner consumer,  
**I want to** retrieve HT_DCPERIOD values,  
**so that** I can dynamically adapt indicator lookback periods to the current cycle length.

**Acceptance criteria:**
- [ ] `indicator=ht_dcperiod` maps to AV function `HT_DCPERIOD`
- [ ] Returns time-series of dominant cycle period (in bars)

### US-HT-6: HT_DCPHASE — DC Phase Angle

**As a** partner consumer,  
**I want to** retrieve HT_DCPHASE values,  
**so that** I can identify where price sits within the current cycle (0°-360°).

**Acceptance criteria:**
- [ ] `indicator=ht_dcphase` maps to AV function `HT_DCPHASE`
- [ ] Returns time-series of phase angle (degrees, 0-360)

### US-HT-7: HT_PHASOR — Phasor Components

**As a** partner consumer,  
**I want to** retrieve HT_PHASOR values (In-Phase + Quadrature),  
**so that** I can build custom cycle-based indicators from the raw I/Q decomposition.

**Acceptance criteria:**
- [ ] `indicator=ht_phasor` maps to AV function `HT_PHASOR`
- [ ] Returns both in-phase and quadrature time-series

---

## 3. Technical Context

### Architecture

```
Partner Consumer
  → GET /technical-indicators?symbol=IBM&indicator=ht_trendline&interval=daily&series_type=close
  → Partner endpoint (auth: service-account OIDC)
  → Validate params + check tracked_symbols
  → Call Alpha Vantage API directly (function=HT_TRENDLINE&symbol=IBM&interval=daily&series_type=close)
  → Return AV response in standard envelope
  → Partner Consumer
```

### AV API Parameters (all 6 endpoints)

| Parameter | Required | Values | Default |
|---|---|---|---|
| `symbol` | yes | ticker symbol | — |
| `interval` | no | 1min, 5min, 15min, 30min, 60min, daily, weekly, monthly | daily |
| `series_type` | no | open, high, low, close | close |

### Response Envelope

```json
{
  "ok": true,
  "symbol": "IBM",
  "indicator": "ht_trendline",
  "interval": "daily",
  "series_type": "close",
  "data": { /* raw AV response */ },
  "timestamp": "2026-08-15T12:00:00.000Z",
  "processingTimeMs": 342
}
```

### System Context Diagram

```
  +-----------------------+
  | Partner Consumer App  |
  +-----------------------+
          |
          | GET /technical-indicators
          |   ?symbol=IBM&indicator=ht_trendline
          |   &interval=daily&series_type=close
          v
  +--------------------------------+        +-------------------+
  | Partner HTTPS Endpoint         |        | tracked_symbols   |
  | (technical-indicators-partner) |------->| (Firestore)       |
  | auth: service-account OIDC     | yes?   +-------------------+
  +--------------------------------+
          |
          | Config lookup: indicator -> AV function
          | HTTP GET function=HT_TRENDLINE&symbol=IBM
          |   &interval=daily&series_type=close
          v
  +-------------------+
  | Alpha Vantage API |
  +-------------------+
          |
          | JSON response
          v
  +--------------------------------+
  | Partner HTTPS Endpoint         |
  | -> standard envelope response  |
  +--------------------------------+
          |
          v
  +-----------------------+
  | Partner Consumer App  |
  +-----------------------+
```

### Rate Limits

AV rate limit: 75 requests/minute. Since this is on-demand, each partner request consumes one AV API call. Consumers should be aware of this constraint.

---

## 4. Implementation Scope

1. **Enum entries**: Add `HT_TRENDLINE`, `HT_SINE`, `HT_TRENDMODE`, `HT_DCPERIOD`, `HT_DCPHASE`, `HT_PHASOR` to `AlphaVantageEndpoint` enum
2. **Endpoint configs**: Add entries to `AV_ENDPOINT_CONFIGS` with `ttl: 0` and `firestorePath: ''` (on-demand, not persisted)
3. **Indicator config**: Create a config file mapping indicator names to AV function names + required params (e.g., `ht_trendline` → `{ function: 'HT_TRENDLINE', params: ['symbol', 'interval', 'series_type'] }`). Hilbert indicators are the first entries; future indicators (SMA, EMA, OBV) are added here without new endpoints.
4. **Partner endpoint**: `technical-indicators-partner.ts` that:
   - Reads the indicator config to resolve `indicator` param → AV function + params
   - Validates `symbol`, `interval`, `series_type` against the config
   - Checks `tracked_symbols` for symbol enforcement
   - Calls AV API directly
   - Returns response in standard envelope
5. **Export**: Add to `functions/src/index.ts`
6. **Deploy**: Run deploy workflow (secrets, IAM, deploy, verify, update docs)

---

## 5. Constraints

- On-demand only — no Firestore persistence
- Single endpoint with `indicator` param (not 6 separate endpoints)
- Service-account-only auth
- Symbol enforcement via `tracked_symbols` Firestore collection
- Each AV API call consumes rate limit quota

---

## 6. Open Questions

- Should we add a lightweight in-memory cache (e.g., 30-second TTL) to reduce AV API calls for repeated requests? (Deferred — revisit if rate limits become a problem)
- Should we add response transformation/normalization in the future? (Deferred — raw AV passthrough for now; may revisit once response shapes are understood)
