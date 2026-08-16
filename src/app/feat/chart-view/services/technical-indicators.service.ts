import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { API_BASES, type ApiBases } from '../../../core/api/api.tokens';
import { PartnerFunctionName } from '../../../common/fe-common-fn';
import { HtIndicator, PriceSeries, TimeSeriesInterval } from '@shared/alpha-vantage';

/**
 * Response envelope from partnerTechnicalIndicatorsV2.
 */
export interface TechnicalIndicatorResponse {
  ok: boolean;
  symbol: string;
  indicator: string;
  interval: string;
  series_type: string;
  data: Record<string, Record<string, string>>;
  timestamp: string;
  processingTimeMs: number;
}

/**
 * Error response from partnerTechnicalIndicatorsV2.
 */
export interface TechnicalIndicatorErrorResponse {
  ok: false;
  error: string;
  code: string;
  timestamp: string;
  validIndicators?: string[];
}

/**
 * Parameters for fetching a technical indicator.
 */
export interface TechnicalIndicatorParams {
  symbol: string;
  indicator: HtIndicator;
  interval: TimeSeriesInterval;
  series_type: PriceSeries;
}

/**
 * TechnicalIndicatorsService
 *
 * Calls the deployed partnerTechnicalIndicatorsV2 Cloud Function endpoint
 * to fetch exact Alpha Vantage Hilbert Transform indicator values.
 *
 * The endpoint supports dual-auth (OIDC/Firebase ID tokens). The auth
 * interceptor adds the Firebase ID token automatically.
 */
@Injectable({ providedIn: 'root' })
export class TechnicalIndicatorsService {
  private readonly http = inject(HttpClient);
  private readonly apiBases = inject(API_BASES);
  private readonly baseUrl: string = this.apiBases.partner;

  /**
   * Fetch a technical indicator from the partner endpoint.
   *
   * @param params.symbol - Stock symbol (e.g., 'IBM')
   * @param params.indicator - HT indicator key (e.g., HtIndicator.HT_TRENDLINE)
   * @param params.interval - Time series interval (daily/weekly/monthly)
   * @param params.series_type - Price series (close/open/high/low)
   * @returns Observable of the response envelope with date-keyed indicator data
   */
  getTechnicalIndicator(params: TechnicalIndicatorParams): Observable<TechnicalIndicatorResponse> {
    const url = this.joinUrl(this.baseUrl, PartnerFunctionName.PARTNER_TECHNICAL_INDICATORS_V2);

    return this.http
      .get<TechnicalIndicatorResponse>(url, {
        params: {
          symbol: params.symbol,
          indicator: params.indicator,
          interval: params.interval,
          series_type: params.series_type,
        },
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          const errorBody = error.error as TechnicalIndicatorErrorResponse | string;
          const message = typeof errorBody === 'string'
            ? errorBody
            : errorBody?.error || `HTTP ${error.status}: ${error.statusText}`;
          return throwError(() => ({
            status: error.status,
            message,
            code: typeof errorBody === 'object' ? errorBody?.code : undefined,
          }));
        })
      );
  }

  // ---- Internal helpers ----

  private joinUrl(base: string, path: string): string {
    const sep = base.endsWith('/') ? '' : '/';
    return `${base}${sep}${path}`;
  }
}
