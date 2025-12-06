import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { inject } from '@angular/core';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of } from 'rxjs';
import { ChartDataService } from '../services/chart-data.service';

type ChartViewState = {
  symbols: string[];
  selectedSymbol: string | null;
  isSplitAdjusted: boolean;
  chartData: any[];
  isLoading: boolean;
  error: string | null;
};

const initialState: ChartViewState = {
  symbols: [],
  selectedSymbol: null,
  isSplitAdjusted: true, // Default to split-adjusted as it's often more useful for charts
  chartData: [],
  isLoading: false,
  error: null,
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
          
          if (!symbol) {
             patchState(store, { isLoading: false, chartData: [] });
             return of([]);
          }

          const currentYear = new Date().getFullYear();
          // Use getAllTimeSeriesData instead of getYearlyData
          return chartService.getAllTimeSeriesData(symbol, isSplit).pipe(
             tap((yearsData) => {
               // Merge all bars from all years
               const allBars = yearsData.flatMap(yearDoc => yearDoc['bars'] || []);
               
               const transformedBars = allBars.map((b: any) => {
                 // Handle various date formats (Firestore Timestamp, string, number)
                 let date: Date;
                 if (b.t && typeof b.t.toDate === 'function') {
                   date = b.t.toDate();
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
      }
    };
  })
);
