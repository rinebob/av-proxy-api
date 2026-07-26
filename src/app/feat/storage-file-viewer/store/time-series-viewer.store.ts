import { signalStore, withState, withMethods, withHooks, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of, forkJoin, defer } from 'rxjs';
import { inject, computed } from '@angular/core';
import { Firestore, collection, query, getDocs, doc } from '@angular/fire/firestore';

import { StorageViewerApiService } from '../common/storage-viewer-api';
import type {
  ContractResult,
  ListResult,
  ReadResult,
  ListTimeSeriesRequest,
  ReadTimeSeriesRequest,
  ExpirationIndexDoc,
  StrikeIndexDoc,
} from '@shared/options';
import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_EXPIRATIONS_SUBCOLLECTION,
  TS_STRIKES_SUBCOLLECTION,
} from '@shared/options';

interface TimeSeriesViewerState {
  symbol: string;
  expiration: string | null;
  strike: number | null;
  optionType: 'C' | 'P' | null;
  listResult: ListResult | null;
  contracts: ContractResult[];
  readResult: ReadResult | null;
  loadingList: boolean;
  loadingRead: boolean;
  loadingIndex: boolean;
  error: string | null;
  /** All expiration dates from the index (sorted ascending). */
  allExpirations: string[];
  /** All strike values from the index (sorted ascending). */
  allStrikes: number[];
  /** Map: expiration date → available strikes for that expiration. */
  expirationToStrikes: Record<string, number[]>;
  /** Map: strike value → available expirations for that strike. */
  strikeToExpirations: Record<number, string[]>;
  /** Expirations available given the current strike filter. */
  filteredExpirations: string[];
  /** Strikes available given the current expiration filter. */
  filteredStrikes: number[];
}

const initialState: TimeSeriesViewerState = {
  symbol: 'QQQ',
  expiration: null,
  strike: null,
  optionType: null,
  listResult: null,
  contracts: [],
  readResult: null,
  loadingList: false,
  loadingRead: false,
  loadingIndex: false,
  error: null,
  allExpirations: [],
  allStrikes: [],
  expirationToStrikes: {},
  strikeToExpirations: {},
  filteredExpirations: [],
  filteredStrikes: [],
};

/**
 * NgRx Signal Store for the Time-Series viewer column.
 * Manages time-series-only state: symbol, filters, Firestore index, list/read operations, and error state.
 */
