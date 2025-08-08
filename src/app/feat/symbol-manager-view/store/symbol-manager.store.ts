import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, map, tap, of, pipe, switchMap, catchError } from 'rxjs';
import { tapResponse } from '@ngrx/operators';
import { signalStore, withState, withMethods, patchState, withProps } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';

import { TrackedSymbolV2 } from '@shared/alpha-vantage';

import { SymbolManagerService } from '../services/symbol-manager.service';
// TODO: Remove support for legacy TrackedSymbol
import { SyncSymbolsResponse, TrackedSymbol, } from '../../../feat/data-maintainer-view/common/fe-common-dm-api';

export type ActiveTab = 'list' | 'add' | 'sync' | 'details';

interface SymbolManagerState {
    activeTab: ActiveTab;
    loading: boolean;
    error: string | null;
    symbols: TrackedSymbol[];
    symbolDetails: TrackedSymbol | null;
    syncResults: SyncSymbolsResponse | null;
    searchResults: TrackedSymbol[] | undefined;
    clientId: string;
    clientName: string;
    newSymbol: string;
    symbolsToSync: string;
    symbolSelected: boolean;

    v2SearchResults: TrackedSymbolV2[] | undefined;
    v2Symbols: TrackedSymbolV2[];
}

const initialState: SymbolManagerState = {
    activeTab: 'list',
    loading: false,
    error: null,
    symbols: [],
    symbolDetails: null,
    syncResults: null,
    searchResults: undefined,
    clientId: 'web-client',
    clientName: 'Web Client',
    newSymbol: '',
    symbolsToSync: '',
    symbolSelected: false,

    v2SearchResults: undefined,
    v2Symbols: [],
};

