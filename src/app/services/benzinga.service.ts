import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { BenzingaCalendarParams, EarningsResponse } from '../common/common-bz';
import { AuthService } from '../auth/auth.service';
import { StockDataUrl } from '../common/common-app';

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

  private createHttpParams(params: BenzingaCalendarParams): HttpParams {
    let httpParams = new HttpParams();
    const queryParams: Record<string, any> = { ...params };

    // Rename calendarType to type for the API call
    if (queryParams['calendarType']) {
      queryParams['type'] = queryParams['calendarType'];
      delete queryParams['calendarType'];
    }

    for (const key in queryParams) {
      if (Object.prototype.hasOwnProperty.call(queryParams, key)) {
        const value = queryParams[key];
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, value.toString());
        }
      }
    }
    return httpParams;
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
