import { signalStore, withState, withMethods, patchState, withComputed } from '@ngrx/signals';
import { computed, inject } from '@angular/core';

import { BenzingaEndpoint, BenzingaCalendarParams } from '../../../common/common-bz';
import { BenzingaService } from '../../../services/benzinga.service';
import type { BenzingaEndpointItemMap, BenzingaEndpointResponseMap } from '../../../common/common-bz';

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
                // case BenzingaEndpoint.DIVIDENDS:
                //     return `No dividends data found for ${ticker}`;
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
                // case BenzingaEndpoint.DIVIDENDS:
                //     return (store.responses()[BenzingaEndpoint.DIVIDENDS]?.length ?? 0) === 0;
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
            const endpoint = formValues.calendarType;
            patchState(store, {
                loading: true,
                error: null,
                formValues: formValues
            });
            benzingaService.getDynamicCalendar(formValues).subscribe({
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
                },
                error: (err) => {
                    patchState(store, {
                        error: 'Failed to load calendar data. Please try again.',
                        loading: false
                    });
                }
            });
        }
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
    // case BenzingaEndpoint.DIVIDENDS:
    //   return { items: response.dividends ?? [] };
    // ...add more endpoints as you implement them
    default:
      return { items: [] };
  }
}
