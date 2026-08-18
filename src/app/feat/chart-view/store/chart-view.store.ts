import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { inject } from '@angular/core';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of, EMPTY, Subscription } from 'rxjs';
import { ChartDataService } from '../services/chart-data.service';
import { TechnicalIndicatorsService } from '../services/technical-indicators.service';
import { calculateHilbertIndicators } from '../services/hilbert-indicators';

import { HtIndicator, PriceSeries, TimeSeriesInterval } from '@shared/alpha-vantage';

export interface IndicatorPoint {
  t: Date;
  v: number;
}

/** Dual-series point for HT_SINE (sine + lead_sine) and HT_PHASOR (in_phase + quadrature). */
export interface DualIndicatorPoint {
  t: Date;
  v1: number; // primary: sine / in_phase
  v2: number; // secondary: lead_sine / quadrature
}

/** Per-indicator state for endpoint-based indicators. */
export interface IndicatorState {
  show: boolean;
  loading: boolean;
  error: string | null;
  data: IndicatorPoint[];
  dualData?: DualIndicatorPoint[];
  rawData?: Record<string, Record<string, string>>; // stored for re-stitching when chartData loads
}

function emptyIndicatorState(isDual: boolean = false): IndicatorState {
  return { show: false, loading: false, error: null, data: [], dualData: isDual ? [] : undefined, rawData: undefined };
}

/** AV response field names per indicator.
 *  These must match the field names inside the "Technical Analysis: <INDICATOR>" entries
 *  returned by the Alpha Vantage API.
 *
 *  NOTE: HT_PHASOR field names ('PHASE'/'QUADRATURE') are unverified against a live AV
 *  response — the demo API key doesn't support HT_PHASOR. TA-Lib uses 'inphase'/'quadrature',
 *  but AV often diverges from TA-Lib naming (e.g. 'LEAD SINE' with a space for HT_SINE).
 *  If stitching yields 0 points for HT_PHASOR, try 'INPHASE' instead of 'PHASE'. */
const INDICATOR_FIELD_MAP: Record<HtIndicator, { primary: string; secondary?: string }> = {
  [HtIndicator.HT_TRENDLINE]: { primary: 'HT_TRENDLINE' },
  [HtIndicator.HT_SINE]: { primary: 'SINE', secondary: 'LEAD SINE' },
  [HtIndicator.HT_DCPERIOD]: { primary: 'DCPERIOD' },
  [HtIndicator.HT_DCPHASE]: { primary: 'HT_DCPHASE' },
  [HtIndicator.HT_TRENDMODE]: { primary: 'TRENDMODE' },
  [HtIndicator.HT_PHASOR]: { primary: 'PHASE', secondary: 'QUADRATURE' },
};

type ChartViewState = {
  symbols: string[];
  selectedSymbol: string | null;
  selectedInterval: TimeSeriesInterval;
  isSplitAdjusted: boolean;
  chartData: any[];
  isLoading: boolean;
  error: string | null;
  zoomFactor: number | null;
  zoomPosition: number | null;

  // Client-side calc (Topic #19 — independent of endpoint indicators)
  showLocalHtCalc: boolean;
  htTrendlineData: IndicatorPoint[];
  htSineData: IndicatorPoint[];
  htLeadSineData: IndicatorPoint[];

  // Endpoint-based indicator state (Topic #17)
  indicatorSeriesType: PriceSeries;
  sineDisplayMode: 'overlay' | 'pane' | 'both';
  htTrendline: IndicatorState;
  htSine: IndicatorState;
  htDcperiod: IndicatorState;
  htDcphase: IndicatorState;
  htTrendmode: IndicatorState;
  htPhasor: IndicatorState;
};

const initialState: ChartViewState = {
  symbols: [],
  selectedSymbol: null,
  selectedInterval: TimeSeriesInterval.DAILY,
  isSplitAdjusted: true,
  chartData: [],
  isLoading: false,
  error: null,
  zoomFactor: null,
  zoomPosition: null,

  showLocalHtCalc: false,
  htTrendlineData: [],
  htSineData: [],
  htLeadSineData: [],

  indicatorSeriesType: PriceSeries.CLOSE,
  sineDisplayMode: 'pane',
  htTrendline: emptyIndicatorState(),
  htSine: emptyIndicatorState(true),
  htDcperiod: emptyIndicatorState(),
  htDcphase: emptyIndicatorState(),
  htTrendmode: emptyIndicatorState(),
  htPhasor: emptyIndicatorState(true),
};

