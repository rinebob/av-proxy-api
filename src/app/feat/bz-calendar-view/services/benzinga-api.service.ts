import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, throwError, switchMap, map, tap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { BenzingaEndpoint, BenzingaCalendarParams } from '../../../common/fe-common-bz';
import { getBenzingaEndpointUrl, BenzingaApiResponse } from '../common/fe-common-bz-api';

@Injectable({
  providedIn: 'root'
})
export class BenzingaApiService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  
  /**
   * Fetch data from a Benzinga endpoint
   * @param endpoint The Benzinga endpoint to call
   * @param params Query parameters for the request
   * @returns Observable with the API response
   */
  fetchData<T>(endpoint: BenzingaEndpoint, params: BenzingaCalendarParams): Observable<T> {
    return this.getAuthHeaders().pipe(
      switchMap(headers => {
        const url = getBenzingaEndpointUrl(endpoint);
        console.log('Making request to:', url, 'with params:', params);
        
        return this.http.get<BenzingaApiResponse<T>>(url, { 
          headers,
          params: this.sanitizeParams(params),
          responseType: 'json'
        }).pipe(
          tap(response => console.log('API response:', response)),
          map(response => {
            // Type guard to ensure the response has the expected structure
            if (response && typeof response === 'object' && 'data' in response) {
              if (!('ok' in response) || response.ok === true) {
                return response.data;
              }
              throw new Error(response.error || 'API request failed');
            }
            // If we get here, the response doesn't match our expected structure
            console.warn('Unexpected API response format:', response);
            // Try to return the response as-is in case it's the direct data
            return response as unknown as T;
          }),
          catchError(this.handleError)
        );
      })
    );
  }

  /**
   * Get authentication headers with the current user's ID token
   * @private
   */
  private getAuthHeaders(): Observable<HttpHeaders> {
    return this.authService.idToken$.pipe(
      map(token => {
        if (!token) {
          throw new Error('No authentication token available');
        }
        return new HttpHeaders({
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        });
      })
    );
  }

  /**
   * Sanitize and prepare parameters for the API request
   * @private
   */
  private sanitizeParams(params: any): { [key: string]: string | number | boolean } {
    // Remove any undefined or null values
    return Object.entries(params).reduce((acc, [key, value]) => {
      if (value !== undefined && value !== null) {
        acc[key] = value;
      }
      return acc;
    }, {} as { [key: string]: any });
  }

  /**
   * Handle API errors
   * @private
   */
  private handleError(error: HttpErrorResponse) {
    let errorMessage = 'An unknown error occurred';
    
    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `Error: ${error.error.message}`;
    } else {
      // Server-side error
      if (error.status === 401) {
        errorMessage = 'Authentication failed. Please log in again.';
      } else if (error.status === 403) {
        errorMessage = 'You do not have permission to access this resource.';
      } else if (error.status === 429) {
        errorMessage = 'Too many requests. Please try again later.';
      } else if (error.status >= 500) {
        errorMessage = 'Server error. Please try again later.';
      }
      
      // Try to get error details from the response
      if (error.error?.error) {
        errorMessage = error.error.error;
      } else if (error.error?.message) {
        errorMessage = error.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }
    }
    
    console.error('fe bAScv hE:Benzinga API Error:', error);
    return throwError(() => new Error(errorMessage));
  }
}
