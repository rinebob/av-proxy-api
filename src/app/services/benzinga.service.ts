import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Observable, from, switchMap, map, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

export interface EarningsParams {
  tickers: string | string[];
  date_from?: string;
  date_to?: string;
  page?: number;
  pagesize?: number;
  type?: string;
}

export interface EarningsResponse {
  earnings: EarningsItem[];
  next_url?: string;
  previous_url?: string | null;
  count: number;
  status: string;
  message?: string;
}

export interface EarningsItem {
  date: string;
  time: string;
  ticker: string;
  exchange: string;
  name: string;
  period: string;
  eps_est: number | null;
  eps_act: number | null;
  eps_surprise: number | null;
  eps_surprise_percent: number | null;
  revenue_est: number | null;
  revenue_act: number | null;
  revenue_surprise: number | null;
  revenue_surprise_percent: number | null;
  updated: string;
  currency: string;
  conference_call: boolean;
  conference_call_time: string | null;
  conference_call_url: string | null;
  conference_call_phone: string | null;
  conference_call_passcode: string | null;
  updated_at: string;
  id: string;
  importance: number;
  notes: string | null;
  updated_by: string;
  created_at: string;
  fiscal_year: string;
  fiscal_quarter: string;
  fiscal_period: string;
}

@Injectable({
  providedIn: 'root'
})
export class BenzingaService {
  private http: HttpClient;
  private authService: AuthService;
  
  // Base URL for Cloud Functions
  private readonly BASE_URL = environment.functionsBaseUrl;

  private readonly DEFAULT_PAGE_SIZE = 20;
  private readonly MAX_YEARS_BACK = 10; // Maximum years to look back for historical data

  constructor(http: HttpClient, authService: AuthService) {
    this.http = http;
    this.authService = authService;
  }

  /**
   * Get earnings calendar data with pagination and date range support
   */
  getEarningsCalendar(params: {
    tickers: string | string[],
    startDate?: Date,
    endDate?: Date,
    page?: number,
    pageSize?: number
  }): Observable<any> {
    // Use provided dates or default to last 30 days
    const endDate = params.endDate || new Date();
    const startDate = params.startDate || new Date();
    startDate.setDate(endDate.getDate() - 30); // Default to last 30 days if no dates provided

    // Format dates as YYYY-MM-DD
    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    // Use date_from and date_to to match Cloud Function expectations
    const queryParams: any = {
      tickers: Array.isArray(params.tickers) ? params.tickers.join(',') : params.tickers,
      date_from: formatDate(startDate),
      date_to: formatDate(endDate),
      page: params.page || 1,
      pagesize: params.pageSize || this.DEFAULT_PAGE_SIZE,
      type: 'earnings'
    };

    console.log('BenzingaService - Query params:', queryParams);
    
    return this.getAuthHeaders().pipe(
      switchMap(headers => {
        return this.http.get<EarningsResponse>(`${this.BASE_URL}/getBenzingaCalendar`, {
          params: queryParams,
          headers
        }).pipe(
          catchError((error: HttpErrorResponse) => {
            console.error('Benzinga API Error:', error);
            return throwError(() => new Error('Failed to fetch earnings data'));
          })
        );
      })
    );
  }

  /**
   * Get maximum available historical data for a ticker
   */
  getFullEarningsHistory(ticker: string): Observable<any> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - this.MAX_YEARS_BACK);

    return this.getEarningsCalendar({
      tickers: ticker,
      startDate,
      endDate,
      page: 1,
      pageSize: 100 // Request more items per page for full history
    });
  }

  /**
   * Convert params to HttpParams
   */
  private createHttpParams(params: any): HttpParams {
    let httpParams = new HttpParams();
    
    Object.keys(params).forEach(key => {
      const value = params[key];
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          // Handle array values (e.g., multiple tickers)
          httpParams = httpParams.set(key, value.join(','));
        } else {
          httpParams = httpParams.set(key, value.toString());
        }
      }
    });

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
}
