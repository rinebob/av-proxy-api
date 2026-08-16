**Topic:** SA UI — AV Hilbert Transform Endpoint Integration  
**Issue:** #17  
**Domain:** AV-ENDPOINTS  
**Area:** FE  
**Type:** Implementation Plan  
**Status:** Complete  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-16  

---

# IMPL: SA UI — AV Hilbert Transform Endpoint Integration (FE)

## Overview

FE-only implementation. The backend endpoint (`partnerTechnicalIndicatorsV2`) is deployed and verified. This plan covers wiring the Angular chart-view to call the endpoint, display all 6 indicators in overlays and lower panes, and manage cached state.

## Architecture

### Current state

```
ChartViewComponent (single Syncfusion chart)
  → ChartViewStore (NgRx SignalStore)
    → ChartDataService (Firestore only — no HTTP calls to backend)
    → hilbert-indicators.ts (client-side calc, called during data load)
```

### Target state

```
ChartViewComponent (Syncfusion chart with multiple rows/panes)
  → ChartViewStore (NgRx SignalStore)
    → ChartDataService (Firestore — unchanged)
    → TechnicalIndicatorsService (NEW — HttpClient calls to partnerTechnicalIndicatorsV2)
    → hilbert-indicators.ts (PRESERVED — not called, kept for Topic #19)
```

## Components to create/modify

### 1. TechnicalIndicatorsService (NEW)

**File:** `src/app/feat/chart-view/services/technical-indicators.service.ts`

**Purpose:** Calls `partnerTechnicalIndicatorsV2` via HttpClient. Returns observable of indicator data.

**Methods:**
```typescript
getTechnicalIndicator(params: {
  symbol: string;
  indicator: HtIndicator;      // enum: HT_TRENDLINE | HT_SINE | HT_DCPERIOD | HT_DCPHASE | HT_TRENDMODE | HT_PHASOR
  interval: TimeSeriesInterval; // enum: DAILY | WEEKLY | MONTHLY
  series_type: PriceSeries;     // enum: CLOSE | OPEN | HIGH | LOW
}): Observable<TechnicalIndicatorResponse>
```

**Enums (new, in shared or FE-local):**
```typescript
enum HtIndicator {
  HT_TRENDLINE = 'ht_trendline',
  HT_SINE = 'ht_sine',
  HT_DCPERIOD = 'ht_dcperiod',
  HT_DCPHASE = 'ht_dcphase',
  HT_TRENDMODE = 'ht_trendmode',
  HT_PHASOR = 'ht_phasor',
}

enum PriceSeries {
  CLOSE = 'close',
  OPEN = 'open',
  HIGH = 'high',
  LOW = 'low',
}
```

**Response type:**
```typescript
interface TechnicalIndicatorResponse {
  ok: boolean;
  symbol: string;
  indicator: string;
  interval: string;
  series_type: string;
  data: Record<string, Record<string, string>>; // date-keyed AV response
  timestamp: string;
  processingTimeMs: number;
}
```

**URL construction:** The partner endpoint URL needs to be registered in the FE's URL config. Two options:
- Add to `PROD_URLS` in `fe-common-app.ts` with a new `PartnerFunctionName` enum entry
- Add to `API_BASES` injection token

Recommend: Add `PartnerFunctionName` enum to `fe-common-fn.ts` and `PARTNER_TECHNICAL_INDICATORS_V2` to `PROD_URLS`. This follows the existing pattern.

**Auth:** The auth interceptor (`auth.interceptor.ts`) adds the Firebase ID token to requests matching `backendUrls`. The partner endpoint URL must be added to that list. Update `backendUrls` array to include `StockDataUrl` entries for partner endpoints, or add a new `PartnerBackendUrls` array.

### 2. ChartViewStore (MODIFY)

**File:** `src/app/feat/chart-view/store/chart-view.store.ts`

**Changes:**

**State additions:**
```typescript
// Series type for indicator computation
indicatorSeriesType: PriceSeries; // default: CLOSE

// Show/hide client-side approximation (independent of endpoint indicators)
showLocalHtCalc: boolean; // default: false

// Per-indicator state (endpoint-based)
interface IndicatorState {
  show: boolean;           // toggle on/off
  loading: boolean;        // fetch in progress
  error: string | null;    // error message if fetch failed
  data: IndicatorPoint[];  // cached aligned data (empty until fetched)
}

// 6 indicator states + sine display mode
htTrendline: IndicatorState;
htSine: IndicatorState;       // includes lead sine
htDcperiod: IndicatorState;
htDcphase: IndicatorState;
htTrendmode: IndicatorState;
htPhasor: IndicatorState;     // includes in-phase + quadrature
sineDisplayMode: 'overlay' | 'pane' | 'both'; // default: 'pane'```

