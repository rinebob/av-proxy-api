import { signalStore, withState, withMethods, patchState, withHooks, withProps } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of, from, map, Observable } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { inject } from '@angular/core';
import { FirestoreCollection } from '../../../core/config/firestore-collection-enum';
import { FirestoreService } from '../../../core/services/firestore.service';
import { NgZone } from '@angular/core';
import { CollectionInfo, FirestoreDocument } from '../../../common/fe-common-fs';
import { TOP_LEVEL_COLLECTIONS } from '../../../common/fe-common-fs';


interface AdminDashboardState {
  collections: CollectionInfo[];
  currentPath: string;
  currentCollection: CollectionInfo;
  subcollections: string[];
  documents: FirestoreDocument[];
  selectedDocument: FirestoreDocument | null;
  selectedDocumentData: any | null;
  loading: boolean;
  error: string | null;
}


const initialState: AdminDashboardState = {
  collections: TOP_LEVEL_COLLECTIONS,
  currentPath: TOP_LEVEL_COLLECTIONS[0]?.id || '',
  currentCollection: TOP_LEVEL_COLLECTIONS[0],
  subcollections: [],
  documents: [],
  selectedDocument: null,
  selectedDocumentData: null,
  loading: false,
  error: null
};

export const AdminDashboardStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withProps((store) => ({
    currentPath$: toObservable(store.currentPath),
    currentCollection$: toObservable(store.currentCollection),
    subcollections$: toObservable(store.subcollections),
    documents$: toObservable(store.documents),
    selectedDocument$: toObservable(store.selectedDocument),
    selectedDocumentData$: toObservable(store.selectedDocumentData),
    loading$: toObservable(store.loading),
    error$: toObservable(store.error)
  })),
  withMethods((store, firestoreService = inject(FirestoreService), ngZone = inject(NgZone)) => ({
    setCurrentCollection: (collection: CollectionInfo) => {
      patchState(store, { currentCollection: collection });
    },
    
    // Helper function to load document data
    loadDocumentData: (path: string) => {
        if (!path) return of(null);
        
        console.log(`[INFO] [AdminDashboardStore] Loading document data for path: ${path}`);
        return firestoreService.getDocument(path);
      },
    
    getSubcollections: rxMethod<string>(
      pipe(
        tap((path) => {
          if (!path) {
            console.log('[INFO] [AdminDashboardStore] No path provided, clearing subcollections');
            patchState(store, { subcollections: [] });
            return;
          }
          patchState(store, { loading: true });
        }),
        switchMap(path => {
          if (!path) return of([]);
          
          return firestoreService.listCollections(path).pipe(
            tap({
              next: (collections) => {
                console.log(`[INFO] [AdminDashboardStore] Found ${collections.length} subcollections for ${path}`, { collections });
                console.log(`Collections: ${collections}`);
                patchState(store, { 
                  subcollections: collections,
                  loading: false 
                });
              },
              error: (error) => {
                const errorMsg = `Error getting subcollections for ${path}: ${error.message}`;
                console.error(`[ERROR] [AdminDashboardStore] ${errorMsg}`, { error });
                patchState(store, { 
                  error: errorMsg,
                  loading: false,
                  subcollections: [] 
                });
              }
            }),
            catchError(error => {
              console.error('[ERROR] [AdminDashboardStore] Error in getSubcollections:', error);
              patchState(store, { 
                error: 'Failed to load subcollections',
                loading: false,
                subcollections: [] 
              });
              return of([]);
            })
          );
        })
      )
    ),
  })),
  withMethods((store, firestoreService = inject(FirestoreService), ngZone = inject(NgZone)) => ({
    loadDocument: rxMethod<string>(
      pipe(
        tap((path) => {
          if (!path) {
            patchState(store, { selectedDocument: null, selectedDocumentData: null });
            return;
          }
          console.log(`[INFO] [AdminDashboardStore] loadDocument: Loading document from path: ${path}`);
          patchState(store, { 
            loading: true,
            currentPath: path // Ensure currentPath is updated
          });
        }),
        switchMap(path => {
          if (!path) return of(null);
          
          // First, load the document data
          return store.loadDocumentData(path).pipe(
            switchMap(docSnap => {
              if (!docSnap?.exists()) {
                console.log(`[WARN] [AdminDashboardStore] Document not found at path: ${path}`);
                return of(null);
              }
              
              const docData = { id: docSnap.id, ...docSnap.data() };
              const docPath = docSnap.ref.path;
              
              console.log(`[INFO] [AdminDashboardStore] Loaded document:`, { id: docSnap.id, path: docPath });
              
              // Update the store with the document data
              patchState(store, {
                selectedDocument: { 
                  id: docSnap.id, 
                  data: docData, 
                  path: docPath 
                },
                selectedDocumentData: docData,
                currentPath: docPath, // Ensure currentPath is in sync
                loading: false,
                error: null
              });
              
              // Load subcollections for this document
              console.log(`[INFO] [AdminDashboardStore] Loading subcollections for path: ${docPath}`);
              store.getSubcollections(docPath);
              
              return of(docData);
            }),
            catchError(error => {
              const errorMsg = `Error loading document at ${path}: ${error.message}`;
              console.error(`[ERROR] [AdminDashboardStore] ${errorMsg}`, { error });
              patchState(store, { 
                error: errorMsg,
                loading: false,
                selectedDocument: null,
                selectedDocumentData: null
              });
              return of(null);
            })
          );
        })
      )
    ),
  })),
  withMethods((store, firestoreService = inject(FirestoreService)) => ({
    loadCollection: rxMethod<string>(
      pipe(
        tap(() => patchState(store, { loading: true })),
        switchMap(collectionPath => {
          if (!collectionPath) return of([]);
          
          console.log(`[INFO] [AdminDashboardStore] aDSto lC: Loading collection from path: ${collectionPath}`);
          
          // First, load the subcollections for this path
          store.getSubcollections(collectionPath);
          
          return firestoreService.getDocuments(collectionPath).pipe(
            tap(documents => {
              console.log(`[INFO] [AdminDashboardStore] aDSto lC: Successfully loaded ${documents.length} documents from ${collectionPath}`);
              
              // Update the documents in the store
              patchState(store, { 
                documents,
                loading: false,
                selectedDocument: null,
                selectedDocumentData: null
              });
              
              // If we have documents, load the first one
              if (documents.length > 0) {
                const firstDoc = documents[0];
                // Construct the full document path
                const docPath = firstDoc.path || `${collectionPath}/${firstDoc.id}`;
                
                console.log(`[INFO] [AdminDashboardStore] aDSto lC: Loading first document from path: ${docPath}`);
                store.loadDocument(docPath);
              } else {
                console.log(`[INFO] [AdminDashboardStore] aDSto lC: No documents found in collection`);
                patchState(store, { 
                  selectedDocument: null,
                  selectedDocumentData: null,
                  loading: false
                });
              }
            }),
            catchError(error => {
              const errorMsg = `aDSto lC: Error loading collection at ${collectionPath}: ${error.message}`;
              console.error(`[ERROR] [AdminDashboardStore] ${errorMsg}`, { error });
              patchState(store, { 
                error: errorMsg,
                loading: false,
                documents: [] 
              });
              return of([]);
            })
          );
        })
      )
    )
  })),
  withMethods((store, firestoreService = inject(FirestoreService), ngZone = inject(NgZone)) => ({
    // Navigate to a collection
    navigateToCollection: rxMethod<string | FirestoreCollection>(
      pipe(
        tap(collectionId => {
          if (!collectionId) return;
          
          const collectionIdStr = typeof collectionId === 'string' ? collectionId : collectionId;
          console.log(`[INFO] [AdminDashboardStore] aDSto nTC: Navigating to collection: ${collectionIdStr}`);
          
          // Find the collection in the predefined list
          const collection = TOP_LEVEL_COLLECTIONS.find(c => c.id === collectionIdStr);
          if (!collection) {
            console.error(`[ERROR] [AdminDashboardStore] aDSto nTC: Collection not found: ${collectionIdStr}`);
            return;
          }
          
          // Reset state for the new collection
          patchState(store, {
            currentPath: collectionIdStr,
            currentCollection: collection,
            documents: [],
            selectedDocument: null,
            selectedDocumentData: null,
            subcollections: [],
            loading: true,
            error: null
          });
          
          // Load the collection data
          store.loadCollection(collectionIdStr);
        })
      )
    ),

    // Navigate to a document or subcollection
    navigateTo: rxMethod<string>(
      pipe(
        tap(segment => {
          if (!segment) return;
          
          const currentPath = store.currentPath();
          if (!currentPath) return;
          
          // Check if we're at a collection or document
          const pathSegments = currentPath.split('/').filter(Boolean);
          const isAtCollection = pathSegments.length % 2 === 1; // Collection has odd number of segments

          console.log(`[INFO] [AdminDashboardStore] navigateTo segment: ${segment}`);
          console.log(`[INFO] [AdminDashboardStore] navigateTo currentPath: ${currentPath}`);
          console.log(`[INFO] [AdminDashboardStore] navigateTo isAtCollection: ${isAtCollection}`);
          
          let newPath: string;
          
          if (isAtCollection) {
            // At a collection, so next is a document
            // Format: collection/document
            newPath = `${currentPath}/${segment}`;

            console.log(`[INFO] [AdminDashboardStore] navigateTo newPath: ${newPath}`);
            
            // Update the store and load the document
            patchState(store, {
              loading: true,
              error: null
            });
            store.loadDocument(newPath);
          } else {
            // At a document, so next is a subcollection
            // The current path already includes the symbol (e.g., "company-data/NVDA")
            // We just need to append the subcollection name
            newPath = `${currentPath}/${segment}`;

            console.log(`[INFO] [AdminDashboardStore] navigateTo newPath: ${newPath}`);            
            // For subcollections, update the path and load the collection
            patchState(store, {
              currentPath: newPath,
              currentCollection: {
                id: segment,
                name: segment
                  .split(/[-_]/)
                  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' '),
                description: `Subcollection: ${segment}`,
                isSubcollection: true
              },
              documents: [],
              selectedDocument: null,
              selectedDocumentData: null,
              subcollections: [],
              loading: true,
              error: null
            });
            
            store.loadCollection(newPath);
          }
          
          console.log(`[INFO] [AdminDashboardStore] aDSto nT: Navigating to: ${newPath}`);
        })
      )
    ),

    // Select a document and update the path
    selectDocument: rxMethod<FirestoreDocument>(
      pipe(
        tap((document) => {
          if (!document) {
            console.log('[INFO] [AdminDashboardStore] No document provided to selectDocument');
            return;
          }
          
          // Calculate the new path
          const currentPath = store.currentPath();
          const newPath = document.path || `${currentPath}/${document.id}`;
          
          console.log(`[INFO] [AdminDashboardStore] Selecting document:`, { 
            documentId: document.id, 
            currentPath,
            newPath 
          });
          
          // Update the store state
          patchState(store, {
            currentPath: newPath,
            selectedDocument: document,
            selectedDocumentData: null,
            loading: true
          });
          
          // Load the document data
          store.loadDocument(newPath);
        })
      )
    ),
  })),
  withMethods((store) => ({
    // Navigate up one level
    navigateUp: rxMethod<void>(
      pipe(
        tap(() => {
          const currentPath = store.currentPath();
          if (!currentPath) return;
          
          // Split the path and remove the last segment
          const pathSegments = currentPath.split('/').filter(Boolean);
          if (pathSegments.length <= 1) return; // Already at root
          
          pathSegments.pop(); // Remove the last segment
          const newPath = pathSegments.join('/');
          
          console.log(`[INFO] [AdminDashboardStore] aDSto nU: Navigating up to: ${newPath}`);
          
          // If we're going back to a top-level collection, use navigateToCollection
          if (pathSegments.length === 1) {
            store.navigateToCollection(newPath);
            return;
          }
          
          // For subcollections, update the path and load the collection
          patchState(store, {
            currentPath: newPath,
            documents: [],
            selectedDocument: null,
            selectedDocumentData: null,
            subcollections: [],
            loading: true,
            error: null
          });
          
          store.loadCollection(newPath);
        })
      )
    ),

    // Navigate to root
    navigateToRoot: rxMethod<void>(
      pipe(
        tap(() => {
          console.log('[INFO] [AdminDashboardStore] aDSto nTR: Navigating to root');
          
          const rootCollection = TOP_LEVEL_COLLECTIONS[0];
          if (!rootCollection) {
            console.error('[ERROR] [AdminDashboardStore] aDSto nTR: No root collection available');
            return;
          }
          
          // Use navigateToCollection to ensure proper collection handling
          store.navigateToCollection(rootCollection.id);
        })
      )
    ),
    
    // Clear current selection
    clearSelection: rxMethod<void>(
      pipe(
        tap(() => {
          patchState(store, {
            selectedDocument: null,
            selectedDocumentData: null,
            subcollections: []
          });
        })
      )
    )
  })),
  withHooks({
    onInit(store) {
      // Load the initial collection using the current collection's ID
      store.loadCollection(store.currentCollection().id);
    }
  })
);
