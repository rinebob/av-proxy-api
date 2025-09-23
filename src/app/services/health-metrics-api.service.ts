import { Injectable, InjectionToken, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

// Shared types (ensure tsconfig paths map '@shared/*' to project shared/)
import type { HealthSummary, HealthMetricsFilter, HealthMetricsResponse, RefreshRequestLog, SymbolStatus, SymbolRefreshMetrics } from '@shared/health-metrics';

/**
 * Injection token for the base URL to the Health Metrics HTTPS functions.
 * Example values:
 * - Firebase hosted: https://<region>-<project>.cloudfunctions.net
 * - Emulator/local: http://localhost:5001/<project>/<region>
 * - Cloud Run/API Gateway routed path: https://api.example.com/health
 */
export const HEALTH_METRICS_API_BASE_URL = new InjectionToken<string>(
  'HEALTH_METRICS_API_BASE_URL',
  { factory: () => '/api/health' } // safe default if routed via dev proxy
);

/**
 * Injection token providing an auth token observable. The token will be sent as
 * an Authorization: Bearer <token> header. This supports both Firebase ID tokens
 * and Google OIDC tokens, aligning with authenticateRequestEither() on backend.
 */
export const HEALTH_AUTH_TOKEN$ = new InjectionToken<Observable<string | undefined>>(
  'HEALTH_AUTH_TOKEN$',
  { factory: () => of(undefined) }
);

/**
 * HealthMetricsApiService
 *
 * Wraps calls to the Health Metrics Cloud Functions:
 * - GET getHealthSummary
 * - GET getRequestLogs
 * - GET getSymbolStatus
 * - GET getSymbolMetrics
 *
 * Uses RxJS only (no Promises) and Angular's inject() API.
 */
@Injectable({ providedIn: 'root' })
export class HealthMetricsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(HEALTH_METRICS_API_BASE_URL);
  private readonly authToken$ = inject(HEALTH_AUTH_TOKEN$);

  // ---- Public API ----

  /** Fetch aggregated dashboard summary */
  getHealthSummary(): Observable<HealthSummary> {
    const url = this.joinUrl(this.baseUrl, 'getHealthSummary');
    return this.authorizedGet<{ success: boolean; data: HealthSummary }>(url).pipe(
      map((res) => res.data)
    );
  }

  /** Fetch paginated request logs with filters */
  getRequestLogs(filter: HealthMetricsFilter = {}): Observable<HealthMetricsResponse<RefreshRequestLog>> {
    const url = this.joinUrl(this.baseUrl, 'getRequestLogs');
    const params = this.buildLogsParams(filter);
    return this.authorizedGet<{ success: boolean } & HealthMetricsResponse<RefreshRequestLog>>(url, params).pipe(
      map((res) => ({
        data: res.data,
        total: res.total,
        limit: res.limit,
        offset: res.offset,
        hasMore: res.hasMore,
      }))
    );
  }

  /** Fetch latest symbol status (across endpoints) */
  getSymbolStatus(symbol: string): Observable<SymbolStatus | null> {
    const url = this.joinUrl(this.baseUrl, 'getSymbolStatus');
    const params = new HttpParams().set('symbol', symbol.toUpperCase());
    return this.authorizedGet<{ success: boolean; data: SymbolStatus | null }>(url, params).pipe(
      map((res) => res.data ?? null)
    );
  }

  /** Fetch aggregated metrics for a symbol */
  getSymbolMetrics(symbol: string): Observable<SymbolRefreshMetrics | null> {
    const url = this.joinUrl(this.baseUrl, 'getSymbolMetrics');
    const params = new HttpParams().set('symbol', symbol.toUpperCase());
    return this.authorizedGet<{ success: boolean; data: SymbolRefreshMetrics | null }>(url, params).pipe(
      map((res) => res.data ?? null)
    );
  }

  // ---- Internal helpers ----

  /** Perform GET with Authorization header if token is available */
  private authorizedGet<T>(url: string, params?: HttpParams): Observable<T> {
    return this.authToken$.pipe(
      take(1),
      switchMap((token) => {
        const headers = this.buildHeaders(token);
        return this.http.get<T>(url, { headers, params });
      })
    );
  }

  private buildHeaders(token?: string): HttpHeaders {
    let headers = new HttpHeaders();
    if (token) headers = headers.set('Authorization', `Bearer ${token}`);
    return headers;
  }

  private joinUrl(base: string, path: string): string {
    const sep = base.endsWith('/') ? '' : '/';
    return `${base}${sep}${path}`;
  }

  /**
   * Build query params for getRequestLogs(). Backend expects:
   * - endpointIds: CSV
   * - symbols: CSV
   * - from/to: ISO strings
   * - sortBy: 'timestamp' | 'symbol' | ...
   * - sortOrder: 'asc' | 'desc'
   * - limit, offset: numbers
   */
  private buildLogsParams(filter: HealthMetricsFilter): HttpParams {
    let params = new HttpParams();

    const csv = (arr?: string[]) => (arr && arr.length ? arr.join(',') : undefined);

    if (filter.endpointIds?.length) params = params.set('endpointIds', csv(filter.endpointIds)!);
    if (filter.symbols?.length) params = params.set('symbols', csv(filter.symbols)!);

    if (filter.timeRange?.from) params = params.set('from', this.toIso(filter.timeRange.from));
    if (filter.timeRange?.to) params = params.set('to', this.toIso(filter.timeRange.to));

    if (filter.sortBy) params = params.set('sortBy', String(filter.sortBy));
    if (filter.sortOrder) params = params.set('sortOrder', String(filter.sortOrder));

    if (typeof filter.limit === 'number') params = params.set('limit', String(filter.limit));
    if (typeof filter.offset === 'number') params = params.set('offset', String(filter.offset));

    return params;
  }

  private toIso(d: any): string {
    // Accept Date or Firestore Timestamp-like with toDate()
    if (d && typeof d.toDate === 'function') return d.toDate().toISOString();
    if (d instanceof Date) return d.toISOString();
    return new Date(d).toISOString();
  }
}
