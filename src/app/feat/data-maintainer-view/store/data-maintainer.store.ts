import { signalStore, withState, patchState, withMethods, withProps } from '@ngrx/signals';
import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { DataMaintainerDataService } from '../services/data-maintainer-data.service';
import { AlphaVantageEndpoint } from '../../../common/fe-common-av';
import { debounceTime } from 'rxjs/operators';
import type { DataMaintainerResultsMap } from '../common/fe-common-dm';

export interface DataSourceInfo {
    type: 'mock' | 'alpha_vantage';
    timestamp: string;
}

export interface DataMaintainerState {
    symbol: string;
    loading: boolean;
    error: string | null;
    results: DataMaintainerResultsMap;
    dataSourceInfo: Record<AlphaVantageEndpoint, DataSourceInfo | null>;
    endpoint: AlphaVantageEndpoint;
    useMock: boolean;
    mockDataAvailable: boolean;
    awaitingUserDecision: boolean;
}

const initialState: DataMaintainerState = {
    symbol: 'NVDA',
    loading: false,
    error: null,
    results: {
        [AlphaVantageEndpoint.OVERVIEW]: null,
        [AlphaVantageEndpoint.BALANCE_SHEET]: null,
        [AlphaVantageEndpoint.INCOME_STATEMENT]: null,
        [AlphaVantageEndpoint.CASH_FLOW]: null,
        [AlphaVantageEndpoint.EARNINGS]: null,
        [AlphaVantageEndpoint.SYMBOL_SEARCH]: null,
        [AlphaVantageEndpoint.TIME_SERIES_DAILY]: null,
        [AlphaVantageEndpoint.GLOBAL_QUOTE]: null,
    },
    dataSourceInfo: {
        [AlphaVantageEndpoint.OVERVIEW]: null,
        [AlphaVantageEndpoint.BALANCE_SHEET]: null,
        [AlphaVantageEndpoint.INCOME_STATEMENT]: null,
        [AlphaVantageEndpoint.CASH_FLOW]: null,
        [AlphaVantageEndpoint.EARNINGS]: null,
        [AlphaVantageEndpoint.SYMBOL_SEARCH]: null,
        [AlphaVantageEndpoint.TIME_SERIES_DAILY]: null,
        [AlphaVantageEndpoint.GLOBAL_QUOTE]: null,
    } as Record<AlphaVantageEndpoint, DataSourceInfo | null>,
    endpoint: AlphaVantageEndpoint.OVERVIEW,
    useMock: true,
    mockDataAvailable: true,
    awaitingUserDecision: false,
};

// NOTE THIS IS DEPRECATED IN FAVOR OF ALPHA-VANTAGE-DATA.STORE.TS
export const DataMaintainerStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withProps((store) => ({
        endpoint$: toObservable(store.endpoint),
        results$: toObservable(store.results),
        useMock$: toObservable(store.useMock),
        awaitingUserDecision$: toObservable(store.awaitingUserDecision),
    })),
    withMethods((store, dataService = inject(DataMaintainerDataService)) => ({
        setSymbol(symbol: string) {
            // Update symbol immediately
            patchState(store, { 
                symbol,
                // Reset user decision state when symbol changes
                awaitingUserDecision: false 
            });
            
            // Debounce the mock data check
            dataService.checkMockData(symbol.trim(), store.endpoint())
                .pipe(debounceTime(300))
                .subscribe({
                    next: (response) => {
                        console.log(`DMV sS Mock data available for ${symbol}:`, response.hasMockData);
                        patchState(store, {
                            mockDataAvailable: response.hasMockData
                        });
                        
                        // If using mock data but none is available, ask user what to do
                        if (store.useMock() && !response.hasMockData) {
                            patchState(store, { awaitingUserDecision: true });
                        }
                    },
                    error: (error) => {
                        console.error('DMV sS Error checking mock data:', error);
                        patchState(store, { mockDataAvailable: false });
                    }
                });
        },

        setEndpoint(endpoint: AlphaVantageEndpoint) {
            patchState(store, { endpoint });
            
            // When endpoint changes, recheck mock data availability for current symbol
            if (store.symbol()) {
                dataService.checkMockData(store.symbol(), endpoint).subscribe({
                    next: (response) => {
                        console.log(`DMV sE Mock data available for ${store.symbol()} on ${endpoint}:`, response.hasMockData);
                        patchState(store, {
                            mockDataAvailable: response.hasMockData
                        });
                        
                        // If using mock data but none is available, ask user what to do
                        if (store.useMock() && !response.hasMockData) {
                            patchState(store, { awaitingUserDecision: true });
                        }
                    },
                    error: (error) => {
                        console.error('DMV sE Error checking mock data:', error);
                        // On error, assume no mock data is available
                        patchState(store, { mockDataAvailable: false });
                    }
                });
            }
        },

        toggleUseMock() {
            patchState(store, { useMock: !store.useMock() });
        },

        async fetchCompanyOverview() {
            patchState(store, { loading: true, error: null });
            
            const symbol = store.symbol();
            const endpoint = store.endpoint();
            const useMock = store.useMock();
            
            // If no symbol is provided, don't proceed
            if (!symbol) {
                console.error('DMV fCO No symbol provided');
                patchState(store, { 
                    error: 'Please enter a symbol',
                    loading: false 
                });
                return;
            }

            // If using mock data but none is available, set the flag and return early
            if (useMock && !store.mockDataAvailable()) {
                patchState(store, { 
                    loading: false, 
                    awaitingUserDecision: true 
                });
                return;
            }
            
            try {
                const response = await dataService.fetchCompanyOverview(symbol, useMock).toPromise();
                if (!response) {
                    throw new Error('No response from server');
                }

                // For mock data, the response includes both metadata and data
                // For real API calls, the data is in response.data
                const responseData = useMock ? response : response.data;
                
                const dataSourceInfo: DataSourceInfo = {
                    type: useMock ? 'mock' : 'alpha_vantage',
                    timestamp: response.timestamp || new Date().toISOString()
                };
                
                patchState(store, {
                    results: {
                        ...store.results(),
                        [endpoint]: responseData
                    },
                    dataSourceInfo: {
                        ...store.dataSourceInfo(),
                        [endpoint]: dataSourceInfo
                    },
                    loading: false,
                    awaitingUserDecision: false
                });
            } catch (error: any) {
                console.error('Error fetching company overview:', error);
                patchState(store, { 
                    error: error?.message || 'Failed to fetch data',
                    loading: false,
                    awaitingUserDecision: false
                });
            }
        },
        
        // Call this when user approves using real API
        confirmUseRealData() {
            console.log('DMV cURD User confirmed to use real data');
            patchState(store, {
                useMock: false,  // Switch to real data
                awaitingUserDecision: false,
                loading: true
            });
            
            // Retry the fetch with real data
            this.fetchCompanyOverview().catch(error => {
                console.error('DMV cURD Error fetching real data:', error);
                patchState(store, {
                    error: error.message || 'Failed to fetch real data',
                    loading: false
                });
            });
        },
        
        // Call this when user cancels the operation
        cancelRealDataRequest() {
            console.log('DMV cRDQ User cancelled real data request');
            patchState(store, {
                awaitingUserDecision: false,
                loading: false,
                // Optionally clear any previous error
                error: null
            });
        },
    })),
);
