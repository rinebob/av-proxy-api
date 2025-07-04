import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, catchError, from, map, of } from 'rxjs';
import { 
  DataMaintainerFunctionName, 
  ListSymbolsResponse, 
  SymbolDetailsResponse, 
  SyncSymbolsRequest, 
  SyncSymbolsResponse,
  TrackedSymbol,
  getDataMaintainerFunctionUrl
} from '../../data-maintainer-view/common/fe-common-dm-api';

/**
 * Service responsible for managing stock symbols in the data maintainer system.
 * Handles listing, syncing, and retrieving details about tracked symbols.
 */
@Injectable({
  providedIn: 'root'
})
export class SymbolManagerService {
  private readonly http = inject(HttpClient);
  private readonly functions = inject(Functions);

  // Store the callable function as a class property to ensure it's created in the injection context
  private getSymbolDetailsFn = httpsCallable<{ symbol: string }, { exists: boolean; data?: TrackedSymbol }>(
    this.functions,
    DataMaintainerFunctionName.GET_SYMBOL_DETAILS
  );

  /**
   * Lists all tracked symbols with optional filtering and pagination
   * @param activeOnly Whether to show only active symbols (default: true)
   * @param limit Maximum number of symbols to return (default: 100)
   * @param offset Number of symbols to skip (for pagination, default: 0)
   * @returns Observable with the list of tracked symbols
   */
  listSymbols(activeOnly: boolean = true, limit: number = 100, offset: number = 0): Observable<ListSymbolsResponse> {
    const params = new URLSearchParams({
      activeOnly: String(activeOnly),
      limit: String(limit),
      offset: String(offset),
      sortBy: 'symbol',
      sortDirection: 'asc'
    });

    const url = `${getDataMaintainerFunctionUrl(DataMaintainerFunctionName.LIST_SYMBOLS)}?${params.toString()}`;
    
    return this.http.get<ListSymbolsResponse>(url).pipe(
      map(response => {
        if (!response) return { ok: false, error: 'No response', symbols: [] };
        
        // Process timestamps in the response
        const processedSymbols = (response.symbols || []).map(symbol => 
          this.processTimestamps(symbol) as TrackedSymbol
        );
        
        return {
          ...response,
          symbols: processedSymbols
        };
      }),
      catchError(error => {
        console.error('Error listing symbols:', error);
        return of({ 
          ok: false, 
          error: error.message || 'Failed to fetch symbols', 
          symbols: [] 
        });
      })
    );
  }

  /**
   * Gets details for a specific symbol using Firebase Callable Function
   * @param symbol The symbol to get details for
   * @returns Observable with the symbol details
   */
  getSymbolDetails(symbol: string): Observable<SymbolDetailsResponse> {
    return from(this.getSymbolDetailsFn({ symbol })).pipe(
      map(({ data: responseData }) => {
        const { exists, data } = responseData;
        
        if (exists && data) {
          // Process timestamps in the response
          const processedData = this.processTimestamps(data);
          return { 
            ok: true, 
            data: processedData as TrackedSymbol
          };
        } else {
          return { 
            ok: false, 
            error: 'Symbol not found',
            data: null
          };
        }
      }),
      catchError(error => {
        console.error('Error getting symbol details:', error);
        return of({ 
          ok: false, 
          error: error.message || 'Failed to fetch symbol details',
          data: null 
        });
      })
    );
  }
  
  /**
   * Removes a symbol from tracking
   * @param symbol The symbol to remove
   * @param clientId The client ID making the request
   * @param clientName The name of the client making the request
   * @returns Observable with the sync results
   */
  removeSymbol(symbol: string, clientId: string, clientName: string): Observable<SyncSymbolsResponse> {
    if (!symbol) {
      return of({
        ok: false,
        error: 'No symbol provided',
        added: 0,
        removed: 0,
        totalActive: 0,
        addedCount: 0,
        removedCount: 0,
        totalTracked: 0
      });
    }

    // To remove a symbol, we need to include it in the symbols array
    // with an empty array for the symbol, which will remove it from tracking
    return this.syncSymbols({
      clientId,
      clientName,
      symbols: [symbol]
    }).pipe(
      catchError(error => {
        console.error('Error removing symbol:', error);
        return of({
          ok: false,
          error: error.message || 'Failed to remove symbol',
          added: 0,
          removed: 0,
          totalActive: 0,
          addedCount: 0,
          removedCount: 0,
          totalTracked: 0
        });
      })
    );
  }

