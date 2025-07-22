import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable, HttpsCallable } from '@angular/fire/functions';
import { 
  Firestore, 
  doc, 
  getDoc, 
  collection, 
  query, 
  getDocs, 
  DocumentData, 
  DocumentReference, 
  DocumentSnapshot,
  QueryDocumentSnapshot,
  CollectionReference
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  private firestore: Firestore;
  private functions: Functions;
  private listCollectionsFn: HttpsCallable<ListCollectionsRequest, ListCollectionsResponse>;

  constructor() {
    this.firestore = inject(Firestore);
    this.functions = inject(Functions);
    
    this.listCollectionsFn = httpsCallable<ListCollectionsRequest, ListCollectionsResponse>(
      this.functions,
      'listCollections',
      { timeout: 10000 }
    );
  }

  /**
   * List all subcollections for a given Firestore path
   * @param path The Firestore path (e.g., 'news/benzinga')
   * @returns Observable of collection IDs
   */
  listCollections(path: string = ''): Observable<string[]> {
    return from(this.listCollectionsFn({ path })).pipe(
      map(response => {
        if (!response.data.success) {
          console.error('fSvc lC: Failed to list collections:', response.data.error);
          return [];
        }
        return response.data.collections || [];
      }),
      catchError(error => {
        console.error('fSvc lC: Error calling listCollections:', error);
        return of([]);
      })
    );
  }

  /**
   * Get a reference to a Firestore collection
   * @param path The full path to the collection (e.g., 'collection/document/subcollection')
   * @returns The collection reference
   */
  getCollectionRef(path: string): CollectionReference<DocumentData> {
    const parts = path.split('/').filter(Boolean);
    if (parts.length % 2 !== 0) {
      throw new Error('Invalid collection path. Must be in format "collection/document/collection"');
    }
    
    let ref: any = this.firestore;
    for (let i = 0; i < parts.length; i += 2) {
      ref = ref.collection(parts[i]);
      if (i + 1 < parts.length) {
        ref = ref.doc(parts[i + 1]);
      }
    }
    return ref as CollectionReference<DocumentData>;
  }

  /**
   * Get a single document from Firestore
   * @param path The full path to the document (e.g., 'collection/document')
   * @returns Observable with the document snapshot
   */
  getDocument(path: string): Observable<DocumentSnapshot<DocumentData> | null> {
    if (!path) {
      return of(null);
    }
    
    // Split the path into segments
    const pathSegments = path.split('/').filter(Boolean);
    
    // For documents, we need an even number of segments
    if (pathSegments.length % 2 !== 0) {
      console.error('fSvc gD: Invalid document path. Must be in format "collection/document" or "collection/document/subcollection/subdocument"');
      return of(null);
    }

    // Build the document reference step by step
    let ref: DocumentReference | CollectionReference = this.firestore as any;
    for (let i = 0; i < pathSegments.length; i++) {
      if (i % 2 === 0) {
        ref = collection(ref as any, pathSegments[i]);
      } else {
        ref = doc(ref as any, pathSegments[i]);
      }
    }
    
    const docRef = ref as DocumentReference<DocumentData>;
    
    console.log('fSvc gD: Getting document at path:', path);
    
    return from(getDoc(docRef)).pipe(
      catchError(error => {
        console.error('fSvc gD: Error getting document:', error);
        return of(null);
      })
    );
  }

  /**
   * Get all documents from a collection
   * @param path The full path to the collection (e.g., 'collection' or 'collection/doc/subcollection')
   * @returns Observable with an array of document data and metadata
   */
  getDocuments(path: string): Observable<Array<{ id: string; data: any; path: string }>> {
    if (!path) {
      return of([]);
    }
    
    try {
      // Split the path into segments
      const pathSegments = path.split('/').filter(Boolean);
      
      // For collections, we need an odd number of segments
      if (pathSegments.length % 2 === 0) {
        console.error('fSvc gDs: Invalid collection path. Must be in format "collection" or "collection/doc/subcollection"');
        return of([]);
      }

      // Build the collection reference step by step
      let ref: DocumentReference | CollectionReference = this.firestore as any;
      for (let i = 0; i < pathSegments.length; i++) {
        if (i % 2 === 0) {
          ref = collection(ref as any, pathSegments[i]);
        } else {
          ref = doc(ref as any, pathSegments[i]);
        }
      }
      
      const collectionRef = ref as CollectionReference<DocumentData>;
      const q = query(collectionRef);
      
      console.log('fSvc gDs: Getting documents from path:', path);
      
      return from(getDocs(q)).pipe(
        map(snapshot => 
          snapshot.docs.map(doc => ({
            id: doc.id,
            data: doc.data(),
            path: doc.ref.path
          }))
        ),
        catchError(error => {
          console.error('fSvc gDs: Error getting documents:', error);
          return of([]);
        })
      );
    } catch (error) {
      console.error('fSvc gDs: Error in getDocuments:', error);
      return of([]);
    }
  }

  /**
   * Navigate to a document and retrieve its data along with its parent collection
   * @param path The full path to the document (e.g., 'collection/document')
   * @returns Observable with the document data and parent collection
   */
  navigateToDocument(path: string): Observable<{ id: string; data: any; path: string } | null> {
    console.log('fSvc nD: Navigating to document at path:', path);
    
    // First check if the document exists
    return this.getDocument(path).pipe(
      switchMap(docSnapshot => {
        if (!docSnapshot?.exists()) {
          console.log('fSvc nD: Document does not exist at path:', path);
          return of(null);
        }
        
        // If document exists, get its data and parent collection
        const docData = docSnapshot.data();
        const docPath = docSnapshot.ref.path;
        const parentPath = docPath.split('/').slice(0, -1).join('/');
        
        console.log('fSvc nD: Document exists. Getting parent collection items from:', parentPath);
        
        // Get all documents in the parent collection
        return this.getDocuments(parentPath).pipe(
          map(docs => {
            // Find the current document in the collection
            const currentDoc = docs.find(d => d.path === docPath);
            
            if (!currentDoc) {
              console.error('fSvc nD: Current document not found in parent collection');
              return null;
            }
            
            console.log('fSvc nD: Successfully retrieved document and collection data');
            return currentDoc;
          }),
          catchError(error => {
            console.error('fSvc nD: Error getting parent collection:', error);
            return of(null);
          })
        );
      }),
      catchError(error => {
        console.error('fSvc nD: Error in document navigation:', error);
        return of(null);
      })
    );
  }
}

// Interfaces for listCollections function
interface ListCollectionsRequest {
  path?: string;
}

interface ListCollectionsResponse {
  success: boolean;
  collections?: string[];
  error?: string;
  path?: string;
}
