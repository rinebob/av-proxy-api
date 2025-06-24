import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';

/**
 * Response structure for the company logo API
 */
export interface CompanyLogoResponse {
  logo: string; // URL to the company logo
  ticker: string;
  name: string;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class BenzingaLogoService {
  private http = inject(HttpClient);
  
  // Updated to use our backend endpoint
  private readonly BASE_URL = '/api/benzinga/logo';

  /**
   * Fetches company logo for a given ticker
   * @param ticker Stock ticker symbol (e.g., 'AAPL')
   * @returns Observable with the logo URL and company info
   */
  getCompanyLogo(ticker: string): Observable<CompanyLogoResponse> {
    const params = new HttpParams()
      .set('ticker', ticker.toUpperCase());

    return this.http.get<CompanyLogoResponse>(this.BASE_URL, { params }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Error fetching company logo:', error);
        return of({
          logo: '',
          ticker,
          name: ticker,
          error: error.error?.error || 'Failed to fetch company logo'
        });
      })
    );
  }

  /**
   * Fetches multiple company logos in parallel
   * @param tickers Array of stock ticker symbols
   * @returns Observable with array of logo responses
   */
  getCompanyLogos(tickers: string[]): Observable<CompanyLogoResponse[]> {
    if (!tickers || tickers.length === 0) {
      return of([]);
    }

    // Create an array of observables for each ticker
    const logoObservables = tickers.map(ticker => this.getCompanyLogo(ticker));

    // Use forkJoin to execute all requests in parallel
    return forkJoin(logoObservables).pipe(
      catchError(error => {
        console.error('Error in batch logo fetch:', error);
        return of(tickers.map(ticker => ({
          logo: '',
          ticker,
          name: ticker,
          error: 'Failed to fetch one or more logos'
        })));
      })
    );
  }
}
