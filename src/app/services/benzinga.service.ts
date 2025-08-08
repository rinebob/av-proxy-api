import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import type { EarningsResponse } from '../common/fe-common-bz';
import { BenzingaCalendarParams } from '../common/fe-common-bz';
import { AuthService } from '../core/auth/auth.service';
import { StockDataUrl } from '../common/fe-common-app';

@Injectable({
  providedIn: 'root'
})
export class BenzingaService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  getDynamicCalendar(params: BenzingaCalendarParams): Observable<EarningsResponse> {
    const url = StockDataUrl.GET_DYNAMIC_CALENDAR;
    return this.makeAuthenticatedRequest(url, params);
  }

  private makeAuthenticatedRequest(url: string, params: BenzingaCalendarParams): Observable<EarningsResponse> {
    return this.getAuthHeaders().pipe(
      switchMap(headers => {
        const httpParams = this.createHttpParams(params);
        return this.http.get<EarningsResponse>(url, { headers, params: httpParams });
      }),
      catchError(this.handleError)
    );
  }

  private createHttpParams(queryParams: any): HttpParams {
    let params = new HttpParams();

    for (const key in queryParams) {
      if (queryParams.hasOwnProperty(key) && queryParams[key] !== undefined && queryParams[key] !== null) {
        // If the key is 'tickers', join the array into a comma-separated string
        if (key === 'tickers') {
          params = params.set(key, queryParams[key].join(','));
        } else {
          params = params.set(key, queryParams[key].toString());
        }
      }
    }
    return params;
  }

  private getAuthHeaders(): Observable<HttpHeaders> {
    return this.authService.idToken$.pipe(
      map(token => {
        if (!token) {
          throw new Error('No authentication token available');
        }
        return new HttpHeaders({
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        });
      })
    );
  }

  private handleError(error: HttpErrorResponse) {
    console.error('Benzinga Service Error:', error);
    return throwError(() => new Error('Failed to fetch data from Benzinga service.'));
  }
}
