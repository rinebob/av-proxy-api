import { signalStore, withState, withMethods, patchState, withHooks, withProps } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of, from } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { inject } from '@angular/core';
import { FirestoreService } from '../../../core/services/firestore.service';
import { CollectionInfo, FirestoreDocument, TOP_LEVEL_COLLECTIONS } from '@shared/firestore';

interface AdminDashboardState {
  // Available top-level collections
  collections: CollectionInfo[];
  // Current collection path (e.g., 'users' or 'users/12345/orders')
  currentCollectionPath: string;
  // Current collection info
  currentCollection: CollectionInfo | null;
  // Documents in the current collection
  documents: FirestoreDocument[];
  // Currently selected document (if any)
  selectedDocument: FirestoreDocument | null;
  // Subcollections of the selected document
  subcollections: string[];
  // Loading state
  loading: boolean;
  // Error state
  error: string | null;
}

const initialState: AdminDashboardState = {
  collections: TOP_LEVEL_COLLECTIONS,
  currentCollectionPath: '',
  currentCollection: null,
  documents: [],
  selectedDocument: null,
  subcollections: [],
  loading: false,
  error: null
};

export const AdminDashboardStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withProps((store) => ({
    currentCollectionPath$: toObservable(store.currentCollectionPath),
    currentCollection$: toObservable(store.currentCollection),
    documents$: toObservable(store.documents),
    selectedDocument$: toObservable(store.selectedDocument),
    subcollections$: toObservable(store.subcollections),
    loading$: toObservable(store.loading),
    error$: toObservable(store.error)
  })),
  withMethods((
    store,
    firestoreService = inject(FirestoreService)
) => ({
    selectDocument: rxMethod<FirestoreDocument>(
        pipe(
          tap((doc) => {
            if (!doc) return;
            
            console.log(`[AdminDashboardStore] Selecting document: ${doc.id}`);
            patchState(store, { 
              loading: true,
              error: null,
              selectedDocument: doc,
            });
          }),
          switchMap((doc) => {
            if (!doc) return of(null);
            
            // Load subcollections for the selected document
            return from(firestoreService.listCollections(doc.path)).pipe(
              tap({
                next: (subcollections) => {
                  console.log(`[AdminDashboardStore] Loaded ${subcollections.length} subcollections for ${doc.id}`);
                  patchState(store, { 
                    subcollections,
                    loading: false,
                    error: null
                  });
                },
                error: (error) => {
                  console.error(`[ERROR] [AdminDashboardStore] Error loading subcollections for ${doc.id}:`, error);
                  patchState(store, { 
                    loading: false, 
                    error: `Failed to load subcollections: ${error.message}`,
                    subcollections: []
                  });
                }
              })
            );
          })
        )
      ),
  })),
  withMethods((
    store,
    firestoreService = inject(FirestoreService)
  ) => ({
    // Navigate to a collection
    navigateToCollection: rxMethod<string>(
        pipe(
          tap((path) => {
            if (!path) return;
            
            console.log(`[AdminDashboardStore] Navigating to collection: ${path}`);
            patchState(store, { 
              loading: true, 
              error: null,
              currentCollectionPath: path,
              currentCollection: {
                id: path.split('/').pop() || '',
                name: path.split('/').pop() || '',
                description: ''
              },
              selectedDocument: null,
              documents: []
            });
          }),
          switchMap(path => {
            if (!path) return of(null);
            
            return firestoreService.getDocuments(path).pipe(
              tap({
                next: (documents) => {
                  console.log(`[AdminDashboardStore] Loaded ${documents.length} documents for ${path}`);
                  
                  // Select the first document by default if available
                  const firstDoc = documents.length > 0 ? documents[0] : null;
                  
                  patchState(store, { 
                    documents,
                    loading: false,
                    error: null
                  });
                  
                  // If we have documents, select the first one
                  if (firstDoc) {
                    store.selectDocument(firstDoc);
                  } else {
                    // No documents, clear selection and subcollections
                    patchState(store, {
                      selectedDocument: null,
                      subcollections: []
                    });
                  }
                },
                error: (error) => {
                  console.error(`[ERROR] [AdminDashboardStore] Error loading documents for ${path}:`, error);
                  patchState(store, { 
                    loading: false, 
                    error: `Failed to load documents: ${error.message}`,
                    documents: [],
                    selectedDocument: null,
                    subcollections: []
                  });
                }
              })
            );
          })
        )
      ),
  })),
  withMethods((store, firestoreService = inject(FirestoreService)) => ({
    // Clear any error
    clearError: () => {
      patchState(store, { error: null });
    },
    
    // Refresh the current view
    refresh: () => {
      const { currentCollectionPath } = store;
      if (currentCollectionPath) {
        store.navigateToCollection(currentCollectionPath);
      }
    }
  })),
  withProps((store) => ({
    collections$: toObservable(store.collections),
    currentCollectionPath$: toObservable(store.currentCollectionPath),
    currentCollection$: toObservable(store.currentCollection),
    documents$: toObservable(store.documents),
    selectedDocument$: toObservable(store.selectedDocument),
    subcollections$: toObservable(store.subcollections),
    loading$: toObservable(store.loading),
    error$: toObservable(store.error)
  })),
  withHooks({
    onInit(store) {
      // Initialize by navigating to the first top-level collection
      if (store.collections().length > 0) {
        store.navigateToCollection(store.collections()[0].id);
      }
    }
  })
);
