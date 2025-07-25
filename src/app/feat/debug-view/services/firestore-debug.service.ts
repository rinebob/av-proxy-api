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

type FirebaseTimestamp = ReturnType<typeof Timestamp.fromDate>;
import { Observable, from, map, of, catchError, switchMap, combineLatest, forkJoin, concatMap, filter, take } from 'rxjs';
import { getAuth } from '@angular/fire/auth';
import { 
  TrackedSymbol, 
  EndpointData, 
  RefreshEvent 
} from '../../data-maintainer-view/common/fe-common-dm-api';
import { safeDate } from '../../../shared/utils/date-utils';
import { FirestoreCollections } from '../../../shared/constants/firestore-collections';

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
      const testDocRef = doc(collection(this.firestore, FirestoreCollections.SETTINGS), 'test_document');
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
   * Get the structure of the market_data collection with detailed symbol information
   * @returns Observable with market data structure including symbol counts and subcollection info
   */
  getMarketDataStructure(): Observable<{
    marketDataCount: number;
    symbols: Array<{
      symbol: string;
      dataPointsCount: number;
      companyOverviewCount: number;
      lastUpdated?: Date;
      error?: string;
    }>;
    error?: string;
  }> {
    return this.ngZone.run(() => {
      console.log(`Getting structure of ${FirestoreCollections.MARKET_DATA} collection...`);
      
      // Get all documents from the market-data collection
      const marketDataRef = collection(this.firestore, FirestoreCollections.MARKET_DATA);
      
      return from(getDocs(marketDataRef)).pipe(
        switchMap((querySnapshot) => {
          // Define interface for symbol document data
          interface SymbolDocData {
            lastUpdated?: FirebaseTimestamp | string | Date;
            [key: string]: any;
          }
          
          const symbols = querySnapshot.docs.map(doc => ({
            id: doc.id,
            data: doc.data() as SymbolDocData
          }));
          
          console.log(`Found ${symbols.length} symbols in ${FirestoreCollections.MARKET_DATA} collection`);
          
          if (symbols.length === 0) {
            console.warn(`No symbols found in ${FirestoreCollections.MARKET_DATA} collection`);
            return of({
              marketDataCount: 0,
              symbols: []
            });
          }
          
          // Process each symbol to get subcollection counts and metadata
          const symbolObservables = symbols.map(({ id: symbol, data }) => 
            forkJoin({
              dataPointsCount: this.getSubcollectionCount(FirestoreCollections.MARKET_DATA, symbol, 'data_points'),
              companyOverviewCount: this.getSubcollectionCount(FirestoreCollections.MARKET_DATA, symbol, 'company-overview')
            }).pipe(
              map(({ dataPointsCount, companyOverviewCount }) => {
                // Extract lastUpdated from the document data if available
                let lastUpdated: Date | undefined;
                const lastUpdatedValue = data?.['lastUpdated'];
                
                if (lastUpdatedValue) {
                  if (typeof lastUpdatedValue === 'object' && 'toDate' in lastUpdatedValue && typeof lastUpdatedValue.toDate === 'function') {
                    // Handle Firestore Timestamp
                    lastUpdated = lastUpdatedValue.toDate();
                  } else if (typeof lastUpdatedValue === 'string') {
                    // Handle string date
                    lastUpdated = new Date(lastUpdatedValue);
                  } else if (lastUpdatedValue instanceof Date) {
                    // Handle Date object
                    lastUpdated = lastUpdatedValue;
                  }
                }
                
                return {
                  symbol,
                  dataPointsCount,
                  companyOverviewCount,
                  ...(lastUpdated && { lastUpdated })
                };
              }),
              catchError(error => {
                console.error(`Error processing symbol ${symbol}:`, error);
                return of({
                  symbol,
                  dataPointsCount: -1,
                  companyOverviewCount: -1,
                  error: error.message
                });
              })
            )
          );
          
          return forkJoin(symbolObservables).pipe(
            map(symbolsData => ({
              marketDataCount: symbolsData.length,
              symbols: symbolsData.filter(s => s !== null)
            })),
            catchError(error => {
              console.error('Error processing market data structure:', error);
              return of({
                marketDataCount: 0,
                symbols: [],
                error: 'Failed to process market data structure: ' + error.message
              });
            })
          );
        }),
        catchError(error => {
          console.error('Error getting market data structure:', error);
          return of({
            marketDataCount: 0,
            symbols: [],
            error: 'Failed to fetch market data: ' + error.message
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
    const knownCollections = [FirestoreCollections.MARKET_DATA, FirestoreCollections.TRACKED_SYMBOLS];
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
  // TODO: Update collection name to use hyphen (tracked-symbols) in the next major version
  // Currently using underscore to match existing emulator data
  getTrackedSymbols(): Observable<TrackedSymbol[]> {
    return this.runInZone(
      from(getDocs(collection(this.firestore, FirestoreCollections.TRACKED_SYMBOLS))).pipe(
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
    console.log('=== Starting getAllMarketData() ===');
    
    // Check if Firestore is initialized
    if (!this.firestore) {
      console.error('Firestore is not initialized');
      return of([]);
    }
    
    console.log(`1. Getting list of all documents in ${FirestoreCollections.MARKET_DATA} collection...`);
    
    return this.runInZone(
      from(getDocs(collection(this.firestore, FirestoreCollections.MARKET_DATA))).pipe(
        map(querySnapshot => {
          const symbols = querySnapshot.docs.map(doc => doc.id);
          console.log(`Found ${symbols.length} symbols in ${FirestoreCollections.MARKET_DATA} collection`);
          return symbols;
        }),
        switchMap(symbols => {
          if (symbols.length > 0) {
            console.log(`Returning symbols from ${FirestoreCollections.MARKET_DATA} collection`);
            return of(symbols);
          }
          
          console.log(`No symbols found in ${FirestoreCollections.MARKET_DATA} collection, falling back to test access`);
          return this.testMarketDataAccess();
        }),
        catchError(error => {
          console.error('Error getting market data:', {
            error: error.message,
            code: error.code,
            details: error
          });
          return this.testMarketDataAccess();
        })
      )
    );
  }

  // Helper method to test access to market-data collection
  private testMarketDataAccess(): Observable<string[]> {
    console.log(`=== Testing ${FirestoreCollections.MARKET_DATA} collection access ===`);
    
    return new Observable<string[]>(subscriber => {
      const testDocRef = doc(this.firestore, `${FirestoreCollections.MARKET_DATA}/TEST_SYMBOL`);
      
      this.ngZone.run(() => {
        from(getDoc(testDocRef)).pipe(
          map(testDoc => {
            const testResult = {
              exists: testDoc.exists(),
              data: testDoc.data()
            };
            
            console.log('Test document access result:', testResult);
            
            if (!testDoc.exists()) {
              console.warn('Test document does not exist. This is expected if no test data has been created.');
              console.log('Attempting to list all collections for diagnostic purposes...');
              
              // Try to get collection list for more diagnostics
              this.listCollections().subscribe(collections => {
                console.log('Available collections:', collections);
              });
            }
            
            // Return empty array since we're just testing access
            return [];
          }),
          catchError(testError => {
            const errorDetails = {
              message: testError.message,
              code: testError.code,
              name: testError.name,
              stack: testError.stack
            };
            
            console.error(`Error accessing test document in ${FirestoreCollections.MARKET_DATA} collection:`, errorDetails);
            
            if (testError.code === 'permission-denied') {
              console.error(`PERMISSION DENIED: The current user does not have permission to access the ${FirestoreCollections.MARKET_DATA} collection`);
              console.log('Current authentication state:', getAuth().currentUser);
            } else if (testError.code === 'not-found') {
              console.error(`COLLECTION NOT FOUND: The ${FirestoreCollections.MARKET_DATA} collection does not exist or is empty`);
            }
            
            return of([]);
          })
        ).subscribe({
          next: result => this.ngZone.run(() => subscriber.next(result)),
          error: err => this.ngZone.run(() => {
            console.error('Error in testMarketDataAccess subscription:', err);
            subscriber.error(err);
          }),
          complete: () => this.ngZone.run(() => subscriber.complete())
        });
      });
      
      // Cleanup function
      return () => {
        console.log('Cleaning up testMarketDataAccess subscription');
      };
    });
  }

  // Get all data point endpoints for a symbol
  getDataPoints(symbol: string): Observable<string[]> {
    console.log(`Fetching data points for symbol: ${symbol}`);
    return this.runInZone(
      from(getDocs(collection(this.firestore, `${FirestoreCollections.MARKET_DATA}/${symbol}/data_points`))).pipe(
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
    
    // Try with vendor prefixes if not already present
    const tryEndpoints = [
      `bz-${endpoint}`,  // Benzinga prefix with hyphen
      `av-${endpoint}`,  // Alpha Vantage prefix with hyphen
      `bz_${endpoint}`,  // Legacy Benzinga prefix with underscore (for backward compatibility)
      `av_${endpoint}`,  // Legacy Alpha Vantage prefix with underscore (for backward compatibility)
      endpoint           // Original (for backward compatibility)
    ];

    // Try each endpoint in sequence until one works
    return from(tryEndpoints).pipe(
      concatMap(ep => 
        from(getDoc(doc(this.firestore, `${FirestoreCollections.MARKET_DATA}/${symbol}/data_points/${ep}`))).pipe(
          map(docSnap => {
            if (docSnap.exists()) {
              console.log(`Found data for ${symbol} - ${ep}`);
              return { success: true, doc: docSnap };
            }
            return { success: false };
          }),
          catchError(() => of({ success: false }))
        )
      ),
      filter((result: any) => result.success),
      take(1),
      map((result: any) => {
        if (result.success) {
          const data = result.doc.data();
          return {
            id: symbol,
            symbol: symbol,
            endpoint: result.doc.id, // Return the actual document ID that was found
            data: data?.['data'] || {},
            lastUpdated: data?.['lastUpdated']?.toDate?.(),
            nextRefreshAt: data?.['nextRefreshAt']?.toDate?.(),
            ttlSeconds: data?.['ttlSeconds'],
            status: data?.['status'] || 'unknown',
            errorDetails: data?.['errorDetails']
          } as EndpointData<any>;
        }
        return null;
      }),
      catchError(error => {
        console.error(`Error fetching data point for ${symbol} - ${endpoint}:`, error);
        return of(null);
      })
    );
  }

  // Get all refresh event endpoints for a symbol
  getRefreshEventEndpoints(symbol: string): Observable<string[]> {
    console.log(`Fetching refresh event endpoints for symbol: ${symbol}`);
    return this.runInZone(
      from(getDocs(collection(this.firestore, `${FirestoreCollections.MARKET_DATA}/${symbol}/refresh_events`))).pipe(
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
    if (!this.firestore) {
      return of(null);
    }

    return this.runInZone(
      from(getDoc(doc(this.firestore, `${FirestoreCollections.MARKET_DATA}/${symbol}/refresh_events/${endpoint}`))).pipe(
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
          const completedAtDate = completedAt?.toDate ? completedAt.toDate() : 
            (typeof completedAt === 'string' ? new Date(completedAt) : completedAt || new Date());
          
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
        catchError(error => {
          console.error(`Error fetching refresh event for ${symbol} - ${endpoint}:`, error);
          return of(null);
        })
      )
    );
  }

  /**
   * Debug method to check Firestore emulator data
   * @returns Observable with debug information about Firestore data
   */
  debugCheckFirestoreData(): Observable<{
    collections: string[];
    trackedSymbolsCount: number;
    marketDataCount: number;
    error?: string;
  }> {
    console.log('[FirestoreDebugService] Starting Firestore data debug check');
    
    return this.runInZone(
      from(getDocs(query(collection(this.firestore, FirestoreCollections.TRACKED_SYMBOLS)))).pipe(
        switchMap(trackedSymbolsSnapshot => {
          const trackedSymbolsCount = trackedSymbolsSnapshot.size;
          console.log(`[FirestoreDebugService] Found ${trackedSymbolsCount} tracked symbols`);
          
          return from(getDocs(query(collection(this.firestore, FirestoreCollections.MARKET_DATA)))).pipe(
            map(marketDataSnapshot => {
              const marketDataCount = marketDataSnapshot.size;
              console.log(`[FirestoreDebugService] Found ${marketDataCount} market data entries`);
              
              return {
                collections: [
                  FirestoreCollections.TRACKED_SYMBOLS,
                  FirestoreCollections.MARKET_DATA,
                  FirestoreCollections.REFRESH_EVENTS,
                  FirestoreCollections.REFRESH_HISTORY,
                  FirestoreCollections.SETTINGS,
                  FirestoreCollections.USERS
                ],
                trackedSymbolsCount,
                marketDataCount
              };
            })
          );
        }),
        catchError(error => {
          console.error('[FirestoreDebugService] Error checking Firestore data:', error);
          return of({
            collections: [],
            trackedSymbolsCount: -1,
            marketDataCount: -1,
            error: error.message
          });
        })
      )
    );
  }
}
