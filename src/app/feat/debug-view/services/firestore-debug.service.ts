import { Injectable, inject, NgZone } from '@angular/core';
import { 
  Firestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc,
  query, 
  where, 
  Timestamp, 
  collectionData, 
  DocumentData, 
  QueryDocumentSnapshot,
  QuerySnapshot,
  getCountFromServer,
  collectionGroup
} from '@angular/fire/firestore';
import { Observable, from, map, of, catchError, switchMap, combineLatest, forkJoin } from 'rxjs';
import { 
  TrackedSymbol, 
  EndpointData, 
  RefreshEvent 
} from '../../data-maintainer-view/common/fe-common-dm-api';
import { safeDate } from '../../../shared/utils/date-utils';

@Injectable({
  providedIn: 'root'
})
export class FirestoreDebugService {
  private firestore = inject(Firestore);
  private ngZone = inject(NgZone);

  constructor() { 
    // Initialize with debug info
    this.listCollections().subscribe(collections => {
      console.log('Available Firestore collections:', collections);
    });
  }

  /**
   * Test method to verify Firestore write access
   * @returns Observable with test result
   */
  testWriteAccess(): Observable<{ success: boolean; message: string }> {
    return this.ngZone.run(() => {
      const testDocRef = doc(collection(this.firestore, 'test_collection'));
      const testData = {
        timestamp: new Date().toISOString(),
        message: 'Test write from debug service',
        testId: `test_${Date.now()}`
      };
      
      return from(setDoc(testDocRef, testData)).pipe(
        switchMap(() => 
          // Verify the document was written
          from(getDoc(testDocRef)).pipe(
            map((docSnap) => {
              if (docSnap.exists()) {
                return {
                  success: true,
                  message: `Successfully wrote and verified test document: ${docSnap.id}`,
                  documentId: docSnap.id
                };
              } else {
                throw new Error('Document was not found after writing');
              }
            })
          )
        ),
        catchError((error) => {
          const errorMessage = `Error writing test document to Firestore: ${error.message}`;
          console.error(errorMessage, error);
          return of({
            success: false,
            message: errorMessage
          });
        })
      );
    });
  }

  /**
   * Get document count for a collection
   */
  private getCollectionCount(collectionPath: string): Observable<number> {
    return this.ngZone.run(() => {
      const coll = collection(this.firestore, collectionPath);
      return from(getCountFromServer(coll)).pipe(
        map((snapshot) => snapshot.data().count),
        catchError(error => {
          console.error(`Error getting count for ${collectionPath}:`, error);
          return of(0);
        })
      );
    });
  }

  /**
   * Get document count for a subcollection
   */
  private getSubcollectionCount(
    collectionPath: string, 
    documentId: string, 
    subcollectionPath: string
  ): Observable<number> {
    return this.ngZone.run(() => {
      const subcoll = collection(
        this.firestore, 
        `${collectionPath}/${documentId}/${subcollectionPath}`
      );
      return from(getCountFromServer(subcoll)).pipe(
        map((snapshot) => snapshot.data().count),
        catchError(error => {
          console.error(`Error getting count for ${collectionPath}/${documentId}/${subcollectionPath}:`, error);
          return of(0);
        })
      );
    });
  }

  /**
   * Get the structure of the market_data collection
   */
  getMarketDataStructure(): Observable<{
    marketDataCount: number;
    symbols: Array<{
      symbol: string;
      dataPointsCount: number;
      companyOverviewCount: number;
    }>;
  }> {
    return this.ngZone.run(() => {
      console.log('Getting market data structure...');
      
      // Get the market_data collection
      const marketDataRef = collection(this.firestore, 'market_data');
      
      return from(getDocs(marketDataRef)).pipe(
        switchMap((querySnapshot) => {
          const symbols = querySnapshot.docs.map(doc => doc.id);
          console.log(`Found ${symbols.length} symbols in market_data`);
          
          if (symbols.length === 0) {
            return of({
              marketDataCount: 0,
              symbols: []
            });
          }
          
          // Get counts for each symbol's subcollections
          const symbolObservables = symbols.map(symbol => 
            combineLatest([
              this.getSubcollectionCount('market_data', symbol, 'data_points'),
              this.getSubcollectionCount('market_data', symbol, 'company-overview')
            ]).pipe(
              map(([dataPointsCount, companyOverviewCount]) => ({
                symbol,
                dataPointsCount,
                companyOverviewCount
              }))
            )
          );
          
          return combineLatest(symbolObservables).pipe(
            map(symbolsData => ({
              marketDataCount: symbols.length,
              symbols: symbolsData
            }))
          );
        }),
        catchError(error => {
          console.error('Error getting market data structure:', error);
          return of({
            marketDataCount: 0,
            symbols: [],
            error: error.message
          });
        })
      );
    });
  }

