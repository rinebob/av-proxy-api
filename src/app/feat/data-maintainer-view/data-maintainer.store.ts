import { signalStore, withState, patchState, withMethods, withProps } from '@ngrx/signals';
import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { AvCompanyOverviewResponse } from './common/fe-common-dm-api';
import { DataMaintainerDataService } from './data-maintainer-data.service';

import { DataMaintainerEndpoint } from './common/fe-common-dm';

import type { DataMaintainerResultsMap } from './common/fe-common-dm';

export interface DataMaintainerState {
    symbol: string;
    loading: boolean;
    error: string | null;
    results: DataMaintainerResultsMap;
    endpoint: DataMaintainerEndpoint;
    useMock: boolean;
    mockDataAvailable: boolean;
    awaitingUserDecision: boolean;
}

const initialState: DataMaintainerState = {
    symbol: 'NVDA',
    loading: false,
    error: null,
    results: {
        [DataMaintainerEndpoint.COMPANY_OVERVIEW]: null,
        // Add initial values for other endpoints as needed
    },
    endpoint: DataMaintainerEndpoint.COMPANY_OVERVIEW,
    useMock: true, // Default to using mock data
    mockDataAvailable: true, // Will be updated based on symbol
    awaitingUserDecision: false, // True when waiting for user to confirm real API call
};

export const DataMaintainerStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withProps((store) => ({
        endpoint$: toObservable(store.endpoint),
        results$: toObservable(store.results),
        useMock$: toObservable(store.useMock),
        awaitingUserDecision$: toObservable(store.awaitingUserDecision),
    })),
    withMethods((
        store,
        dataService = inject(DataMaintainerDataService)
    ) => ({

        setSymbol(symbol: string) {
            // Check if we have mock data for this symbol
            const mockDataAvailable = symbol === 'NVDA'; // For now, only NVDA has mock data
            patchState(store, { 
                symbol,
                mockDataAvailable,
                // Reset user decision state when symbol changes
                awaitingUserDecision: false 
            });
        },

        setEndpoint(endpoint: DataMaintainerEndpoint) {
            patchState(store, { endpoint });
        },

        toggleUseMock() {
            patchState(store, { useMock: !store.useMock() });
        },

        async fetchCompanyOverview() {
            const { symbol, useMock, mockDataAvailable } = store;
            
            // If using mock data but it's not available, set awaiting decision and return
            if (useMock() && !mockDataAvailable()) {
                patchState(store, { awaitingUserDecision: true });
                return;
            }

            // Proceed with the fetch
            patchState(store, {
                loading: true,
                error: null,
            });

            dataService
                .fetchCompanyOverview(symbol(), useMock())
                .subscribe({
                    next: (response) => {
                        patchState(store, {
                            results: {
                                ...store.results(),
                                [DataMaintainerEndpoint.COMPANY_OVERVIEW]: response,
                            },
                            loading: false,
                            // Reset decision state after successful fetch
                            awaitingUserDecision: false
                        });
                    },
                    error: (error) => {
                        patchState(store, {
                            error: error.message,
                            loading: false,
                            // Reset decision state on error
                            awaitingUserDecision: false
                        });
                    },
                });
        },
        
        // Call this when user approves using real API
        confirmUseRealData() {
            patchState(store, {
                useMock: false,
                awaitingUserDecision: false
            });
            // Retry the fetch with real data
            this.fetchCompanyOverview();
        },
        
        // Call this when user cancels the operation
        cancelRealDataRequest() {
            patchState(store, {
                awaitingUserDecision: false,
                loading: false
            });
        },
    })),


);

