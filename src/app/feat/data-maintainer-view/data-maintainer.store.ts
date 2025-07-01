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
};

export const DataMaintainerStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withProps((store) => ({
        endpoint$: toObservable(store.endpoint),
        results$: toObservable(store.results),
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

        fetchCompanyOverview() {
            patchState(store, {
                loading: true,
                error: null,
                results: {
                    ...store.results(),
                    [DataMaintainerEndpoint.COMPANY_OVERVIEW]: null
                }
            });

            dataService.fetchCompanyOverview(store.symbol()).subscribe({
                next: (data: AvCompanyOverviewResponse) => {
                    patchState(store, {
                        results: {
                            ...store.results(),
                            [DataMaintainerEndpoint.COMPANY_OVERVIEW]: data
                        }
                    });
                },
                error: (err: any) => {
                    patchState(store, { error: err?.message || 'Request failed' });
                },
                complete: () => {
                    patchState(store, { loading: false });
                },
            });
        },
    })),


);


