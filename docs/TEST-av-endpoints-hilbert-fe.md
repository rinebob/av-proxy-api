**Topic:** SA UI — AV Hilbert Transform Endpoint Integration  
**Issue:** #17  
**Domain:** AV-ENDPOINTS  
**Area:** FE  
**Type:** Test Plan  
**Status:** Complete  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-15  

---

# TEST: SA UI — AV Hilbert Transform Endpoint Integration (FE)

## E2E journeys

### E2E-1: Toggle single indicator on/off
1. Load a tracked symbol (e.g., IBM) with daily interval
2. Toggle HT_DCPERIOD ON
3. Verify: loading state appears on toggle
4. Verify: lower pane appears with a line plot
5. Verify: plot aligns with candle x-axis (no gaps, same date range)
6. Toggle HT_DCPERIOD OFF
7. Verify: lower pane disappears, plot hidden
8. Toggle HT_DCPERIOD ON again
9. Verify: plot appears instantly (cached, no loading state, no network call)

### E2E-2: Multiple indicators simultaneously
1. Load symbol, toggle HT_PHASOR, HT_TRENDMODE, HT_SINE (pane mode)
2. Verify: 3 lower panes appear in order (Phasor, Trendmode, Sine/Lead)
3. Verify: all panes fit in viewport, no scrollbar
4. Verify: HT_TRENDMODE pane is shorter (~50px) than others
5. Verify: all plots share the same x-axis as candles

### E2E-3: Sine overlay vs pane mode
1. Toggle HT_SINE ON in pane mode (default)
2. Verify: sine + lead sine plot in lower pane
3. Switch to overlay mode
4. Verify: sine + lead sine move to price chart with secondary y-axis (-1 to +1)
5. Verify: lower pane disappears
6. Switch back to pane mode
7. Verify: sine + lead sine move back to lower pane, secondary axis removed
8. Verify: no re-fetch occurred (instant switch)

### E2E-4: Series type change
1. Toggle HT_TRENDLINE ON with series_type=close
2. Verify: trendline plots on price chart
3. Change series_type to high
4. Verify: all toggled indicators re-fetch
5. Verify: trendline values differ from close-based values

### E2E-5: Interval change clears cache
1. Toggle HT_DCPERIOD ON with daily interval
2. Switch chart to weekly interval
3. Verify: HT_DCPERIOD re-fetches with weekly data
4. Verify: plot reflects weekly interval values

### E2E-6: Symbol change clears cache
1. Toggle HT_DCPERIOD ON for IBM
2. Switch symbol to AAPL
3. Verify: HT_DCPERIOD re-fetches for AAPL
4. Verify: plot reflects AAPL data

### E2E-7: Error handling
1. Toggle an indicator ON
2. Simulate AV rate limit (429 response)
3. Verify: toast appears with AV error message
4. Verify: toggle shows error state
5. Verify: other indicators can still be toggled independently

## Integration boundaries

### IB-1: TechnicalIndicatorsService → partnerTechnicalIndicatorsV2
- **Test:** Service constructs correct URL with query params
- **Test:** Auth interceptor adds Firebase ID token to request
- **Test:** Service parses standard envelope response correctly
- **Test:** Service handles non-ok responses (429, 502, 504) and surfaces error message

### IB-2: Store → TechnicalIndicatorsService
- **Test:** Store calls service on toggle when no cache exists
- **Test:** Store does NOT call service when cache exists (toggle off→on)
- **Test:** Store stitches response data to candle dates correctly
- **Test:** Store clears cache on symbol/interval change

### IB-3: Component → Store
- **Test:** Toggle UI calls correct store method
- **Test:** Series type dropdown calls setIndicatorSeriesType
- **Test:** Sine display mode toggle calls setSineDisplayMode
- **Test:** Loading state reflects in toggle UI
- **Test:** Error state reflects in toggle UI

## Unit test targets

### TechnicalIndicatorsService
- URL construction with all param combinations
- Response parsing for each indicator type (single series, dual series, binary)
- Error handling for 429, 502, 504, network errors

### ChartViewStore
- toggleIndicator: fetch when no cache, reuse when cached
- toggleIndicator: set loading state, clear on success/error
- setIndicatorSeriesType: re-fetch all toggled indicators
- setSineDisplayMode: no re-fetch, just state change
- clearIndicatorCache: on symbol change, on interval change
- Stitching: map date-keyed AV data to category indices, drop orphans

### ChartViewComponent
- Computed signals: map indicator data to category indices
- Dynamic row configuration: correct rows for toggled indicators
- Pane order: Phasor → Trendmode → Sine → DCPERIOD → DCPHASE

## Test seams

1. **TechnicalIndicatorsService:** Inject via DI, mock HttpClient in tests
2. **Store:** Use provideMockStore or direct signal store testing
3. **Auth interceptor:** Mock AuthService to provide test token
4. **AV responses:** Use fixture files with real AV response shapes per indicator

## Edge cases

1. **Empty AV response:** AV returns data with no entries (new symbol, no history) → indicator plot is empty, no error
2. **Warmup period:** First N bars have no indicator values → line starts later, no gap
3. **Date mismatch:** AV has dates not in Firestore candles → those values dropped
4. **All indicators on:** 5 lower panes + price chart → all fit in viewport, no scrollbar
5. **Rapid toggling:** User toggles indicator on/off quickly → no race condition, latest state wins
6. **Series type change during fetch:** User changes series_type while an indicator is loading → cancel in-flight, re-fetch with new series_type
7. **Symbol change during fetch:** User switches symbol while indicator is loading → cancel in-flight, clear cache, no stale data plotted
8. **HT_TRENDMODE binary values:** Only 0 and 1 → y-axis fixed at 0-1, pane height ~50px
9. **HT_SINE dual series:** Sine + Lead Sine in one fetch → both plotted in same pane/axis
10. **HT_PHASOR dual series:** In-phase + Quadrature in one fetch → both plotted in same pane