export const SymbolManagerStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withProps(store => ({
        symbols$: toObservable(store.symbols),
        syncResults$: toObservable(store.syncResults),
        searchResults$: toObservable(store.searchResults),
        symbolSelected$: toObservable(store.symbolSelected),

        v2SearchResults$: toObservable(store.v2SearchResults),
        v2Symbols$: toObservable(store.v2Symbols),
    })),
    withMethods((store, symbolService = inject(SymbolManagerService), snackBar = inject(MatSnackBar)) => ({
        // Clear sync results and reset related state
        clearSyncResults() {
            patchState(store, {
                syncResults: null,
                error: null,
                loading: false,

                v2SearchResults: undefined,
            });
        },
        // Update methods
        updateNewSymbol(value: string) {
            patchState(store, { newSymbol: value });
        },

        updateSymbolsToSync(value: string) {
            patchState(store, { symbolsToSync: value });
        },

        setActiveTab(tab: ActiveTab) {
            patchState(store, { activeTab: tab });
        },

        clearError() {
            patchState(store, { error: null });
        },

        listSymbols(): void {
            patchState(store, { loading: true, error: null });

            symbolService.listSymbols().pipe(
                tap({
                    next: (response) => {
                        patchState(store, {
                            loading: false,
                            symbols: response.symbols || []
                        });
                    },
                    error: (error) => {
                        console.error('Error listing symbols:', error);
                        patchState(store, {
                            loading: false,
                            error: error.message || 'Failed to load symbols'
                        });
                    }
                }),
            ).subscribe();
        },

        getSymbolDetails: rxMethod<string>(
            pipe(
                tap(() => patchState(store, { loading: true, error: null })),
                switchMap((symbol: string) =>
                    symbolService.getSymbolDetails(symbol).pipe(
                        tapResponse({
                            next: (response) => {
                                patchState(store, {
                                    symbolDetails: response.data,
                                    loading: false
                                });
                            },
                            error: (error: Error) => {
                                console.error(`Error getting details for ${symbol}:`, error);
                                patchState(store, {
                                    loading: false,
                                    error: error.message || `Failed to get details for ${symbol}`
                                });
                            }
                        })
                    )
                )
            )
        ),

        // LEGACY - USED WITH SYNC SYMBOLS ENDPOINT
        // Add one or more symbols
        addSymbols(symbols: string[]): Observable<void> {
            console.log('sMSto aS addSymbols called with symbols:', symbols);

            if (!symbols || symbols.length === 0) {
                console.warn('sMSto aS No symbols provided to addSymbols');
                patchState(store, {
                    error: 'No symbols provided',
                    loading: false
                });
                return of(undefined);
            }

            console.log('sMSto aS Setting loading state and clearing errors');
            patchState(store, {
                loading: true,
                error: null,
                syncResults: null
            });

            console.log('sMSto aS Calling symbolService.addSymbols');
            return symbolService.addSymbols(symbols).pipe(
                tap({
                    next: (response: SyncSymbolsResponse) => {
                        console.log('sMSto aS Received response from symbolService.addSymbols:', response);

                        patchState(store, {
                            loading: false,
                            syncResults: response,
                            error: response.success ? null : (response.error || response.message || 'Failed to add symbols')
                        });

                        if (response.success) {
                            const successMessage = response.message || (symbols.length > 1
                                ? `Successfully added ${response.added || symbols.length} symbols`
                                : `Successfully added ${symbols[0]}`);

                            console.log('sMSto aS Showing success message:', successMessage);
                            snackBar.open(successMessage, 'Close', { duration: 3000 });

                            console.log('sMSto aS Refreshing symbols list');
                            this.listSymbols();
                        } else {
                            const errorMessage = response.error && typeof response.error === 'string'
                                ? response.error
                                : response.message || 'Failed to add symbols';

                            console.error('sMSto aS Error in response:', errorMessage);
                            snackBar.open(errorMessage, 'Close', {
                                duration: 5000,
                                panelClass: 'error-snackbar'
                            });
                        }
                    },
                    error: (error) => {
                        console.error('sMSto aS Error in addSymbols:', error);
                        const errorMessage = error.message || 'Failed to add symbols';
                        patchState(store, {
                            loading: false,
                            error: errorMessage
                        });
                        snackBar.open(errorMessage, 'Close', { duration: 5000 });
                    },
                    complete: () => console.log('sMSto aS addSymbols observable completed')
                }),
                // Map to void since we're handling everything in tap
                map(() => { })
            );
        },

        /**
         * Remove a symbol from tracking
         * @param symbol The symbol to remove
         * @returns Observable that completes when the operation is done
         */
        removeSymbol(symbol: string): Observable<void> {
            if (!symbol) {
                return of(undefined);
            }

            patchState(store, { loading: true, error: null });

            const currentSymbols = store.symbols();
            const currentSymbolDetails = store.symbolDetails();

            return symbolService.removeSymbol(symbol).pipe(
                tap({
                    next: (response) => {
                        if (response.success) {
                            // Update the UI state
                            patchState(store, {
                                loading: false,
                                symbolDetails: null,
                                // Remove the symbol from the local state if it exists
                                symbols: currentSymbols.filter(s => s.symbol !== symbol)
                            });

                            // Show success message
                            snackBar.open(
                                `Successfully removed ${symbol}`,
                                'Close',
                                { duration: 3000 }
                            );

                            // If we're on the details page for this symbol, go back to the list
                            if (currentSymbolDetails?.symbol === symbol) {
                                this.setActiveTab('list');
                            }
                        } else {
                            // Handle error case
                            patchState(store, {
                                loading: false,
                                error: response.error || 'Failed to remove symbol'
                            });

                            snackBar.open(
                                response.error || 'Failed to remove symbol',
                                'Close',
                                { duration: 5000, panelClass: 'error-snackbar' }
                            );
                        }
                    },
                    error: (error) => {
                        console.error('Error removing symbol:', error);
                        patchState(store, {
                            loading: false,
                            error: error.message || 'Failed to remove symbol'
                        });

                        snackBar.open(
                            error.message || 'Failed to remove symbol',
                            'Close',
                            { duration: 5000, panelClass: 'error-snackbar' }
                        );
                    }
                }),
                // Return void to match the expected return type
                map(() => undefined)
            );
        },

        

        // DEPRECATED - USES DEPRECATED SYMBOL SEARCH ENDPOINT
        /**
         * Search for symbols using keywords
         * @param keywords The search keywords (e.g., 'microsoft')
         * @returns Observable with the search results
         */
        searchSymbols(keywords: string): void {
            if (!keywords?.trim()) {
                return;
            }
            console.log('sMSto sS searchSymbols called with keywords:', keywords);

            patchState(store, { loading: true, error: null, searchResults: undefined });

            symbolService.searchSymbols(keywords).pipe(
                tapResponse(
                    (response: TrackedSymbol[]) => {
                        console.log('sMSto sS Search results:', response);
                        patchState(store, {
                            loading: false,
                            searchResults: response,
                            v2SearchResults: response as TrackedSymbolV2[],
                        });
                    },
                    (error: unknown) => {
                        console.error('sMSto sS Error searching symbols:', error);
                        const errorMessage = error instanceof Error ? error.message : 'Failed to search symbols';
                        patchState(store, {
                            loading: false,
                            error: errorMessage,
                            searchResults: [],
                            v2SearchResults: [],
                        });
                        snackBar.open(errorMessage, 'Close', {
                            duration: 5000,
                            panelClass: 'error-snackbar'
                        });
                    }
                )
            ).subscribe();
        },

        //////////////// V2 IMPLEMENTATION //////////////////////////


        /**
         * Calls the new SYMBOL_SEARCH Alpha Vantage V2 service method and patches the store with results.
         * Does not modify or interfere with existing symbol search logic.
         * @param keywords The search keywords (e.g., 'microsoft')
         */
        searchSymbolsV2(keywords: string): void {
            if (!keywords?.trim()) {
                return;
            }
            console.log('sMSto sSV2 searchSymbolsV2 called with keywords:', keywords);

            patchState(store, { loading: true, error: null, v2SearchResults: undefined });

            symbolService.searchSymbolsV2(keywords).subscribe({
                next: (response) => {
                    const results = Array.isArray(response)
                        ? response
                        : Array.isArray((response as any)?.data)
                            ? (response as any).data
                            : [];
                    patchState(store, {
                        loading: false,
                        v2SearchResults: results,
                    });
                },
                error: (error) => {
                    console.error('sMSto sSV2 Error searching symbols (V2):', error);
                    const errorMessage = error instanceof Error ? error.message : 'Failed to search symbols (V2)';
                    patchState(store, {
                        loading: false,
                        v2SearchResults: [],
                    });
                }
            });
        },

        addSymbolFromSearch(symbol: TrackedSymbol) {
            patchState(store, { loading: true, error: null });

            // Adapt TrackedSymbol to SaveTrackedSymbolRequest if needed
            // (Assuming TrackedSymbol has all the fields required)
            symbolService.saveTrackedSymbol(symbol).pipe(
                tap((response) => {
                    if (response.success) {
                        patchState(store, {
                            loading: false,
                            symbolSelected: true,
                            searchResults: undefined,
                            v2SearchResults: undefined
                        });
                        snackBar.open(`Symbol "${symbol.symbol}" added!`, 'Close', { duration: 3000, panelClass: 'success-snackbar' });
                        // Optionally refresh symbols list here
                    } else {
                        patchState(store, { loading: false, error: response.error || 'Failed to add symbol' });
                        snackBar.open(response.error || 'Failed to add symbol', 'Close', { duration: 5000, panelClass: 'error-snackbar' });
                    }
                }),
                catchError((error) => {
                    const errorMessage = error instanceof Error ? error.message : 'Failed to add symbol';
                    patchState(store, { loading: false, error: errorMessage });
                    snackBar.open(errorMessage, 'Close', { duration: 5000, panelClass: 'error-snackbar' });
                    return of(null);
                })
            ).subscribe();
        },

        listSymbolsV2(): void {
            patchState(store, { loading: true, error: null });
            console.log('sMSto lSV2 listSymbolsV2 called');
            symbolService.listSymbolsV2().pipe(
                tap({
                    next: (response) => {
                        patchState(store, {
                            loading: false,
                            v2Symbols: response.symbols || []
                        });
                    },
                    error: (error) => {
                        console.error('Error listing symbols:', error);
                        patchState(store, {
                            loading: false,
                            error: error.message || 'Failed to load symbols'
                        });
                    }
                }),
            ).subscribe();
        },

        /**
         * Updated by SymbolDialog component to support dialog open/closed state
         * @param symbolSelected setting to true will close the dialog; the dialog 
         * will update this to false when it is closed
         */
        setSymbolSelected(symbolSelected: boolean) {
            patchState(store, { symbolSelected })
        }
    }))
);