/** Map HtIndicator enum to the state field name. */
function indicatorKeyToField(key: HtIndicator): keyof ChartViewState {
  switch (key) {
    case HtIndicator.HT_TRENDLINE: return 'htTrendline';
    case HtIndicator.HT_SINE: return 'htSine';
    case HtIndicator.HT_DCPERIOD: return 'htDcperiod';
    case HtIndicator.HT_DCPHASE: return 'htDcphase';
    case HtIndicator.HT_TRENDMODE: return 'htTrendmode';
    case HtIndicator.HT_PHASOR: return 'htPhasor';
  }
}

/** Build a dateKey string (YYYY-MM-DD) from a Date for stitching. */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Extract the date-keyed data from an AV technical indicator response.
 *  AV wraps the actual data inside a "Technical Analysis: <INDICATOR>" key,
 *  alongside a "Meta Data" key. This unwraps the nested structure. */
function extractDateKeyedData(
  avData: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  // Look for a key that starts with "Technical Analysis" — that's the date-keyed data.
  const taKey = Object.keys(avData).find(k => k.startsWith('Technical Analysis'));
  if (taKey && avData[taKey]) {
    return avData[taKey] as unknown as Record<string, Record<string, string>>;
  }
  // Fallback: if no "Technical Analysis" wrapper, assume the data is already flat
  // (date-keyed at top level). Non-date keys (e.g. "Meta Data") will be ignored by
  // the downstream date-matching in stitchIndicatorData.
  return avData;
}

/** Stitch AV date-keyed response data to chartData candle dates. Drops orphans. */
function stitchIndicatorData(
  avData: Record<string, Record<string, string>>,
  fieldMap: { primary: string; secondary?: string },
  chartData: any[],
): { data: IndicatorPoint[]; dualData?: DualIndicatorPoint[] } {
  if (chartData.length === 0) {
    return { data: [], dualData: fieldMap.secondary ? [] : undefined };
  }

  // Unwrap the AV response structure if needed
  const dateKeyedData = extractDateKeyedData(avData);

  const dateToIndex = new Map<string, number>();
  chartData.forEach((bar: any, i: number) => {
    dateToIndex.set(dateKey(bar.t), i);
  });

  const isDual = !!fieldMap.secondary;
  const data: IndicatorPoint[] = [];
  const dualData: DualIndicatorPoint[] = [];

  // Sort AV dates ascending
  const sortedDates = Object.keys(dateKeyedData).sort();

  for (const dateStr of sortedDates) {
    const idx = dateToIndex.get(dateStr);
    if (idx == null) continue; // drop orphans (dates in AV but not in chartData)

    const bar = chartData[idx];
    const entry = dateKeyedData[dateStr];
    const primaryVal = entry[fieldMap.primary];
    if (primaryVal == null) continue;

    if (isDual && fieldMap.secondary) {
      const secondaryVal = entry[fieldMap.secondary];
      if (secondaryVal == null) continue;
      dualData.push({ t: bar.t, v1: Number(primaryVal), v2: Number(secondaryVal) });
    } else {
      data.push({ t: bar.t, v: Number(primaryVal) });
    }
  }

  return { data, dualData: isDual ? dualData : undefined };
}

/** All indicator keys for iteration. */
const ALL_INDICATORS: HtIndicator[] = [
  HtIndicator.HT_TRENDLINE,
  HtIndicator.HT_SINE,
  HtIndicator.HT_DCPERIOD,
  HtIndicator.HT_DCPHASE,
  HtIndicator.HT_TRENDMODE,
  HtIndicator.HT_PHASOR,
];