  // List all collections in the Firestore database for debugging
  listCollections(): Observable<string[]> {
    console.log('Listing all collections in Firestore...');
    
    // In the web client, we can't directly list root collections.
    // Instead, we'll return the known collection names we expect to use.
    const knownCollections = ['market_data', 'tracked_symbols'];
    console.log('Using known collections:', knownCollections);
    
    // For debugging, we'll also try to get a document count for each collection
    const collectionChecks = knownCollections.map(collectionName => 
      from(getDocs(collection(this.firestore, collectionName))).pipe(
        map(snapshot => ({
          name: collectionName,
          count: snapshot.size,
          firstDoc: snapshot.docs[0]?.id || 'none'
        })),
        catchError(error => {
          console.error(`Error checking collection ${collectionName}:`, error);
          return of({ name: collectionName, error: error.message, count: -1 });
        })
      )
    );
    
    return combineLatest(collectionChecks).pipe(
      map(results => {
        console.log('Collection check results:', results);
        return knownCollections;
      }),
      catchError(error => {
        console.error('Error in collection check:', error);
        return of(knownCollections);
      })
    );
  }

  // Helper method to run Firestore operations in the Angular zone
  private runInZone<T>(source: Observable<T>): Observable<T> {
    return new Observable(observer => {
      const subscription = source.subscribe({
        next: value => this.ngZone.run(() => observer.next(value)),
        error: error => this.ngZone.run(() => observer.error(error)),
        complete: () => this.ngZone.run(() => observer.complete())
      });
      return () => subscription.unsubscribe();
    });
  }

  // Get all tracked symbols
  getTrackedSymbols(): Observable<TrackedSymbol[]> {
    return this.runInZone(
      from(getDocs(collection(this.firestore, 'tracked_symbols'))).pipe(
        map((querySnapshot: QuerySnapshot<DocumentData>) => {
          return querySnapshot.docs.map(doc => {
            const data = doc.data();
            
            // Create a new object with all required TrackedSymbol fields
            const trackedSymbol: TrackedSymbol = {
              symbol: data['symbol'] || doc.id,
              name: data['name'] || data['symbol'] || doc.id,
              type: data['type'] || 'Equity',
              region: data['region'] || 'US',
              marketOpen: data['marketOpen'] || '09:30',
              marketClose: data['marketClose'] || '16:00',
              timezone: data['timezone'] || 'America/New_York',
              currency: data['currency'] || 'USD',
              matchScore: data['matchScore']?.toString() || '1',
              isActive: data['isActive'] !== undefined ? data['isActive'] : (data['active'] !== undefined ? data['active'] : true),
              createdAt: safeDate(data['createdAt'], 'medium'),
              clientId: data['clientId'] || 'debug-client'
            };
            
            return trackedSymbol;
          });
        }),
        catchError((error: Error) => {
          console.error('Error fetching tracked symbols:', error);
          return of([]);
        })
      )
    );
  }
  
  // Get all market data symbols
  getAllMarketData(): Observable<string[]> {
    console.log('Fetching all market data symbols...');
    
    // Check for the specific symbols we know exist
    const knownSymbols = ['COF', 'NVDA'];
    console.log(`Checking for known symbols: ${knownSymbols.join(', ')}`);
    
    // Check which of these symbols exist
    const symbolChecks = knownSymbols.map(symbol => 
      from(getDoc(doc(this.firestore, `market_data/${symbol}`))).pipe(
        map(docSnap => {
          const exists = docSnap.exists();
          console.log(`Symbol ${symbol} ${exists ? 'found' : 'not found'}`);
          return exists ? symbol : null;
        }),
        catchError(e => {
          console.error(`Error checking symbol ${symbol}:`, e);
          return of(null);
        })
      )
    );
    
    return this.runInZone(
      forkJoin(symbolChecks).pipe(
        map((results: (string | null)[]) => {
          const validSymbols = results.filter((result): result is string => result !== null);
          console.log(`Found ${validSymbols.length} valid symbols:`, validSymbols);
          
          if (validSymbols.length === 0) {
            console.warn('No valid symbols found in market_data collection');
          }
          
          return validSymbols;
        }),
        catchError(error => {
          console.error('Error checking for known symbols:', error);
          return of([]);
        })
      )
    );
  }

