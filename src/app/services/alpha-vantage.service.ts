import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, switchMap, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { AlphaVantageFunctionName } from '../common/common-fn';

export interface DailyStockParams {
  symbol: string;
  outputsize?: 'compact' | 'full';
}

export interface GlobalQuoteParams {
  symbol: string;
}

@Injectable({
  providedIn: 'root'
})
export class AlphaVantageService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private readonly baseUrl = environment.functionsBaseUrl;

  getDailyStockData(params: DailyStockParams): Observable<any> {
    const functionName = AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE;
    return this.makeAuthenticatedRequest(functionName, params);
  }

  getGlobalQuote(params: GlobalQuoteParams): Observable<any> {
    const functionName = AlphaVantageFunctionName.GET_GLOBAL_QUOTE;
    return this.makeAuthenticatedRequest(functionName, params);
  }

  private makeAuthenticatedRequest(functionName: string, params: any): Observable<any> {
    return this.getAuthHeaders().pipe(
      switchMap(headers => {
        const httpParams = this.createHttpParams(params);
        return this.http.get<any>(`${this.baseUrl}/${functionName}`, { headers, params: httpParams }).pipe(
          catchError(this.handleError)
        );
      })
    );
  }

  private createHttpParams(params: any): HttpParams {
    let httpParams = new HttpParams();
    for (const key in params) {
      if (params.hasOwnProperty(key) && params[key] !== undefined && params[key] !== null) {
        httpParams = httpParams.set(key, params[key].toString());
      }
    }
    return httpParams;
  }

  private getAuthHeaders(): Observable<HttpHeaders> {
    return from(this.authService.getCurrentToken()).pipe(
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