export const ChartViewStore = signalStore(
  withState(initialState),
  withMethods((store, chartService = inject(ChartDataService), tiService = inject(TechnicalIndicatorsService)) => {

    // Track active fetch subscriptions per indicator for cancellation
    const activeFetches = new Map<HtIndicator, Subscription>();

    // Cancel any in-flight fetch for a given indicator
    const cancelFetch = (key: HtIndicator) => {
      const sub = activeFetches.get(key);
      if (sub) {
        sub.unsubscribe();
        activeFetches.delete(key);
      }
    };

    // Helper to clear all endpoint indicator state + cancel all fetches
    const clearIndicatorCache = () => {
      // Cancel all in-flight requests
      activeFetches.forEach(sub => sub.unsubscribe());
      activeFetches.clear();

      patchState(store, {
        htTrendline: emptyIndicatorState(),
        htSine: emptyIndicatorState(true),
        htDcperiod: emptyIndicatorState(),
        htDcphase: emptyIndicatorState(),
        htTrendmode: emptyIndicatorState(),
        htPhasor: emptyIndicatorState(true),
      });
    };

    // Re-stitch all indicators that have rawData, using current chartData.
    // Called after chartData loads to handle the race where fetch completed before chartData was available.
    const restitchAllFromCache = () => {
      const chartData = store.chartData();
      if (chartData.length === 0) return;

      const patch: Partial<ChartViewState> = {};
      for (const key of ALL_INDICATORS) {
        const field = indicatorKeyToField(key);
        const state = store[field]() as IndicatorState;
        if (state.rawData && Object.keys(state.rawData).length > 0) {
          const stitched = stitchIndicatorData(state.rawData, INDICATOR_FIELD_MAP[key], chartData);
          (patch as any)[field] = {
            ...state,
            data: stitched.data,
            dualData: stitched.dualData,
          };
        }
      }
      if (Object.keys(patch).length > 0) {
        patchState(store, patch as any);
      }
    };

    // Fetch a single indicator and stitch to chartData.
    // Cancels any previous in-flight fetch for the same indicator.
    const fetchIndicator = (key: HtIndicator) => {
      // Cancel previous fetch for this indicator (handles rapid toggling, series_type change)
      cancelFetch(key);

      const field = indicatorKeyToField(key);
      const currentState = store[field]() as IndicatorState;
      const fieldMap = INDICATOR_FIELD_MAP[key];

      // Set loading
      patchState(store, {
        [field]: { ...currentState, loading: true, error: null },
      } as any);

      const symbol = store.selectedSymbol();
      const interval = store.selectedInterval();
      const seriesType = store.indicatorSeriesType();

      if (!symbol) {
        patchState(store, {
          [field]: { ...currentState, loading: false, error: 'No symbol selected' },
        } as any);
        return;
      }

      const sub = tiService.getTechnicalIndicator({
        symbol,
        indicator: key,
        interval,
        series_type: seriesType,
      }).subscribe({
        next: (response) => {
          activeFetches.delete(key);
          const chartData = store.chartData();
          const stitched = stitchIndicatorData(response.data, fieldMap, chartData);
          const updatedState = store[field]() as IndicatorState;
          patchState(store, {
            [field]: {
              ...updatedState,
              loading: false,
              error: null,
              data: stitched.data,
              dualData: stitched.dualData,
              rawData: response.data, // store for re-stitching when chartData loads
            },
          } as any);
        },
        error: (err) => {
          activeFetches.delete(key);
          const updatedState = store[field]() as IndicatorState;
          patchState(store, {
            [field]: {
              ...updatedState,
              loading: false,
              error: err.message || 'Fetch failed',
            },
          } as any);
        },
      });
      activeFetches.set(key, sub);
    };

    // Helper to load data based on current state
    const loadChartData = rxMethod<void>(
      pipe(
        tap(() => patchState(store, { isLoading: true })),
        switchMap(() => {
          const symbol = store.selectedSymbol();
          const isSplit = store.isSplitAdjusted();
          const interval = store.selectedInterval();

          if (!symbol) {
             patchState(store, { isLoading: false, chartData: [] });
             return of([]);
          }

          return chartService.getAllTimeSeriesData(symbol, isSplit, interval).pipe(
             tap((data) => {
               // Handle different return types (sharded array vs single monthly array)
               // Daily/Weekly return array of year docs which contain 'bars'
               // Monthly returns array of bars directly
               let allBars: any[] = [];

               if (interval === TimeSeriesInterval.MONTHLY) {
                   allBars = data;
               } else {
                   allBars = data.flatMap(yearDoc => yearDoc['bars'] || []);
               }

               const transformedBars = allBars.map((b: any) => {
                 // Handle various date formats (Firestore Timestamp, string, number)
                 let date: Date;

                 // Prefer using the 'd' string (YYYY-MM-DD) to construct a Local Date.
                 // This ensures "2025-12-08" becomes "Dec 8, 2025 00:00:00 Local"
                 // instead of "Dec 8, 2025 00:00:00 UTC" (which might be Dec 7 Local).
                 if (b.d && typeof b.d === 'string') {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(b.d)) {
                        // YYYY-MM-DD (Daily/Weekly/Monthly) -> Local Midnight
                        const [yyyy, mm, dd] = b.d.split('-').map(Number);
                        date = new Date(yyyy, mm - 1, dd);
                    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(b.d)) {
                        // YYYY-MM-DD HH:MM:SS (Intraday) -> Local Time
                        const [datePart, timePart] = b.d.split(' ');
                        const [yyyy, mm, dd] = datePart.split('-').map(Number);
                        const [hh, min, ss] = timePart.split(':').map(Number);
                        date = new Date(yyyy, mm - 1, dd, hh, min, ss);
                    } else {
                        // Fallback
                        date = new Date(b.t);
                    }
                 } else if (b.t && typeof b.t.toDate === 'function') {
                   date = b.t.toDate();
                 } else if (typeof b.t === 'number') {
                    date = new Date(b.t);
                 } else {
                   date = new Date(b.t);
                 }

                 return {
                   t: date,
                   o: Number(b.o),
                   h: Number(b.h),
                   l: Number(b.l),
                   c: Number(b.c),
                   v: Number(b.v)
                 };
               });

               // Sort by timestamp explicitly
               transformedBars.sort((a, b) => a.t.getTime() - b.t.getTime());

               // Compute Hilbert Transform indicators from close prices (client-side calc)
               const closes = transformedBars.map((b: any) => b.c);
               const ht = calculateHilbertIndicators(closes);

               const htTrendlineData: IndicatorPoint[] = [];
               const htSineData: IndicatorPoint[] = [];
               const htLeadSineData: IndicatorPoint[] = [];

               for (let i = 0; i < transformedBars.length; i++) {
                 const t = transformedBars[i].t;
                 if (ht.trendline[i] != null) {
                   htTrendlineData.push({ t, v: ht.trendline[i]! });
                 }
                 if (ht.sine[i] != null) {
                   htSineData.push({ t, v: ht.sine[i]! });
                 }
                 if (ht.leadSine[i] != null) {
                   htLeadSineData.push({ t, v: ht.leadSine[i]! });
                 }
               }

               patchState(store, {
                 chartData: transformedBars,
                 isLoading: false,
                 htTrendlineData,
                 htSineData,
                 htLeadSineData,
               });

               // Re-stitch any endpoint indicators that have raw data but couldn't stitch before
               restitchAllFromCache();
             }),
             catchError((err) => {
                patchState(store, { error: err.message, isLoading: false });
                return of([]);
             })
           );
        })
      )
    );

    return {
      loadSymbols: rxMethod<void>(
        pipe(
          tap(() => patchState(store, { isLoading: true })),
          switchMap(() => chartService.getTrackedSymbols().pipe(
            tap((symbols) => patchState(store, { symbols, isLoading: false })),
            catchError((err) => {
              patchState(store, { error: err.message, isLoading: false });
              return of([]);
            })
          ))
        )
      ),
      selectSymbol: (symbol: string) => {
        patchState(store, { selectedSymbol: symbol });
        clearIndicatorCache();
        loadChartData();
      },
      setSplitAdjusted: (isSplit: boolean) => {
        patchState(store, { isSplitAdjusted: isSplit });
        loadChartData();
      },
      setInterval: (interval: TimeSeriesInterval) => {
        patchState(store, { selectedInterval: interval });
        clearIndicatorCache();
        loadChartData();
      },
      setZoomSettings: (zoomFactor: number | null, zoomPosition: number | null) => {
        patchState(store, { zoomFactor, zoomPosition });
      },

      // ---- Endpoint indicator methods (Topic #17) ----

      toggleIndicator: (key: HtIndicator) => {
        const field = indicatorKeyToField(key);
        const current = store[field]() as IndicatorState;

        if (current.show) {
          // Toggle OFF — cancel any in-flight fetch, just hide, keep cached data
          cancelFetch(key);
          patchState(store, {
            [field]: { ...current, show: false, loading: false },
          } as any);
        } else {
          // Toggle ON
          if (current.data.length > 0 || (current.dualData && current.dualData.length > 0)) {
            // Cache exists — just show, no fetch
            patchState(store, {
              [field]: { ...current, show: true },
            } as any);
          } else {
            // No cache — show + fetch
            patchState(store, {
              [field]: { ...current, show: true },
            } as any);
            fetchIndicator(key);
          }
        }
      },

      setIndicatorSeriesType: (seriesType: PriceSeries) => {
        patchState(store, { indicatorSeriesType: seriesType });

        // Re-fetch all shown indicators (fetchIndicator cancels previous fetch for each)
        for (const key of ALL_INDICATORS) {
          const field = indicatorKeyToField(key);
          if ((store[field]() as IndicatorState).show) fetchIndicator(key);
        }
      },

      setSineDisplayMode: (mode: 'overlay' | 'pane' | 'both') => {
        patchState(store, { sineDisplayMode: mode });
      },

      toggleLocalHtCalc: () => {
        patchState(store, { showLocalHtCalc: !store.showLocalHtCalc() });
      },

      clearIndicatorCache,
    };
  })
);
