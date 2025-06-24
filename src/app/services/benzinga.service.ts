import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { Observable, from, switchMap, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

export interface EarningsParams {
  page?: number;
  pagesize?: number;
  date_from?: string;
  date_to?: string;
  tickers?: string;
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
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  
  // Use the correct endpoint for the Cloud Function
  private readonly BASE_URL = environment.production 
    ? 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/getBenzingaCalendar'
    : 'http://localhost:5001/alpha-vantage-proxy-api/us-central1/getBenzingaCalendar';

  private getAuthHeaders() {
    return from(this.authService.getCurrentToken()).pipe(
      map(token => {
        if (!token) {
          throw new Error('No authentication token available');
        }
        return {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-debug-request': 'true'
        };
      })
    );
  }

  /**
   * Fetches earnings calendar data from the Benzinga API via Cloud Function
   * @param params Query parameters for the API call
   * @returns Observable with the API response
   */
  getEarnings(params: EarningsParams): Observable<EarningsResponse> {
    // Create a copy of params to avoid modifying the original
    const queryParams: EarningsParams = {
      type: 'earnings',
      pagesize: 10,
      ...params,
      // Ensure tickers is a comma-separated string if it's an array
      tickers: Array.isArray(params.tickers) 
        ? params.tickers.join(',') 
        : params.tickers
    };

    // Get the auth token and make the request
    return this.getAuthHeaders().pipe(
      switchMap(headers => {
        // Convert the params to HttpParams
        let httpParams = new HttpParams();
        Object.entries(queryParams).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            httpParams = httpParams.set(key, value.toString());
          }
        });

        return this.http.get<EarningsResponse>(this.BASE_URL, {
          params: httpParams,
          headers: headers
        });
      })
    );
  }
}
