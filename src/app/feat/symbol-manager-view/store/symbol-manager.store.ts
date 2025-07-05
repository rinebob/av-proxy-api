import { inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState, withProps } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { SymbolManagerService } from '../services/symbol-manager.service';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, map, tap, catchError, of, pipe, switchMap } from 'rxjs';
import { tapResponse } from '@ngrx/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SyncSymbolsRequest, SyncSymbolsResponse, TrackedSymbol, ListSymbolsResponse, SymbolDetailsResponse } from '../../../feat/data-maintainer-view/common/fe-common-dm-api';

export type ActiveTab = 'list' | 'add' | 'sync' | 'details';

interface SymbolManagerState {
  activeTab: ActiveTab;
  loading: boolean;
  error: string | null;
  symbols: TrackedSymbol[];
  symbolDetails: TrackedSymbol | null;
  syncResults: SyncSymbolsResponse | null;
  clientId: string;
  clientName: string;
  newSymbol: string;
  symbolsToSync: string;
}

const initialState: SymbolManagerState = {
  activeTab: 'list',
  loading: false,
  error: null,
  symbols: [],
  symbolDetails: null,
  syncResults: null,
  clientId: 'web-client',
  clientName: 'Web Client',
  newSymbol: '',
  symbolsToSync: ''
};

export const SymbolManagerStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withProps(store => ({
    symbols$: toObservable(store.symbols),
    syncResults$: toObservable(store.syncResults),
  })),
  withMethods((store, symbolService = inject(SymbolManagerService), snackBar = inject(MatSnackBar)) => ({
    // Clear sync results and reset related state
    clearSyncResults() {
      patchState(store, { 
        syncResults: null,
        error: null,
        loading: false
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
        map(() => {})
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
  }))
);