**Remove:** `showHtTrendline`, `showHtSine`, `htTrendlineData`, `htSineData`, `htLeadSineData` (replaced by IndicatorState objects)

**Keep client-side calc:** Do NOT remove the `calculateHilbertIndicators` call from `loadChartData`. Keep it as-is. Add a new toggle `showLocalHtCalc` (default: OFF) to show/hide the client-side approximation plots. The client-side calc and the endpoint-based indicators are fully independent — toggling one does not affect the other. This supports Topic #19 (accuracy validation) and allows quick visual comparison.

**New methods:**
```typescript
toggleIndicator(indicator: HtIndicator): void       // toggle on/off, fetch if on + no cache
setIndicatorSeriesType(seriesType: PriceSeries): void // re-fetch all toggled indicators
setSineDisplayMode(mode: 'overlay' | 'pane' | 'both'): void  // no re-fetch, just display change
toggleLocalHtCalc(): void                              // show/hide client-side approximation
clearIndicatorCache(): void                            // on symbol/interval change
```

**Fetch logic:** When an indicator is toggled ON:
1. Check if cached data exists for current symbol/interval/series_type → if yes, just set `show: true`
2. If no cache → set `loading: true`, call `TechnicalIndicatorsService.getTechnicalIndicator()`
3. On success → stitch to candle dates, store in `data`, set `loading: false`
4. On error → set `error` message, set `loading: false`, show toast

**Stitching:** Same pattern as existing `categoryHtTrendline` computed — build `dateToIndex` map from chart bars, map indicator data points to indices, drop orphans.

**Cache invalidation:** On `selectSymbol` or `setInterval` → clear all indicator data, re-fetch any that are currently `show: true`.

### 3. ChartViewComponent (MODIFY)

**File:** `src/app/feat/chart-view/chart-view.component.ts`

**Changes:**

**Toggle controls:** Keep the 2 existing HT toggles (client-side calc, now controlled by `showLocalHtCalc`). Add 6 new endpoint indicator toggles alongside them. Each new toggle shows loading state (spinner/disabled) and error state (red border). Add a "Local Calc" toggle to show/hide the client-side approximation plots independently.

**Series type dropdown:** Add `mat-select` with 4 options (Close, Open, High, Low).

**Sine display mode:** Add a small toggle/segmented control on the HT_SINE toggle: "Overlay" | "Pane" | "Both". "Both" plots sine + lead sine on the price chart (dual y-axis) AND in a lower pane simultaneously.

**Chart rows configuration:** Configure Syncfusion chart `rows` for multi-pane layout:
```typescript
// Dynamic rows based on which panes are active
// Row 0: Price chart (candlesticks + trendline overlay + sine overlay if selected)
// Row 1: HT_PHASOR (if toggled)
// Row 2: HT_TRENDMODE (if toggled, ~50px)
// Row 3: HT_SINE (if toggled in pane mode)
// Row 4: HT_DCPERIOD (if toggled)
// Row 5: HT_DCPHASE (if toggled)
```

**Computed signals:** Replace `categoryHtTrendline`, `categoryHtSine`, `categoryHtLeadSine` with a generic computed that maps any indicator's data to category indices. Or create per-indicator computeds following the existing pattern.

**Axes:** Add y-axes for each lower pane indicator. Each axis has `rowIndex` matching its pane position. HT_TRENDMODE axis: 0 to 1. Others: auto-range.

### 4. ChartViewComponent HTML (MODIFY)

**File:** `src/app/feat/chart-view/chart-view.component.html`

**Changes:**
- Add 6 endpoint indicator toggle controls alongside existing 2 HT toggles + series_type dropdown + sine display mode
- Add `e-rows` configuration for multi-pane layout
- Add `e-series` entries for each indicator in its respective pane/axis
- Each lower-pane indicator gets its own series bound to its axis and row

### 5. Auth Interceptor (MODIFY)

**File:** `src/app/core/auth/auth.interceptor.ts`

**Changes:** Add partner endpoint URLs to `backendUrls` array so the interceptor adds the Firebase ID token.

### 6. FE Common Config (MODIFY)

**Files:** `src/app/common/fe-common-fn.ts`, `src/app/common/fe-common-app.ts`

