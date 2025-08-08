import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError, tap } from 'rxjs';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { 
  getAlphaVantageEndpointUrl,
  AlphaVantageApiResponse,
  FetchAlphaVantageParams,
  AlphaVantageResponseData,
} from '../common/fe-common-av-api';

@Injectable({
  providedIn: 'root'
})
export class AlphaVantageDataService {
  private readonly http = inject(HttpClient);

  /**
   * Generic method to fetch data from any Alpha Vantage endpoint
   * @param endpoint The Alpha Vantage endpoint to call
   * @param params Parameters for the request, must include at least 'symbol' for most endpoints
   * @returns Observable with the API response
   */
  fetchData<T = AlphaVantageResponseData>(
    endpoint: AlphaVantageEndpoint,
    params: FetchAlphaVantageParams
  ): Observable<AlphaVantageApiResponse<T>> {
    const baseUrl = getAlphaVantageEndpointUrl(endpoint);
    
    // Enhanced request logging with more context
    const requestId = Math.random().toString(36).substring(2, 9);
    console.group(`🔵 fe aVDSvc fD [${requestId}] AlphaVantage API Request`);
    console.log('Endpoint:', endpoint);
    console.log('URL:', baseUrl);
    console.log('Params:', params);
    console.groupEnd();
    
    const startTime = Date.now();
    
    // Convert params to URLSearchParams for the query string
    const queryParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, String(value));
      }
    });
    
    const urlWithParams = `${baseUrl}?${queryParams.toString()}`;
    
    return this.http.get<AlphaVantageApiResponse<T>>(urlWithParams, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-Request-ID': requestId
      }
    }).pipe(
      tap({
        next: (response) => {
          const duration = Date.now() - startTime;
          console.group(`🟢 fe aVDSvc fD [${requestId}] AlphaVantage API Response (${duration}ms)`);
          console.log('Endpoint:', endpoint);
          console.log('Status:', response.ok ? 'Success' : 'Error');
          console.log('Response Data:', response);
          console.groupEnd();
        },
        error: (error: HttpErrorResponse) => {
          const duration = Date.now() - startTime;
          console.group(`🔴 fe aVDSvc fD [${requestId}] AlphaVantage API Error (${duration}ms)`);
          console.error('Endpoint:', endpoint);
          console.error('Error:', error);
          console.error('Error Name:', error.name);
          console.error('Error Message:', error.message);
          
          if (error instanceof HttpErrorResponse) {
            console.error('Status:', error.status, error.statusText);
            console.error('URL:', error.url);
            console.error('Headers:', error.headers);
            console.error('Error Response:', error.error);
            
            // Log more details for common error statuses
            if (error.status === 0) {
              console.error('Network error - is the backend running?');
            } else if (error.status === 404) {
              console.error('Endpoint not found - check the URL and backend routes');
            } else if (error.status === 401 || error.status === 403) {
              console.error('Authentication/Authorization error - check your auth token');
            }
          } else {
            console.error('Full Error:', error);
          }
          console.groupEnd();
        }
      }),
      catchError((error: HttpErrorResponse) => {
        // Log the full error object for debugging shape
        console.error('==== [aVDSvc fD catchError] Raw error object passed to catchError ====', error);
        console.error(`aVDSvc fD [${requestId}] HTTP Error Intercepted:`, {
          name: error.name,
          message: error.message,
          status: error.status,
          statusText: error.statusText,
          url: error.url,
          error: error.error
        });

        let errorMessage: string | undefined = undefined;

        // 1. Backend-propagated error (from AV gateway)
        if (error.error && typeof error.error === 'object') {
          if (typeof error.error.error === 'string' && error.error.error.trim()) {
            errorMessage = error.error.error;
          } else if (typeof error.error.message === 'string' && error.error.message.trim()) {
            errorMessage = error.error.message;
          }
        }
        // 2. Raw error string from backend (sometimes error.error is a string)
        else if (typeof error.error === 'string' && error.error.trim()) {
          errorMessage = error.error;
        }
        // 3. Top-level error.message (sometimes gateway puts it here)
        else if (typeof error.message === 'string' && error.message.trim() && error.message !== `Http failure response for ${error.url}: ${error.status} ${error.statusText}`) {
          errorMessage = error.message;
        }
        // 4. Network error
        else if (error.status === 0) {
          errorMessage = 'Network error - could not connect to the Alpha Vantage proxy server.';
        }
        // 5. Client-side error event
        else if (error.error instanceof ErrorEvent) {
          errorMessage = `Client-side error: ${error.error.message}`;
        }
        // 6. HTTP error with status
        else if (error.status) {
          errorMessage = `Server returned ${error.status}: ${error.statusText || 'Unknown status'}`;
        }
        // 7. Fallback
        else {
          errorMessage = 'avDSvc fD Unexpected error: No further information available. Check network and backend logs.';
        }

        return throwError(() => ({
          ok: false,
          error: errorMessage,
          status: error.status,
          statusText: error.statusText,
          originalError: error
        }));
      })
    );
  }

  /**
   * Handles HTTP errors
   */
  private handleError(error: HttpErrorResponse) {
    let errorMessage = 'An unknown error occurred';
    
    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `aVDSvc fD Error: ${error.error.message}`;
    } else if (error.status) {
      // Server-side error
      errorMessage = `aVDSvc fD Error Code: ${error.status}\nMessage: ${error.message}`;
    }
    
    console.error('aVDSvc fD AlphaVantage API Error:', errorMessage);
    return throwError(() => new Error(errorMessage));
  }
}