  // Get all data point endpoints for a symbol
  getDataPoints(symbol: string): Observable<string[]> {
    console.log(`Fetching data points for symbol: ${symbol}`);
    return this.runInZone(
      from(getDocs(collection(this.firestore, `market_data/${symbol}/data_points`))).pipe(
        map((querySnapshot: QuerySnapshot<DocumentData>) => {
          const endpoints = querySnapshot.docs.map(doc => doc.id);
          console.log(`Found ${endpoints.length} data point endpoints for ${symbol}:`, endpoints);
          return endpoints;
        }),
        catchError(error => {
          console.error(`Error fetching data points for ${symbol}:`, error);
          return of([]);
        })
      )
    );
  }

  // Get a specific data point for a symbol and endpoint
  getDataPoint(symbol: string, endpoint: string): Observable<EndpointData<any> | null> {
    console.log(`Fetching data point for ${symbol} - ${endpoint}`);
    return this.runInZone(
      from(getDoc(doc(this.firestore, `market_data/${symbol}/data_points/${endpoint}`))).pipe(
        map(docSnap => {
          if (!docSnap.exists()) {
            console.warn(`No data point found for ${symbol} - ${endpoint}`);
            return null;
          }
          const data = docSnap.data();
          const result = {
            endpoint: docSnap.id,
            symbol: symbol,
            lastUpdated: data['lastUpdated']?.toDate(),
            nextRefreshAt: data['nextRefreshAt']?.toDate(),
            ttlSeconds: data['ttlSeconds'],
            status: data['status'],
            data: data['data'] || {},
            errorDetails: data['errorDetails']
          } as EndpointData<any>;
          
          console.log(`Successfully loaded data point for ${symbol} - ${endpoint}:`, result);
          return result;
        }),
        catchError(error => {
          console.error(`Error fetching data point for ${symbol} - ${endpoint}:`, error);
          return of(null);
        })
      )
    );
  }

  // Get all refresh event endpoints for a symbol
  getRefreshEventEndpoints(symbol: string): Observable<string[]> {
    console.log(`Fetching refresh event endpoints for symbol: ${symbol}`);
    return this.runInZone(
      from(getDocs(collection(this.firestore, `market_data/${symbol}/refresh_events`))).pipe(
        map((querySnapshot: QuerySnapshot<DocumentData>) => {
          const endpoints = querySnapshot.docs.map(doc => doc.id);
          console.log(`Found ${endpoints.length} refresh event endpoints for ${symbol}:`, endpoints);
          return endpoints;
        }),
        catchError(error => {
          console.error(`Error fetching refresh event endpoints for ${symbol}:`, error);
          return of([]);
        })
      )
    );
  }

  // Get a specific refresh event for a symbol and endpoint
  getRefreshEvent(symbol: string, endpoint: string): Observable<RefreshEvent | null> {
    console.log(`Fetching refresh event for ${symbol} - ${endpoint}`);
    return this.runInZone(
      from(getDoc(doc(this.firestore, `market_data/${symbol}/refresh_events/${endpoint}`))).pipe(
        map((docSnap) => {
          if (!docSnap.exists()) {
            console.warn(`No refresh event found for ${symbol} - ${endpoint}`);
            return null;
          }
          
          const data = docSnap.data();
          if (!data) {
            console.warn(`No data in refresh event for ${symbol} - ${endpoint}`);
            return null;
          }
          
          // Convert completedAt to Date if it's a Firestore Timestamp
          const completedAt = data['completedAt'];
          const completedAtDate = completedAt?.toDate ? completedAt.toDate() : (typeof completedAt === 'string' ? new Date(completedAt) : completedAt || new Date());
          
          // Map the document data to the RefreshEvent interface
          const result: RefreshEvent = {
            endpoint: endpoint,
            symbol: symbol,
            completedAt: completedAtDate,
            durationMs: data['durationMs'] || 0,
            status: data['status'] || 'unknown',
            error: data['error'] ? {
              message: data['error'].message || 'Unknown error',
              code: data['error'].code,
              stack: data['error'].stack
            } : undefined,
            metadata: data['metadata'] || {}
          };
          
          console.log(`Successfully loaded refresh event for ${symbol} - ${endpoint}:`, result);
          return result;
        }),
        catchError((error: Error) => {
          console.error(`Error fetching refresh event for ${symbol} - ${endpoint}:`, error);
          return of(null);
        })
      )
    );
  }
}