  syncSymbols(request: SyncSymbolsRequest): Observable<SyncSymbolsResponse> {
    const formattedRequest: SyncSymbolsRequest = {
      clientId: request.clientId,
      clientName: request.clientName || `Client ${request.clientId}`,
      symbols: request.symbols,
      metadata: request.metadata || { source: 'web-ui' }
    };

    const url = getDataMaintainerFunctionUrl(DataMaintainerFunctionName.SYNC_SYMBOLS);
    return this.http.post<SyncSymbolsResponse>(url, formattedRequest).pipe(
      map(response => {
        if (!response) {
          throw new Error('No response from server');
        }
        
        // Process any timestamps in the response
        return this.processTimestamps(response) as SyncSymbolsResponse;
      }),
      catchError(error => {
        console.error('Error syncing symbols:', error);
        return of({
          ok: false,
          error: error.message || 'Failed to sync symbols',
          added: 0,
          removed: 0,
          totalActive: 0,
          addedCount: 0,
          removedCount: 0,
          totalTracked: 0
        });
      })
    );
  }

  /**
   * Converts Firestore Timestamps to Date objects in the response
   * Handles all possible Firestore timestamp formats:
   * 1. Firestore Timestamp objects (with toDate() method)
   * 2. { seconds, nanoseconds } objects
   * 3. ISO date strings
   * 4. Unix timestamps (milliseconds or seconds)
   * @param obj The object to process
   * @private
   */
  private processTimestamps(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Check if it's a Firestore Timestamp object (has toDate method)
    if (obj && typeof obj === 'object' && 'toDate' in obj && typeof obj.toDate === 'function') {
      return obj.toDate();
    }

    // Handle case where timestamp is in { seconds, nanoseconds } format
    if (typeof obj === 'object' && 'seconds' in obj && 'nanoseconds' in obj) {
      return new Date(obj.seconds * 1000 + Math.floor(obj.nanoseconds / 1000000));
    }

    // Handle ISO date strings
    if (typeof obj === 'string' && !isNaN(Date.parse(obj))) {
      return new Date(obj);
    }

    // Handle Unix timestamp (in seconds or milliseconds)
    if (typeof obj === 'number') {
      return obj > 1e10 ? new Date(obj) : new Date(obj * 1000);
    }

    // Process arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.processTimestamps(item));
    }

    // Process plain objects (including nested ones)
    if (typeof obj === 'object' && obj !== null) {
      const result: Record<string, any> = {};
      
      // Known date fields that should always be processed
      const dateFields = [
        'createdAt', 'updatedAt', 'lastRefreshed', 
        'lastSeen', 'firstSeen', 'deactivatedAt',
        'date', 'timestamp', 'time', 'modifiedAt'
      ];
      
      // Special handling for Firestore document metadata
      const isFirestoreDoc = '_document' in obj || '_firestore' in obj;
      
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = obj[key];
          
          // Always process known date fields
          if (dateFields.includes(key) || key.endsWith('At') || key.endsWith('Date')) {
            result[key] = this.processTimestamps(value);
          } 
          // For Firestore documents, process all fields
          else if (isFirestoreDoc) {
            result[key] = this.processTimestamps(value);
          }
          // For other objects, only process if it's not a plain object (to avoid excessive processing)
          else if (value && typeof value === 'object' && !Array.isArray(value)) {
            // Only process if it looks like a date object
            if ('seconds' in value && 'nanoseconds' in value) {
              result[key] = this.processTimestamps(value);
            } else {
              result[key] = value;
            }
          } else {
            result[key] = value;
          }
        }
      }
      
      // Preserve special properties like __proto__
      if (Object.getPrototypeOf(obj) !== Object.prototype) {
        Object.setPrototypeOf(result, Object.getPrototypeOf(obj));
      }
      
      return result;
    }

    // Return as-is if not a date or object
    return obj;
  }
}
