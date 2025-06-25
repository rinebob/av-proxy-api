import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { EarningsParams, EarningsResponse } from '../common/common-bz';
import { AuthService } from '../auth/auth.service';
import { StockDataUrl } from '../common/common-app';

@Injectable({
  providedIn: 'root'
})
export class BenzingaService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  getEarningsCalendar(params: EarningsParams): Observable<EarningsResponse> {
    const url = StockDataUrl.GET_BENZINGA_CALENDAR;
    return this.makeAuthenticatedRequest(url, params);
  }

  private makeAuthenticatedRequest(url: string, params: EarningsParams): Observable<EarningsResponse> {
    return this.getAuthHeaders().pipe(
      switchMap(headers => {
        const httpParams = this.createHttpParams(params);
        return this.http.get<EarningsResponse>(url, { headers, params: httpParams });
      }),
      catchError(this.handleError)
    );
  }

  private createHttpParams(params: EarningsParams): HttpParams {
    let httpParams = new HttpParams();
    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        const value = (params as any)[key];
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
