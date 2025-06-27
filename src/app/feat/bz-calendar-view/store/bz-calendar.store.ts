import { signalStore, withState, withMethods, patchState, withProps, withComputed } from '@ngrx/signals';
import { computed, inject } from '@angular/core';

import { BenzingaEndpoint, BenzingaCalendarParams, BENZINGA_ENDPOINTS_MAP } from '../../../common/common-bz';
import { BenzingaService } from '../../../services/benzinga.service';
import type { BenzingaEndpointItemMap, BenzingaEndpointParamMeta, BenzingaEndpointResponseMap } from '../../../common/common-bz';
import { toObservable } from '@angular/core/rxjs-interop';

/**
 * State for Benzinga calendar UI.
 * - selectedEndpoint: BenzingaEndpoint | null
 * - formValues: Record<string, any>
 * - responseData: any
 * - loading: boolean
 * - error: string | null
 */

export interface BenzingaCalendarState {
    selectedEndpoint: BenzingaEndpoint | null;
    formValues: Record<string, any>;
    loading: boolean;
    error: string | null;
    responses: BenzingaEndpointItemMap;
    pagination: {
        pageIndex: number;
        pageSize: number;
        pageSizeOptions: number[];
    };
}

const initialState: BenzingaCalendarState = {
    selectedEndpoint: BenzingaEndpoint.EARNINGS,
    formValues: {},
    loading: false,
    error: null,
    responses: {
        [BenzingaEndpoint.EARNINGS]: [],
        [BenzingaEndpoint.DIVIDENDS]: [],
        [BenzingaEndpoint.ECONOMICS]: [],
        [BenzingaEndpoint.IPOS]: [],
        [BenzingaEndpoint.CONFERENCE_CALLS]: [],
        [BenzingaEndpoint.FDA]: [],
        [BenzingaEndpoint.MERGERS_ACQUISITIONS]: [],
        [BenzingaEndpoint.RATINGS]: [],
        [BenzingaEndpoint.GUIDANCE]: [],
        [BenzingaEndpoint.SPLITS]: [],
        [BenzingaEndpoint.OFFERINGS]: []
    },
    pagination: {
        pageIndex: 0,
        pageSize: 10,
        pageSizeOptions: [5, 10, 25, 50, 100]
    }
};

/**
 * NgRx Signal Store for Benzinga Calendar feature.
 * Provides signal getter and updater for selectedEndpoint.
 */
