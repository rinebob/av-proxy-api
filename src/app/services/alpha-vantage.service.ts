import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, switchMap, map } from 'rxjs/operators';

// TODO: Refactor StockData to support V2
import { DailyStockParams, GlobalQuoteParams } from '../common/fe-common-av';
import { AuthService } from '../core/auth/auth.service';
import { StockDataUrl } from '../common/fe-common-app';

@Injectable({
  providedIn: 'root'
})
export class AlphaVantageService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  getDailyStockData(params: DailyStockParams): Observable<any> {
    const url = StockDataUrl.DAILY_STOCK_DATA_SIMPLE;
    return this.makeAuthenticatedRequest(url, params);
  }

  getGlobalQuote(params: GlobalQuoteParams): Observable<any> {
    const url = StockDataUrl.GET_GLOBAL_QUOTE;
    return this.makeAuthenticatedRequest(url, params);
  }

  private makeAuthenticatedRequest(url: string, params: any): Observable<any> {
    return this.getAuthHeaders().pipe(
      switchMap(headers => {
        const httpParams = Object.entries(params).reduce((p, [key, value]) => {
          return value ? p.set(key, String(value)) : p;
        }, new HttpParams());

        return this.http.get(url, { headers, params: httpParams });
      }),
      catchError(this.handleError)
    );
  }

  private getAuthHeaders(): Observable<HttpHeaders> {
    return this.authService.idToken$.pipe(
      map(token => {
        if (!token) {
          throw new Error('No authentication token available');
        }
        return new HttpHeaders({
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        });
      })
    );
  }

  private handleError(error: HttpErrorResponse) {
    console.error('AlphaVantage Service Error:', error);
    return throwError(() => new Error('Failed to fetch data from AlphaVantage service.'));
  }
}