**Changes:**
- Add `PartnerFunctionName` enum with `PARTNER_TECHNICAL_INDICATORS_V2 = 'partnerTechnicalIndicatorsV2'`
- Add production URL to `PROD_URLS`
- Add dev URL pattern to `getFunctionUrl`

## Data flow

```
1. User toggles HT_DCPERIOD ON
2. Store: check cache → miss → set loading=true
3. TechnicalIndicatorsService.getTechnicalIndicator({symbol, indicator: 'ht_dcperiod', interval, series_type})
4. HttpClient GET partnerTechnicalIndicatorsV2?symbol=IBM&indicator=ht_dcperiod&interval=daily&series_type=close
5. Auth interceptor adds Firebase ID token
6. Backend: authenticateRequestEither → Firebase path → AV API call → return envelope
7. Service: receive response, extract data field
8. Store: stitch data to candle dates → store in htDcperiod.data → set loading=false
9. Component: computed signal detects data → series renders in lower pane
```

## Technical risks

0. **UI space budget:** Angular Material components are visually large. The controls bar must be as compact as possible — minimize height and width of all toggles, dropdowns, and selectors. Maximizing chart space is the priority. Use compact/dense Material variants, inline toggles, minimal labels, and group controls horizontally. The controls bar should not grow taller than the current bar when adding 4 new toggles + series_type dropdown + sine mode control. Consider a collapsible "Indicators" section or an icon-only toggle row if the controls would overflow horizontally.

1. **Syncfusion multi-pane rendering:** The current chart uses a single row. Adding rows changes the layout significantly. Risk: zoom/scroll behavior may differ across panes. Mitigation: test early with a single lower pane before adding all 5.

2. **Dynamic row configuration:** Rows must be added/removed as indicators are toggled. Syncfusion may require a full chart refresh when rows change. Risk: performance hit on toggle. Mitigation: pre-define all possible rows, hide empty ones via height: 0%.

3. **AV response parsing:** Each indicator returns a different data shape (HT_SINE has 2 series, HT_PHASOR has 2 series, HT_TRENDMODE is binary). The service must parse each correctly. Risk: malformed data. Mitigation: per-indicator parse functions with validation.

4. **Auth interceptor URL matching:** The interceptor matches by URL prefix. The partner endpoint URL is a cloudfunctions.net URL, which is a different domain than the existing `a.run.app` URLs. Risk: interceptor doesn't match. Mitigation: add the full cloudfunctions.net URL to backendUrls.

## Implementation order (tasks)

### Task 1: Config + Service + Interceptor
- Add PartnerFunctionName enum + PROD_URLS entry
- Add partner URL to auth interceptor backendUrls
- Create TechnicalIndicatorsService with getTechnicalIndicator method
- Unit test: service constructs correct URL, passes params, handles response

### Task 2: Store refactor — indicator state + fetch logic
- Replace flat HT state with IndicatorState objects
- Add showLocalHtCalc toggle (default off) — keep client-side calc, don't remove it
- Add toggleIndicator, setIndicatorSeriesType, setSineDisplayMode, toggleLocalHtCalc methods
- Add fetch logic with cache check + stitching
- Client-side calc and endpoint indicators are fully independent
- Unit test: toggle fetches when no cache, reuses cache, clears on symbol/interval change

### Task 3: Component — toggles + series_type dropdown + sine display mode
- Keep existing 2 HT toggles (client-side calc) — add showLocalHtCalc toggle
- Add 6 new endpoint indicator toggles + series_type dropdown + sine mode control
- **UI constraint:** Minimize controls bar footprint — use compact Material variants, inline layout, minimal labels. Chart space is the priority. Controls bar must not grow taller than current bar.
- Wire all toggle handlers to store methods
- Show loading/error states on endpoint indicator toggles (compact — icon or color change, not expanded layout)
- Show toast on fetch error

### Task 4: Component — multi-pane chart layout
- Configure Syncfusion rows for multi-pane layout
- Add y-axes for each lower-pane indicator
- Add series bindings for each indicator
- Implement dynamic row visibility (hide empty panes)
- Test: all panes fit in viewport, no scrollbar, x-axis shared

### Task 5: Integration test + polish
- End-to-end: toggle each indicator, verify data plots correctly
- Test sine overlay vs pane mode switching
- Test series_type change re-fetches
- Test interval change clears cache
- Test error toast on simulated AV failure
- Visual polish: pane heights, colors, labels
