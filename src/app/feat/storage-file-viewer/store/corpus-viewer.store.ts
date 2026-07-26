import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of } from 'rxjs';
import { inject } from '@angular/core';

import { StorageViewerApiService } from '../common/storage-viewer-api';
import type {
  CorpusFileEntry,
  ListResult,
  ReadResult,
  ListCorpusRequest,
  ReadCorpusRequest,
} from '@shared/options';

interface CorpusViewerState {
  symbol: string;
  listResult: ListResult | null;
  dates: string[];
  corpusFiles: CorpusFileEntry[];
  readResult: ReadResult | null;
  loadingList: boolean;
  loadingRead: boolean;
  error: string | null;
}

const initialState: CorpusViewerState = {
  symbol: 'QQQ',
  listResult: null,
  dates: [],
  corpusFiles: [],
  readResult: null,
  loadingList: false,
  loadingRead: false,
  error: null,
};

/**
 * NgRx Signal Store for the Corpus viewer column.
 * Manages corpus-only state: symbol, date listing, file reading, and error state.
 * No Firestore index is needed — corpus paths are deterministic.
 */
export const CorpusViewerStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store, api = inject(StorageViewerApiService)) => ({
    /** Set the symbol and clear all results. */
    setSymbol: (symbol: string) => {
      const upper = symbol.toUpperCase().trim();
      patchState(store, {
        symbol: upper,
        listResult: null,
        dates: [],
        corpusFiles: [],
        readResult: null,
        error: null,
      });
    },

    clearError: () => {
      patchState(store, { error: null });
    },

    clearRead: () => {
      patchState(store, { readResult: null });
    },

    /** List corpus dates/files for the current symbol. */
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

          const req: ListCorpusRequest = {
            action: 'list',
            bucket: 'corpus',
            symbol,
          };

          return api.list(req).pipe(
            tap({
              next: (result) => {
                const dates = result.bucket === 'corpus' ? result.dates : [];
                const corpusFiles = result.bucket === 'corpus' ? (result.files ?? []) : [];
                patchState(store, {
                  listResult: result,
                  dates,
                  corpusFiles,
                  loadingList: false,
                  error: null,
                });
              },
            }),
            catchError((err) => {
              console.error('[CorpusViewerStore] list error:', err);
              patchState(store, {
                loadingList: false,
                error: err.message || 'Failed to list corpus files.',
                listResult: null,
                dates: [],
                corpusFiles: [],
              });
              return of(null);
            }),
          );
        }),
      ),
    ),

    /** Read a specific corpus file by date. */
    read: rxMethod<string>(
      pipe(
        tap(() => {
          patchState(store, { loadingRead: true, error: null });
        }),
        switchMap((date) => {
          const symbol = store.symbol();
          if (!symbol) {
            patchState(store, { loadingRead: false, error: 'Symbol is required.' });
            return of(null);
          }

          const req: ReadCorpusRequest = {
            action: 'read',
            bucket: 'corpus',
            symbol,
            date,
          };

          return api.read(req).pipe(
            tap({
              next: (result) => {
                patchState(store, { readResult: result, loadingRead: false, error: null });
              },
            }),
            catchError((err) => {
              console.error('[CorpusViewerStore] read error:', err);
              patchState(store, {
                loadingRead: false,
                error: err.message || 'Failed to read corpus file.',
                readResult: null,
              });
              return of(null);
            }),
          );
        }),
      ),
    ),
  })),
);
