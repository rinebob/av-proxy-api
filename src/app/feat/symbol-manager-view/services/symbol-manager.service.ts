import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, catchError, finalize, from, map, of, tap } from 'rxjs';
import { processTimestamps } from '../../../shared/utils/date-utils';
import { 
  DataMaintainerFunctionName, 
  ListSymbolsResponse, 
  SymbolDetailsResponse, 
  SyncSymbolsRequest, 
  SyncSymbolsResponse,
  TrackedSymbol,
  AvSymbolSearchResult,
  getDataMaintainerFunctionUrl
} from '../../data-maintainer-view/common/fe-common-dm-api';
import { AlphaVantageFunctions } from '../../../common/fe-common-app';
import { SvtAvSymbolMatch } from '../../data-maintainer-view/common/fe-common-dm-api';

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
          processTimestamps(symbol) as TrackedSymbol
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
          const processedData = processTimestamps(data);
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
   * @returns Observable with the sync results
   */
  /**
   * Creates a standardized error response object
   * @param message Error message
   * @returns Formatted SyncSymbolsResponse with error state
   */
  private createErrorResponse(message: string): SyncSymbolsResponse {
    return {
      success: false,
      message,
      error: message,
      added: 0,
      removed: 0,
      totalActive: 0,
      timestamp: new Date(),
      addedCount: 0,
      removedCount: 0,
      totalTracked: 0
    };
  }

  removeSymbol(symbol: string): Observable<SyncSymbolsResponse> {
    if (!symbol) {
      const errorMsg = 'FE sMS rS [SymbolManager] No symbol provided for removal';
      console.warn(errorMsg);
      return of(this.createErrorResponse(errorMsg));
    }

    // Create request object with remove flag set to true
    const request: SyncSymbolsRequest = { 
      symbols: [symbol],
      timestamp: new Date(),
      remove: true // This will trigger removal in the backend
    };
    const url = getDataMaintainerFunctionUrl(DataMaintainerFunctionName.SYNC_SYMBOLS);

    console.log('FE sMS rS [SymbolManager] removeSymbol called', {
      symbol,
      url,
      request,
      timestamp: new Date().toISOString()
    });
    
    return this.http.post<SyncSymbolsResponse>(url, request).pipe(
      tap(response => {
        console.log('FE sMS rS [SymbolManager] HTTP Response received:', {
          status: 'success',
          timestamp: new Date().toISOString(),
          url,
          response: JSON.parse(JSON.stringify(response)) // Create a clean copy
        });
        console.log('Raw response from server:', response);
      }),
      map(response => {
        if (!response) {
          const errorMsg = 'FE sMS rS [SymbolManager] Empty response from server';
          console.error(errorMsg);
          throw new Error(errorMsg);
        }
        
        // Process any timestamps in the response
        const processedResponse = processTimestamps(response) as SyncSymbolsResponse;
        console.log('Processed response:', processedResponse);
        
        console.log('FE sMS rS [SymbolManager] Processed response:', {
          timestamp: new Date().toISOString(),
          processedResponse: JSON.parse(JSON.stringify(processedResponse)),
          originalResponse: JSON.parse(JSON.stringify(response))
        });
        
        // Convert to the expected format
        const normalized = this.normalizeResponse(processedResponse);
        console.log('FE sMS rS [SymbolManager] Normalized response:', normalized);
        
        return normalized;
      }),
      catchError(error => {
        console.error('Error removing symbol:', error);
        return of({
          success: false,
          message: error.message || 'Failed to remove symbol',
          error: error.message || 'Failed to remove symbol',
          added: 0,
          removed: 0,
          totalActive: 0,
          timestamp: new Date(),
          addedCount: 0,
          removedCount: 0,
          totalTracked: 0,
          // Legacy property for backward compatibility
          ok: false
        });
      })
    );
  }

  /**
   * Normalizes a SyncSymbolsResponse to ensure it has all required fields
   * @param response The response to normalize
   * @returns A properly formatted SyncSymbolsResponse
   */
  private normalizeResponse(response: Partial<SyncSymbolsResponse>): SyncSymbolsResponse {
    return {
      success: response.success || false,
      message: response.message || (response.success ? 'Operation completed successfully' : 'Operation failed'),
      error: response.error || (response.success ? undefined : 'Unknown error'),
      added: response.added || 0,
      removed: response.removed || 0,
      totalActive: response.totalActive || 0,
      timestamp: response.timestamp || new Date(),
      addedCount: response.addedCount || response.added || 0,
      removedCount: response.removedCount || response.removed || 0,
      totalTracked: response.totalTracked || response.totalActive || 0
    };
  }

  /**
   * Adds new symbols to be tracked
   * @param symbols Array of symbols to add
   * @returns Observable with the sync results
   */
  addSymbols(symbols: string[]): Observable<SyncSymbolsResponse> {
    const requestId = Math.random().toString(36).substring(2, 8);
    console.log(`FE sMS aS [${requestId}] addSymbols called with symbols:`, symbols);
    
    if (!symbols || symbols.length === 0) {
      const errorMsg = 'No symbols provided';
      console.warn(`FE sMS aS [${requestId}]`, errorMsg);
      return of(this.createErrorResponse(errorMsg));
    }

    // Create typed request object with timestamp
    const request: SyncSymbolsRequest = { 
      symbols: symbols.map(s => s.toUpperCase().trim()),
      timestamp: new Date()
    };
    
    const url = getDataMaintainerFunctionUrl(DataMaintainerFunctionName.SYNC_SYMBOLS);
    
    console.log(`FE sMS aS [${requestId}] Sending request:`, {
      url,
      request,
      timestamp: new Date().toISOString()
    });
    
    return this.http.post<SyncSymbolsResponse>(url, request, { observe: 'response' }).pipe(
      tap({
        next: (httpResponse) => {
          // Log the full HTTP response including headers
          console.log(`FE sMS aS [${requestId}] Full HTTP response:`, httpResponse);
          
          // Log the response body (the actual data)
          const response = httpResponse.body;
          if (response) {
            console.log(`FE sMS aS [${requestId}] Response body:`, response);
            
            // If we have the symbol data in the response, log it in the requested format
            if (response['symbolData']) {
              const symbolData = response['symbolData'];
              console.log('SYMBOL_SEARCH data received:');
              console.log('{');
              console.log(`  symbol: "${symbolData.symbol || ''}",`);
              console.log(`  name: "${symbolData.name || ''}",`);
              console.log(`  type: "${symbolData.type || ''}",`);
              console.log(`  region: "${symbolData.region || ''}",`);
              console.log(`  marketOpen: "${symbolData.marketOpen || ''}",`);
              console.log(`  marketClose: "${symbolData.marketClose || ''}",`);
              console.log(`  timezone: "${symbolData.timezone || ''}",`);
              console.log(`  currency: "${symbolData.currency || ''}",`);
              console.log(`  matchScore: "${symbolData.matchScore || ''}"`);
              console.log('}');
            }
          }
        },
        error: (error) => {
          console.error(`FE sMS aS [${requestId}] HTTP error:`, {
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
            errorDetails: error
          });
        }
      }),
      map(httpResponse => {
        const response = httpResponse.body;
        if (!response) {
          const errorMsg = 'Empty response from server';
          console.error(`FE sMS aS [${requestId}] ${errorMsg}`);
          throw new Error(errorMsg);
        }
        
        console.log(`FE sMS aS [${requestId}] Processing response...`);
        const processedResponse = processTimestamps(response) as SyncSymbolsResponse;
        const normalized = this.normalizeResponse(processedResponse);
        
        return normalized;
      }),
      catchError(error => {
        console.error(`FE sMS aS [${requestId}] Error adding symbols:`, error);
        return of({
          success: false,
          message: error.message || 'Failed to add symbols',
          error: error.message || 'Failed to add symbols',
          added: 0,
          removed: 0,
          totalActive: 0,
          timestamp: new Date(),
          addedCount: 0,
          removedCount: 0,
          totalTracked: 0
        });
      })
    );
  }

  /**
   * Searches for symbols using the deployed symbol search Cloud Function
   * @param keywords The search keywords (e.g., 'microsoft')
   * @returns Observable with the search results
   */
  searchSymbols(keywords: string): Observable<SvtAvSymbolMatch[]> {
    if (!keywords?.trim()) {
      return of([]);
    }

    console.log('========== START SYMBOL SEARCH ==========');
    console.log('sMSvc sS searching symbols with keyword:', keywords);

    const url = AlphaVantageFunctions.SYMBOL_SEARCH.url;
    console.log('sMSvc sS using endpoint url:', url);
    
    const params = new URLSearchParams();
    params.set('keywords', keywords.trim());
    
    return this.http.get<any>(
      `${url}?${params.toString()}`,
      { observe: 'response' }
    ).pipe(
      tap(response => {
        console.log('sMSvc sS Full HTTP response:', {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body
        });
      }),
      map(response => {
        const body = response.body;
        console.log('sMSvc sS Response body:', body);
        
        if (Array.isArray(body)) {
          return body as SvtAvSymbolMatch[];
        } else if (body && Array.isArray(body.data)) {
          return body.data as SvtAvSymbolMatch[];
        } else if (body && body.bestMatches) {
          return body.bestMatches as SvtAvSymbolMatch[];
        }
        
        console.warn('sMSvc sS Unexpected response format:', body);
        return [];
      }),
      catchError(error => {
        console.error('sMSvc sS Error searching symbols:', {
          error,
          status: error.status,
          statusText: error.statusText,
          errorDetails: error.error
        });
        return of([]);
      }),
      finalize(() => {
        console.log('========== END SYMBOL SEARCH ==========');
      })
    );
  }
}