export const BenzingaCalendarStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withComputed((store) => ({
        earnings: computed(() => store.responses()[BenzingaEndpoint.EARNINGS] ?? []),
        currentPagination: computed(() => store.pagination),
        pageSizeOptions: computed(() => store.pagination().pageSizeOptions),
        minPageSize: computed(() => Math.min(...store.pagination().pageSizeOptions)),

        /**
         * Returns the endpoint metadata for the currently selected endpoint.
         */
        selectedEndpointMeta: computed(() => {
            const endpoint = store.selectedEndpoint();
            return endpoint ? BENZINGA_ENDPOINTS_MAP[endpoint] : undefined;
        }),

        pagedResults: computed(() => {
            const endpoint = store.selectedEndpoint() ?? BenzingaEndpoint.EARNINGS;
            const all = store.responses()[endpoint] ?? [];
            const { pageIndex, pageSize } = store.pagination();
            const start = pageIndex * pageSize;
            return all.slice(start, start + pageSize);
        }),

        totalItems: computed(() => {
            const endpoint = store.selectedEndpoint() ?? BenzingaEndpoint.EARNINGS;
            return store.responses()[endpoint]?.length ?? 0;
        }),

        noResultsMessage: computed(() => {
            const endpoint = store.selectedEndpoint();
            const ticker = store.formValues()['ticker']?.toUpperCase?.() || '';
            if (!ticker) return '';
            switch (endpoint) {
                case BenzingaEndpoint.EARNINGS:
                    return `No earnings data found for ${ticker}`;
                case BenzingaEndpoint.DIVIDENDS:
                    return `No dividends data found for ${ticker}`;
                default:
                    return '';
            }
        }),

        noResultsCondition: computed(() => {
            const endpoint = store.selectedEndpoint();
            if (store.loading()) return false;
            if (!store.formValues()['ticker']) return false;
            switch (endpoint) {
                case BenzingaEndpoint.EARNINGS:
                    return (store.responses()[BenzingaEndpoint.EARNINGS]?.length ?? 0) === 0;
                case BenzingaEndpoint.DIVIDENDS:
                    return (store.responses()[BenzingaEndpoint.DIVIDENDS]?.length ?? 0) === 0;
                default:
                    return false;
            }
        })
    })),

    withMethods((
        store,
        benzingaService = inject(BenzingaService)
    ) => ({

        setSelectedEndpoint(endpoint: BenzingaEndpoint) {
            console.log('bCSto sE calendar endpoint: ', endpoint);
            patchState(store, {
                selectedEndpoint: endpoint,
                pagination: { ...store.pagination(), pageIndex: 0 }
            });
        },

        setPage(pageIndex: number, pageSize: number) {
            patchState(store, {
                pagination: {
                    ...store.pagination(),
                    pageIndex,
                    pageSize
                }
            });
        },

        searchCalendar(formValues: BenzingaCalendarParams) {
            console.log('bCSto sC calendar formValues: ', formValues);
            const endpoint = formValues.calendarType;
            patchState(store, {
                loading: true,
                error: null,
                formValues: formValues
            });
            // Generic param mapping using endpoint metadata for all endpoints
            let apiParams: BenzingaCalendarParams = formValues;
            const endpointMeta = BENZINGA_ENDPOINTS_MAP[endpoint];
            console.log('bCSto sC calendar endpointMeta: ', endpointMeta);
            if (endpointMeta?.params) {
                // Copy to avoid mutating formValues
                const mapped: Record<string, any> = { ...formValues };
                endpointMeta.params.forEach((meta: BenzingaEndpointParamMeta) => {
                    const formKey = meta.formKey;
                    const apiKey = meta.apiKey;
                    if (formKey in mapped) {
                        mapped[apiKey] = mapped[formKey];
                        delete mapped[formKey];
                    }
                });
                apiParams = mapped as BenzingaCalendarParams;
                console.log('bCSto sC calendar endpoint/params: ', endpoint, apiParams);
            }
            benzingaService.getDynamicCalendar(apiParams).subscribe({
                next: (response: any) => {
                    const { items } = extractCalendarItems(endpoint, response);
                    patchState(store, {
                        loading: false,
                        error: null,
                        responses: {
                            ...store.responses(),
                            [endpoint]: items
                        }
                    });
                    console.log('bCSto sC calendar response: ', response);
                },
                error: (err) => {
                    patchState(store, {
                        error: 'Failed to load calendar data for symbol/endpoint/params: ' + formValues.tickers + '/' + endpoint + '/' + apiParams,
                        loading: false
                    });
                }
            });
        }
    })),

    withProps((store) => ({
        selectedEndpoint$: toObservable(store.selectedEndpoint),
        selectedEndpointMeta$: toObservable(store.selectedEndpointMeta),
        formValues$: toObservable(store.formValues),
        loading$: toObservable(store.loading),
        error$: toObservable(store.error),
        responses$: toObservable(store.responses),
        pagination$: toObservable(store.pagination),
        earnings$: toObservable(store.earnings),
        currentPagination$: toObservable(store.currentPagination),
        pageSizeOptions$: toObservable(store.pageSizeOptions),
        minPageSize$: toObservable(store.minPageSize),
        pagedResults$: toObservable(store.pagedResults),
        totalItems$: toObservable(store.totalItems),
        noResultsMessage$: toObservable(store.noResultsMessage),
        noResultsCondition$: toObservable(store.noResultsCondition)
    }))
);

/**
 * Helper to extract the correct items array from any Benzinga endpoint response.
 * Extend this switch as more endpoints are implemented.
 */
function extractCalendarItems<E extends BenzingaEndpoint>(
  endpoint: E,
  response: BenzingaEndpointResponseMap[E]
): { items: any[] } {
  switch (endpoint) {
    case BenzingaEndpoint.EARNINGS:
      return { items: response.earnings ?? [] };
    case BenzingaEndpoint.DIVIDENDS:
      return { items: response.dividends ?? [] };
    // ...add more endpoints as you implement them
    default:
      return { items: [] };
  }
}