export const TimeSeriesViewerStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store, api = inject(StorageViewerApiService), firestore = inject(Firestore)) => ({
    /** Set the symbol and trigger index reload. */
    setSymbol: (symbol: string) => {
      const upper = symbol.toUpperCase().trim();
      patchState(store, {
        symbol: upper,
        expiration: null,
        strike: null,
        listResult: null,
        contracts: [],
        readResult: null,
        allExpirations: [],
        allStrikes: [],
        expirationToStrikes: {},
        strikeToExpirations: {},
        filteredExpirations: [],
        filteredStrikes: [],
      });
    },

    /** Set the expiration filter and cross-filter strikes. */
    setExpiration: (expiration: string | null) => {
      const expToStrikes = store.expirationToStrikes();
      if (expiration && expToStrikes[expiration]) {
        patchState(store, {
          expiration,
          filteredStrikes: [...expToStrikes[expiration]].sort((a, b) => a - b),
        });
      } else {
        patchState(store, {
          expiration,
          filteredStrikes: [...store.allStrikes()],
        });
      }
    },

    /** Set the strike filter and cross-filter expirations. */
    setStrike: (strike: number | null) => {
      const strikeToExps = store.strikeToExpirations();
      if (strike !== null && strikeToExps[strike]) {
        patchState(store, {
          strike,
          filteredExpirations: [...strikeToExps[strike]].sort(),
        });
      } else {
        patchState(store, {
          strike,
          filteredExpirations: [...store.allExpirations()],
        });
      }
    },

    /** Set the option type filter. */
    setOptionType: (optionType: 'C' | 'P' | null) => {
      patchState(store, { optionType });
    },

    clearError: () => {
      patchState(store, { error: null });
    },

    clearRead: () => {
      patchState(store, { readResult: null });
    },

    /** True when filter dropdowns should be disabled (no symbol or index loading). */
    filtersDisabled: computed(() => !store.symbol() || store.loadingIndex()),

    /** Load the Firestore index for the current symbol (expirations + strikes). */
    loadIndex: rxMethod<void>(
      pipe(
        tap(() => {
          patchState(store, { loadingIndex: true, error: null });
        }),
        switchMap(() => {
          const symbol = store.symbol();
          if (!symbol) {
            patchState(store, { loadingIndex: false });
            return of(null);
          }

          const symbolDocRef = doc(firestore, OPTIONS_FILE_INDEX_COLLECTION, symbol);
          const expCol = collection(symbolDocRef, TS_EXPIRATIONS_SUBCOLLECTION);
          const strikeCol = collection(symbolDocRef, TS_STRIKES_SUBCOLLECTION);

          return forkJoin({
            expirations: defer(() => getDocs(query(expCol))),
            strikes: defer(() => getDocs(query(strikeCol))),
          }).pipe(
            tap({
              next: ({ expirations, strikes }) => {
                const expToStrikes: Record<string, number[]> = {};
                const strikeToExps: Record<number, string[]> = {};
                const allExpirations: string[] = [];
                const allStrikes: number[] = [];
                for (const docSnap of expirations.docs) {
                  const data = docSnap.data() as ExpirationIndexDoc;
                  expToStrikes[data.date] = data.strikes;
                  allExpirations.push(data.date);
                }

                for (const docSnap of strikes.docs) {
                  const data = docSnap.data() as StrikeIndexDoc;
                  strikeToExps[data.strike] = data.expirations;
                  allStrikes.push(data.strike);
                }

                allExpirations.sort();
                allStrikes.sort((a, b) => a - b);

                patchState(store, {
                  allExpirations,
                  allStrikes,
                  expirationToStrikes: expToStrikes,
                  strikeToExpirations: strikeToExps,
                  filteredExpirations: allExpirations,
                  filteredStrikes: allStrikes,
                  loadingIndex: false,
                  error: null,
                });
              },
            }),
            catchError((err) => {
              console.error('[TimeSeriesViewerStore] loadIndex error:', err);
              patchState(store, {
                loadingIndex: false,
                error: err.message || 'Failed to load index from Firestore.',
                allExpirations: [],
                allStrikes: [],
                expirationToStrikes: {},
                strikeToExpirations: {},
                filteredExpirations: [],
                filteredStrikes: [],
              });
              return of(null);
            }),
          );
        }),
      ),
    ),

    /** List time-series contracts for the current symbol + filters. */
    list: rxMethod<void>(
      pipe(
        tap(() => {
          patchState(store, { loadingList: true, error: null, readResult: null });
        }),
        switchMap(() => {
          const symbol = store.symbol();
          if (!symbol) {
            patchState(store, { loadingList: false, error: 'Symbol is required.' });
            return of(null);
          }

          const req: ListTimeSeriesRequest = {
            action: 'list',
            bucket: 'time-series',
            symbol,
            expiration: store.expiration() ?? undefined,
            strike: store.strike() ?? undefined,
            type: store.optionType() ?? undefined,
          };

          return api.list(req).pipe(
            tap({
              next: (result) => {
                const contracts = result.bucket === 'time-series' ? result.contracts : [];
                patchState(store, {
                  listResult: result,
                  contracts,
                  loadingList: false,
                  error: null,
                });
              },
            }),
            catchError((err) => {
              console.error('[TimeSeriesViewerStore] list error:', err);
              patchState(store, {
                loadingList: false,
                error: err.message || 'Failed to list contracts.',
                listResult: null,
                contracts: [],
              });
              return of(null);
            }),
          );
        }),
      ),
    ),

    /** Read a specific time-series file by contract ID. */
    read: rxMethod<string>(
      pipe(
        tap(() => {
          patchState(store, { loadingRead: true, error: null });
        }),
        switchMap((contractId) => {
          const symbol = store.symbol();
          if (!symbol) {
            patchState(store, { loadingRead: false, error: 'Symbol is required.' });
            return of(null);
          }

          const req: ReadTimeSeriesRequest = {
            action: 'read',
            bucket: 'time-series',
            symbol,
            contractId,
          };

          return api.read(req).pipe(
            tap({
              next: (result) => {
                patchState(store, { readResult: result, loadingRead: false, error: null });
              },
            }),
            catchError((err) => {
              console.error('[TimeSeriesViewerStore] read error:', err);
              patchState(store, {
                loadingRead: false,
                error: err.message || 'Failed to read file.',
                readResult: null,
              });
              return of(null);
            }),
          );
        }),
      ),
    ),
  })),
  withHooks({
    onInit(store) {
      store.loadIndex();
    },
  }),
);
