import { Injectable, inject } from '@angular/core';
import { signalStore, withState, withMethods, patchState, withHooks } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of } from 'rxjs';
import { Firestore, collection, collectionData, doc, docData } from '@angular/fire/firestore';
import { orderBy, limit, query } from 'firebase/firestore';

export interface RefreshHistory {
  id?: string;
  timestamp: any;
  durationMs: number;
  status: 'success' | 'error';
  vendor?: string;
  error?: string;
  endpoint: string;
}

export interface EndpointData {
  data?: any;
  lastRefreshEvent?: any;
  metadata?: any;
}

interface CollectionInfo {
  id: string;
  name: string;
  description: string;
}

export const COLLECTIONS: CollectionInfo[] = [
  { id: 'company-data', name: 'Company Data', description: 'Company information and fundamentals' },
  { id: 'economics', name: 'Economics', description: 'Economic indicators and metrics' },
  { id: 'market-data', name: 'Market Data', description: 'Market prices and trading data' },
  { id: 'news', name: 'News', description: 'Financial news and articles' },
  { id: 'time-series', name: 'Time Series', description: 'Historical time series data' },
  { id: 'tracked-symbols', name: 'Tracked Symbols', description: 'List of tracked financial instruments' }
];

interface AdminDashboardState {
  collections: CollectionInfo[];
  selectedCollection: string | null;
  endpoints: string[];
  selectedEndpoint: string | null;
  endpointData: EndpointData | null;
  refreshHistory: RefreshHistory[];
  failedRefreshes: RefreshHistory[];
  loading: boolean;
  error: string | null;
}

const initialState: AdminDashboardState = {
  collections: COLLECTIONS,
  selectedCollection: null,
  endpoints: [],
  selectedEndpoint: null,
  endpointData: null,
  refreshHistory: [],
  failedRefreshes: [],
  loading: false,
  error: null
};

export const AdminDashboardStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store, firestore = inject(Firestore)) => ({
    // Load all endpoints for the selected collection
    loadEndpoints: rxMethod<string | null>(
      pipe(
        tap(collectionId => {
          patchState(store, { 
            selectedCollection: collectionId,
            loading: true, 
            error: null,
            endpoints: []
          });
        }),
        switchMap((collectionId) => {
          if (!collectionId) return of([]);
          
          const ref = collection(firestore, collectionId);
          return collectionData(ref, { idField: 'id' }).pipe(
            tap((endpoints: any[]) => {
              patchState(store, {
                endpoints: endpoints.map(e => e.id),
                loading: false
              });
            }),
            catchError(error => {
              console.error(`Error loading endpoints for collection ${collectionId}:`, error);
              patchState(store, {
                error: `Failed to load endpoints for ${collectionId}`,
                loading: false
              });
              return of([]);
            })
          );
        })
      )
    ),
    
    // Select an endpoint and load its data
    selectEndpoint: rxMethod<{collectionId: string, endpoint: string}>(
      pipe(
        tap(({ collectionId, endpoint }) => {
          if (!collectionId) return;
          
          patchState(store, {
            selectedEndpoint: endpoint,
            loading: true,
            error: null
          });
          
          // Load endpoint data
          const docRef = doc(firestore, collectionId, endpoint);
          docData(docRef).pipe(
            tap((data: any) => {
              patchState(store, {
                endpointData: data || null
              });
            }),
            catchError(error => {
              console.error(`Error loading data for ${collectionId}/${endpoint}:`, error);
              patchState(store, {
                error: `Failed to load data for ${endpoint}`,
                loading: false
              });
              return of(null);
            })
          ).subscribe();
          
          // Load refresh history
          const historyRef = collection(firestore, `${collectionId}/${endpoint}/refresh-history`);
          const q = query(historyRef, orderBy('timestamp', 'desc'), limit(50));
          
          collectionData(q, { idField: 'id' }).pipe(
            tap((history: any[]) => {
              patchState(store, {
                refreshHistory: history as RefreshHistory[],
                loading: false
              });
            }),
            catchError(error => {
              console.error(`Error loading refresh history for ${collectionId}/${endpoint}:`, error);
              patchState(store, {
                error: `Failed to load history for ${endpoint}`,
                loading: false,
                refreshHistory: []
              });
              return of([]);
            })
          ).subscribe();
        })
      )
    ),
    
    // Load failed refreshes across all endpoints
    loadFailedRefreshes: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { loading: true, error: null })),
        switchMap(() => of([])), // Placeholder for Cloud Function
        tap({
          next: (failedRefreshes: RefreshHistory[]) => {
            patchState(store, {
              failedRefreshes,
              loading: false
            });
          },
          error: (error) => {
            console.error('Error loading failed refreshes:', error);
            patchState(store, {
              error: 'Failed to load failed refreshes',
              loading: false
            });
          }
        })
      )
    ),
    
    // Refresh a specific endpoint
    refreshEndpoint: rxMethod<{collectionId: string, endpoint: string}>(
      pipe(
        tap(({ collectionId, endpoint }) => {
          if (!collectionId) return;
          
          patchState(store, { loading: true, error: null });
          // Implementation would call a Cloud Function to trigger a refresh
          console.log(`Refreshing ${collectionId}/${endpoint}`);
          setTimeout(() => {
            patchState(store, { loading: false });
          }, 1000);
        })
      )
    )
  })),
  withHooks({
    onInit({ loadEndpoints }) {
      // Optionally load the first collection by default
      // loadEndpoints(COLLECTIONS[0]?.id || null);
    }
  })
);
