import { signalStore, withState, patchState, withMethods, withProps } from '@ngrx/signals';
import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

import { AlphaVantageDataService } from '../services/alpha-vantage-data.service';
import { FetchAlphaVantageParams } from '../common/fe-common-av-api';

export interface AlphaVantageState {
  symbol: string;
  loading: boolean;
  error: string | null;
  currentData: any | null;
  endpoint: AlphaVantageEndpoint;
  lastUpdated?: string;
}

const initialState: AlphaVantageState = {
  symbol: '',
  loading: false,
  error: null,
  currentData: null,
  endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY,
  lastUpdated: undefined
};

export const AlphaVantageStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withProps((store) => ({
    endpoint$: toObservable(store.endpoint),
    symbol$: toObservable(store.symbol),
    currentData$: toObservable(store.currentData),
    loading$: toObservable(store.loading),
  })),
  withMethods((store, dataService = inject(AlphaVantageDataService)) => ({
    /**
     * Sets the current stock symbol and optionally fetches data
     * @param symbol The stock symbol to set
     * @param fetch Whether to fetch data after setting the symbol (default: false)
     */
    setSymbol(symbol: string, fetch = false) {
      patchState(store, { symbol });
      if (fetch) {
        this.fetchData();
      }
    },

    /**
     * Sets the current endpoint
     * @param endpoint The endpoint to set
     */
    setEndpoint(endpoint: AlphaVantageEndpoint) {
      patchState(store, { endpoint });
    },

    /**
     * Fetches data from the currently selected endpoint
     * @param params Additional parameters to pass to the API
     */
    fetchData(params: Omit<FetchAlphaVantageParams, 'symbol'> = {}) {
      console.log('========== aVSto fetchData START ==========');
      const endpoint = store.endpoint();
      const symbol = store.symbol();
      
      console.log('Fetching data for endpoint:', endpoint);
      console.log('Symbol:', symbol);
      console.log('Additional params:', params);
      
      if (!symbol) {
        const errorMsg = 'Cannot fetch data: No symbol provided';
        console.error(errorMsg);
        patchState(store, { 
          error: errorMsg,
          loading: false 
        });
        return;
      }
      
      patchState(store, { 
        loading: true, 
        error: null,
        lastUpdated: new Date().toISOString()
      });
      
      console.log('Calling dataService.fetchData with:', { endpoint, symbol, ...params });
      
      dataService.fetchData(endpoint, { ...params, symbol }).subscribe({
        next: (response) => {
          console.log('aVSto fD Response received:', {
            ok: response.ok,
            hasData: !!response.data,
            timestamp: response.timestamp,
            error: response.error
          });
          
          // Check if response.data exists and is not empty
          if (response.data && Object.keys(response.data).length > 0) {
            patchState(store, { 
              currentData: response.data,
              loading: false,
              lastUpdated: response.timestamp || new Date().toISOString(),
              error: null
            });
          } else {
            // If no data but response is ok, still treat as success but with empty data
            patchState(store, {
              currentData: null,
              loading: false,
              lastUpdated: new Date().toISOString(),
              error: 'No data available for the specified symbol'
            });
          }
        },
        error: (error) => {
          console.error(`aVSto fD Error in subscription for ${endpoint}:`, {
            error: error,
            name: error.name,
            message: error.message,
            status: error.status,
            statusText: error.statusText,
            url: error.url,
            errorDetails: error.error
          });
          
          patchState(store, { 
            loading: false, 
            error: error.error?.message || error.message || 'Failed to fetch data',
            currentData: null
          });
        },
        complete: () => {
          console.log('aVSto fD Request completed for endpoint:', endpoint);
        }
      });
      
      console.log('========== aVSto fetchData END ==========');
    },

    /**
     * Clears the current error state
     */
    clearError() {
      patchState(store, { error: null });
    },

    /**
     * Clears all data and resets to initial state
     */
    reset() {
      patchState(store, {
        ...initialState,
        symbol: store.symbol(),
        endpoint: store.endpoint()
      });
    }
  }))
);
