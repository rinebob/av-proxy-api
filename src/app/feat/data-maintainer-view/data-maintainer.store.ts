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
};

export const DataMaintainerStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withProps((store) => ({
        endpoint$: toObservable(store.endpoint),
        results$: toObservable(store.results),
        useMock$: toObservable(store.useMock),
    })),
    withMethods((
        store,
        dataService = inject(DataMaintainerDataService)
    ) => ({

        setSymbol(symbol: string) {
            patchState(store, { symbol });
        },

        setEndpoint(endpoint: DataMaintainerEndpoint) {
            patchState(store, { endpoint });
        },

        toggleUseMock() {
            patchState(store, { useMock: !store.useMock() });
        },

        fetchCompanyOverview() {
            patchState(store, {
                loading: true,
                error: null,
            });

            dataService
                .fetchCompanyOverview(store.symbol(), store.useMock())
                .subscribe({
                    next: (response) => {
                        patchState(store, {
                            results: {
                                ...store.results(),
                                [DataMaintainerEndpoint.COMPANY_OVERVIEW]: response,
                            },
                            loading: false,
                        });
                    },
                    error: (error) => {
                        patchState(store, {
                            error: error.message,
                            loading: false,
                        });
                    },
                });
        },
    })),


);


