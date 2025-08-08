import { signalStore, withState, withMethods, patchState, withProps, withComputed } from '@ngrx/signals';
import { computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { BzCalendarRequestType } from '@shared/benzinga';

import { BenzingaApiService } from '../services/benzinga-api.service';
import type { BenzingaCalendarParams, BenzingaEndpointItemMap, BZCalendarResponseMap } from '../../../common/fe-common-bz';
import { BENZINGA_ENDPOINTS_META_MAP } from '../../../common/fe-common-bz';


export interface BenzingaCalendarState {
    selectedEndpoint: BzCalendarRequestType | null;
    formValues: Record<string, any>;
    loading: boolean;
    error: string | null;
    responses: BenzingaEndpointItemMap;
    pagination: {
        pageIndex: number;
        pageSize: number;
        pageSizeOptions: number[];
    };
    hasSearched: boolean;
}

const initialState: BenzingaCalendarState = {
    selectedEndpoint: BzCalendarRequestType.EARNINGS,
    formValues: {},
    loading: false,
    error: null,
    responses: {
        [BzCalendarRequestType.EARNINGS]: [],
        [BzCalendarRequestType.DIVIDENDS]: [],
        [BzCalendarRequestType.ECONOMICS]: [],
        [BzCalendarRequestType.IPOS]: [],
        [BzCalendarRequestType.CONFERENCE_CALLS]: [],
        [BzCalendarRequestType.MERGERS_ACQUISITIONS]: [],
        [BzCalendarRequestType.RATINGS]: [],
        [BzCalendarRequestType.GUIDANCE]: [],
        [BzCalendarRequestType.SPLITS]: [],
        [BzCalendarRequestType.OFFERINGS]: [],
    },
    pagination: {
        pageIndex: 0,
        pageSize: 2, // Default to 2 records per page
        pageSizeOptions: [2, 5, 10, 25, 50, 100]
    },
    hasSearched: false
};

/**
 * NgRx Signal Store for Benzinga Calendar feature.
 * Provides signal getter and updater for selectedEndpoint.
 */
export const BenzingaCalendarStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withComputed((store) => ({
        earnings: computed(() => store.responses()[BzCalendarRequestType.EARNINGS] ?? []),
        currentPagination: computed(() => store.pagination()),
        pageSizeOptions: computed(() => store.pagination().pageSizeOptions),
        minPageSize: computed(() => Math.min(...store.pagination().pageSizeOptions)),
        
        /**
         * Returns the endpoint metadata for the currently selected endpoint.
         */
        selectedEndpointMeta: computed(() => {
            const endpoint = store.selectedEndpoint();
            return endpoint ? BENZINGA_ENDPOINTS_META_MAP[endpoint] : undefined;
        }),

        // Total items for the current endpoint
        totalItems: computed(() => {
            const endpoint = store.selectedEndpoint() ?? BzCalendarRequestType.EARNINGS;
            const allResponses = store.responses();
            return (allResponses[endpoint] ?? []).length;
        }),

        // Paginated results for the current endpoint
        pagedResults: computed(() => {
            const endpoint = store.selectedEndpoint() ?? BzCalendarRequestType.EARNINGS;
            const allResponses = store.responses();
            console.log('bCSto pagedResults - all responses:', allResponses);
            
            const all = allResponses[endpoint] ?? [];
            console.log(`bCSto pagedResults - data for ${endpoint}:`, all);
            
            const { pageIndex, pageSize } = store.pagination();
            const start = pageIndex * pageSize;

            const results = all.slice(start, start + pageSize);
            console.log('bCSto pagedResults computed:', {
                endpoint,
                allResponsesKeys: Object.keys(allResponses),
                hasEndpointData: endpoint in allResponses,
                totalItems: all.length,
                pageIndex,
                pageSize,
                start,
                resultsCount: results.length,
                hasResults: results.length > 0,
                sampleResult: results[0],
                allColumnKeys: results[0] ? Object.keys(results[0]) : 'no results'
            });
            return all.slice(start, start + pageSize);
        }),

        // Pagination display properties
        currentPageStart: computed(() => {
            const { pageIndex, pageSize } = store.pagination();
            return (pageIndex * pageSize) + 1;
        }),

        currentPageEnd: computed(() => {
            const { pageIndex, pageSize } = store.pagination();
            const total = (store as any).totalItems();
            return Math.min((pageIndex + 1) * pageSize, total);
        }),

        // Helper for no results message
        noResultsMessage: computed(() => {
            if (!store.hasSearched()) {
                return 'Enter required fields and click search to get data.';
            }
            const endpoint = store.selectedEndpoint();
            const ticker = store.formValues()['ticker']?.toUpperCase?.() || '';
            
            if (ticker) {
                return `No ${endpoint?.toLowerCase() ?? 'results'} found for the selected criteria.`;
            }
            
            return endpoint 
                ? `No ${endpoint.toLowerCase()} found for the selected criteria.` 
                : 'No data available.';
        }),

        // Condition to show no results message
        noResultsCondition: computed(() => {
            if (store.loading()) return false;
            if (!store.hasSearched()) return true;
            const endpoint = store.selectedEndpoint() ?? BzCalendarRequestType.EARNINGS;
            const responses = store.responses();
            const endpointData = responses[endpoint] ?? [];
            return endpointData.length === 0;
        })
    })),

    withMethods((
        store,
        benzingaApi = inject(BenzingaApiService)
    ) => ({
        markSearched() {
            patchState(store, { hasSearched: true });
        },

        setSelectedEndpoint(endpoint: BzCalendarRequestType) {
            console.log('bCSto sE calendar endpoint: ', endpoint);
            patchState(store, {
                selectedEndpoint: endpoint,
                pagination: { ...store.pagination(), pageIndex: 0 },
                error: null, // Clear any previous error when endpoint changes
                hasSearched: false // Reset search state on endpoint change
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
            patchState(store, { loading: true, error: null, hasSearched: true, formValues });

            // The endpoint is determined by the 'type' property in the formValues
            const endpoint = formValues.type;
            if (!endpoint) {
                patchState(store, { error: 'No endpoint type specified in form submission.', loading: false });
                return;
            }

            // Ensure type is never undefined and always matches the endpoint
            const apiParams: BenzingaCalendarParams = { ...formValues, type: endpoint };

            console.log('bCSto sC calendar calling benzingaApi.fetchData with:', { endpoint, apiParams });

            benzingaApi.fetchData(apiParams).subscribe({
                next: (response: any) => {
                    console.log('bCSto sC calendar received response:', response);

                    const { items } = extractCalendarItems(endpoint, response);

                    console.log('bCSto sC calendar extracted items:', { 
                        endpoint, 
                        responseKey: endpoint,
                        itemCount: items.length, 
                        items,
                        sampleItem: items[0],
                        responseKeys: items[0] ? Object.keys(items[0]) : 'no items',
                        isArrayResponse: Array.isArray(response)
                    });

                    if (!items) {
                        console.warn('No items found in response for endpoint:', endpoint);
                    }
                    
                    const currentResponses = store.responses();
                    const updatedResponses = {
                        ...currentResponses,
                        [endpoint]: items
                    };
                    
                    console.log('bCSto sC calendar updating store with responses:', {
                        currentResponseKeys: Object.keys(currentResponses),
                        newResponseKeys: Object.keys(updatedResponses),
                        newEndpointData: items
                    });
                    
                    patchState(store, {
                        loading: false,
                        error: null,
                        responses: updatedResponses
                    });
                    
                    console.log('bCSto sC calendar updated store state:', { 
                        allResponseKeys: Object.keys(store.responses()),
                        currentEndpointData: store.responses()[endpoint],
                        pagedResults: store.pagedResults(),
                        pagedResultsLength: store.pagedResults().length,
                        hasPagedResults: store.pagedResults().length > 0
                    });
                },
                error: (err: Error) => {
                    console.error('Error fetching calendar data:', err);
                    patchState(store, {
                        error: `Failed to load calendar data. Details: ${err.message}`,
                        loading: false
                    });
                }
            });
        },
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
 * Helper to extract the items array from any Benzinga endpoint response.
 * Uses the responseKey from endpoint metadata if defined, otherwise falls back to the endpoint name.
 */
function extractCalendarItems<E extends BzCalendarRequestType>(
  endpoint: E,
  response: BZCalendarResponseMap[E]
): { items: any[] } {
  // Get the endpoint metadata to check for a custom responseKey
  const endpointMeta = BENZINGA_ENDPOINTS_META_MAP[endpoint];
  
  // Use the responseKey from metadata if defined, otherwise use the endpoint name
  const responseKey = endpointMeta?.responseKey || endpoint.toLowerCase();
  
  // Get the items using the determined response key
  const items = (response as any)[responseKey];
  
  console.log('bCSto sC calendar extractCalendarItems:', {
    endpoint,
    responseKey,
    hasResponseKey: !!endpointMeta?.responseKey,
    items: Array.isArray(items) ? items.length : items
  });
  
  return { items: Array.isArray(items) ? items : [] };
}
