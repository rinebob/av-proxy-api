import { signalStore, withState, withMethods, withProps, withHooks, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of, forkJoin, defer } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { inject, computed } from '@angular/core';
import { Firestore, collection, query, getDocs, doc } from '@angular/fire/firestore';

import { StorageViewerApiService } from '../common/storage-viewer-api';
import type {
  BucketName,
  ContractResult,
  ListResult,
  ReadResult,
  ListTimeSeriesRequest,
  ListCorpusRequest,
  ReadTimeSeriesRequest,
  ReadCorpusRequest,
  ExpirationIndexDoc,
  StrikeIndexDoc,
} from '@shared/options';
import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_EXPIRATIONS_SUBCOLLECTION,
  TS_STRIKES_SUBCOLLECTION,
} from '@shared/options';

interface StorageViewerState {
  bucket: BucketName;
  symbol: string;
  expiration: string | null;
  strike: number | null;
  optionType: 'C' | 'P' | null;
  listResult: ListResult | null;
  contracts: ContractResult[];
  dates: string[];
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

const initialState: StorageViewerState = {
  bucket: 'time-series',
  symbol: 'QQQ',
  expiration: null,
  strike: null,
  optionType: null,
  listResult: null,
  contracts: [],
  dates: [],
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
 * NgRx Signal Store for the Storage File Viewer feature.
 * Manages bucket selection, filters, Firestore index loading, list/read operations, and error state.
 */
export const StorageViewerStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withProps((store) => ({
    bucket$: toObservable(store.bucket),
    symbol$: toObservable(store.symbol),
    listResult$: toObservable(store.listResult),
    readResult$: toObservable(store.readResult),
    loadingList$: toObservable(store.loadingList),
    loadingRead$: toObservable(store.loadingRead),
    loadingIndex$: toObservable(store.loadingIndex),
    error$: toObservable(store.error),
    /** True when filter dropdowns should be disabled (no symbol or index loading). */
    filtersDisabled: computed(() => !store.symbol() || store.loadingIndex()),
  })),
  withMethods((store, api = inject(StorageViewerApiService), firestore = inject(Firestore)) => ({
    /** Set the active bucket (time-series or corpus). */
    setBucket: (bucket: BucketName) => {
      patchState(store, {
        bucket,
        listResult: null,
        contracts: [],
        dates: [],
        readResult: null,
        error: null,
      });
    },

    /** Set the symbol and trigger index load. */
    setSymbol: (symbol: string) => {
      const upper = symbol.toUpperCase().trim();
      patchState(store, {
        symbol: upper,
        expiration: null,
        strike: null,
        listResult: null,
        contracts: [],
        dates: [],
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

    /** Set the option type filter (time-series only). */
    setOptionType: (optionType: 'C' | 'P' | null) => {
      patchState(store, { optionType });
    },

    clearError: () => {
      patchState(store, { error: null });
    },

    clearRead: () => {
      patchState(store, { readResult: null });
    },

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
              console.error('[StorageViewerStore] loadIndex error:', err);
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

    /** Execute a list operation based on current bucket + filters. */
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

          let req: ListTimeSeriesRequest | ListCorpusRequest;
          if (store.bucket() === 'time-series') {
            req = {
              action: 'list',
              bucket: 'time-series',
              symbol,
              expiration: store.expiration() ?? undefined,
              strike: store.strike() ?? undefined,
              type: store.optionType() ?? undefined,
            };
          } else {
            req = {
              action: 'list',
              bucket: 'corpus',
              symbol,
            };
          }

          return api.list(req).pipe(
            tap({
              next: (result) => {
                const contracts = result.bucket === 'time-series' ? result.contracts : [];
                const dates = result.bucket === 'corpus' ? result.dates : [];
                patchState(store, {
                  listResult: result,
                  contracts,
                  dates,
                  loadingList: false,
                  error: null,
                });
              },
            }),
            catchError((err) => {
              console.error('[StorageViewerStore] list error:', err);
              patchState(store, {
                loadingList: false,
                error: err.message || 'Failed to list files.',
                listResult: null,
                contracts: [],
                dates: [],
              });
              return of(null);
            }),
          );
        }),
      ),
    ),

    /** Read a specific file (contract or date) from the current bucket. */
    read: rxMethod<string>(
      pipe(
        tap(() => {
          patchState(store, { loadingRead: true, error: null });
        }),
        switchMap((id) => {
          const symbol = store.symbol();
          if (!symbol) {
            patchState(store, { loadingRead: false, error: 'Symbol is required.' });
            return of(null);
          }

          let req: ReadTimeSeriesRequest | ReadCorpusRequest;
          if (store.bucket() === 'time-series') {
            req = { action: 'read', bucket: 'time-series', symbol, contractId: id };
          } else {
            req = { action: 'read', bucket: 'corpus', symbol, date: id };
          }

          return api.read(req).pipe(
            tap({
              next: (result) => {
                patchState(store, { readResult: result, loadingRead: false, error: null });
              },
            }),
            catchError((err) => {
              console.error('[StorageViewerStore] read error:', err);
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
