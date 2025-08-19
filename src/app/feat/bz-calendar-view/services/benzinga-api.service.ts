import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError, switchMap, map, tap } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
// TODO: Use shared response object instead of fe-common-bz-api
import { getBenzingaEndpointUrl, BenzingaApiResponse } from '../common/fe-common-bz-api';
import { 
  BenzingaCalendarParameter, 
  BZ_CALENDAR_PARAMETER_DEFS, 
  BZ_CALENDAR_REQUEST_CONFIGS, 
  BzCalendarRequestType,
  BenzingaRequestConfig
} from '@shared/benzinga';

@Injectable({
  providedIn: 'root'
})
export class BenzingaApiService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  
  /**
   * Fetch data for a Benzinga calendar request
   * @param params The query parameters for the request
   * @returns Observable with the API response
   */
  fetchData<T>(params: Record<string, any>): Observable<T> {
    return this.getAuthHeaders().pipe(
      switchMap((headers) => {
        // Get the endpoint type from params
        const endpointType = params['type'] as BzCalendarRequestType;
        
        // Get the endpoint config based on the request type
        const endpointConfig = BZ_CALENDAR_REQUEST_CONFIGS[endpointType];
        if (!endpointConfig) {
          return throwError(() => new Error(`No configuration found for type: ${endpointType}`));
        }

        // Sanitize and prepare parameters - keep the parameters[] format
        const sanitizedParams = this.sanitizeParams(params, endpointConfig);
        
        // Get the base URL and construct the full URL
        const baseUrl = getBenzingaEndpointUrl();
        const fullUrl = `${baseUrl}${endpointConfig.apiEndpoint}`;
        
        // Use HttpParams to properly encode the parameters with brackets
        let httpParams = new HttpParams();
        
        // Add all other parameters
        Object.entries(sanitizedParams).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            // Convert array values to comma-separated strings
            const paramValue = Array.isArray(value) ? value.join(',') : String(value);
            httpParams = httpParams.set(key, paramValue);
          }
        });
        
        console.log('Making request to:', fullUrl, 'with params:', httpParams.toString());
        
        // Keep Authorization header for backend authentication; backend will inject Benzinga token itself
        const newHeaders = headers;
        
        return this.http.get<BenzingaApiResponse<T>>(fullUrl, { 
          headers: newHeaders,
          params: httpParams,
          responseType: 'json'
        }).pipe(
          tap(response => console.log('bASvc fD API response:', response)),
          map(response => {
            if (response && typeof response === 'object' && 'data' in response) {
              if (!('ok' in response) || response.ok === true) {
                return response.data;
              }
              throw new Error(response.error || 'API request failed');
            }
            console.warn('bASvc fD unexpected API response:', response);
            return response as unknown as T;
          }),
          catchError(this.handleError)
        );
      })
    );
  }

  /**
   * Sanitize and prepare parameters for the API request
   * @param params The raw parameters from the form
   * @param config The endpoint configuration
   * @returns Sanitized parameters
   */
  private sanitizeParams(params: Record<string, any>, config: BenzingaRequestConfig): Record<string, any> {
    const sanitized: Record<string, any> = {};
    
    // Only include parameters that are defined in the endpoint's parameterKeys
    const validParamKeys = config.parameterKeys || [];
    
    for (const key of validParamKeys) {
      if (params[key] !== undefined && params[key] !== '') {
        sanitized[key] = params[key];
      }
    }
    
    return sanitized;
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
   * Handle API errors
   * @private
   */
  private handleError(error: HttpErrorResponse) {
    // Build a richer error message including backend-provided details
    const status = error.status;
    const statusText = error.statusText || '';
    const backend = (error?.error && typeof error.error === 'object') ? error.error as Record<string, any> : null;

    const parts: string[] = [];
    if (status || statusText) {
      parts.push(`HTTP ${status || 'N/A'} ${statusText}`.trim());
    }
    if (backend?.['error']) {
      parts.push(String(backend['error']));
    }
    // Prefer backend.message; fall back to string error bodies
    const backendMsg = backend?.['message'] || (typeof error.error === 'string' ? error.error : '');
    if (backendMsg) {
      parts.push(String(backendMsg));
    }
    // Append details if provided by backend (array, string, or object)
    const details = backend?.['details'];
    if (details !== undefined) {
      const detailsStr = Array.isArray(details)
        ? details.join('; ')
        : typeof details === 'string'
        ? details
        : JSON.stringify(details);
      parts.push(`details: ${detailsStr}`);
    }

    const message = parts.filter(Boolean).join(' | ') || 'An unknown error occurred';

    console.error('fe bAScv hE:Benzinga API Error:', {
      url: error.url,
      status,
      statusText,
      message,
      raw: error
    });
    return throwError(() => new Error(message));
  }
}
