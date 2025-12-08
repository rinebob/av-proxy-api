import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { inject } from '@angular/core';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of } from 'rxjs';
import { ChartDataService } from '../services/chart-data.service';

import { TimeSeriesInterval } from '@shared/alpha-vantage';

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
};

const initialState: ChartViewState = {
  symbols: [],
  selectedSymbol: null,
  selectedInterval: TimeSeriesInterval.DAILY,
  isSplitAdjusted: true, // Default to split-adjusted as it's often more useful for charts
  chartData: [],
  isLoading: false,
  error: null,
  zoomFactor: null,
  zoomPosition: null,
};

export const ChartViewStore = signalStore(
  withState(initialState),
  withMethods((store, chartService = inject(ChartDataService)) => {
    
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

          const currentYear = new Date().getFullYear();
          // Use getAllTimeSeriesData instead of getYearlyData
          return chartService.getAllTimeSeriesData(symbol, isSplit, interval).pipe(
             tap((data) => {
               // Handle different return types (sharded array vs single monthly array)
               // Daily/Weekly return array of year docs which contain 'bars'
               // Monthly (via modified service) returns array of bars directly
               
               let allBars: any[] = [];
               
               if (interval === TimeSeriesInterval.MONTHLY) {
                   // Service returns bars directly for monthly
                   allBars = data;
               } else {
                   // Daily/Weekly: data is array of year docs { bars: [...] }
                   allBars = data.flatMap(yearDoc => yearDoc['bars'] || []);
               }
               
               const transformedBars = allBars.map((b: any) => {
                 // Handle various date formats (Firestore Timestamp, string, number)
                 let date: Date;
                 if (b.t && typeof b.t.toDate === 'function') {
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

               patchState(store, { chartData: transformedBars, isLoading: false });
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
        loadChartData();
      },
      setSplitAdjusted: (isSplit: boolean) => {
        patchState(store, { isSplitAdjusted: isSplit });
        loadChartData();
      },
      setInterval: (interval: TimeSeriesInterval) => {
        patchState(store, { selectedInterval: interval });
        loadChartData();
      },
      setZoomSettings: (zoomFactor: number, zoomPosition: number) => {
        patchState(store, { zoomFactor, zoomPosition });
      }
    };
  })
);
