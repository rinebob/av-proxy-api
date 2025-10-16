import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { HealthFunctionName } from '../common/fe-common-fn';

// Shared types (ensure tsconfig paths map '@shared/*' to project shared/)
import type { HealthSummary, HealthMetricsFilter, HealthMetricsResponse, RefreshRequestLog, SymbolStatus, SymbolRefreshMetrics } from '@shared/health-metrics';
import { API_BASES, type ApiBases } from '../core/api/api.tokens';

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
  private readonly apiBases = inject(API_BASES);
  private readonly baseUrl: string = this.apiBases.health;

  // ---- Public API ----

  /** Fetch aggregated dashboard summary */
  getHealthSummary(): Observable<HealthSummary> {
    const url = this.joinUrl(this.baseUrl, HealthFunctionName.GET_HEALTH_SUMMARY);
    return this.http.get<{ success: boolean; data: HealthSummary }>(url).pipe(
      map((res) => res.data)
    );
  }

  /** Fetch paginated request logs with filters */
  getRequestLogs(filter: HealthMetricsFilter = {}): Observable<HealthMetricsResponse<RefreshRequestLog>> {
    const url = this.joinUrl(this.baseUrl, HealthFunctionName.GET_REQUEST_LOGS);
    const params = this.buildLogsParams(filter);
    return this.http
      .get<{ success: boolean; data: HealthMetricsResponse<RefreshRequestLog> }>(url, { params })
      .pipe(
        map((res) => ({
          data: res.data.data,
          total: res.data.total,
          limit: res.data.limit,
          offset: res.data.offset,
          hasMore: res.data.hasMore,
        }))
      );
  }

  /** Fetch latest symbol status (across endpoints) */
  getSymbolStatus(symbol: string): Observable<SymbolStatus | null> {
    const url = this.joinUrl(this.baseUrl, HealthFunctionName.GET_SYMBOL_STATUS_V2);
    const params = new HttpParams().set('symbol', symbol.toUpperCase());
    return this.http
      .get<{ success: boolean; data: SymbolStatus | null }>(url, { params })
      .pipe(map((res) => res.data ?? null));
  }

  /** Fetch aggregated metrics for a symbol */
  getSymbolMetrics(symbol: string): Observable<SymbolRefreshMetrics | null> {
    const url = this.joinUrl(this.baseUrl, HealthFunctionName.GET_SYMBOL_METRICS_V2);
    const params = new HttpParams().set('symbol', symbol.toUpperCase());
    return this.http
      .get<{ success: boolean; data: SymbolRefreshMetrics | null }>(url, { params })
      .pipe(map((res) => res.data ?? null));
  }

  // ---- Internal helpers ----

  private joinUrl(base: string, path: string): string {
    const sep = base.endsWith('/') ? '' : '/';
    return `${base}${sep}${path}`;
  }

  /**
   * Build query params for getRequestLogs(). Backend expects:
   * - endpointIds: CSV
   * - symbols: CSV
   * - from/to: ISO strings
   * - sortBy: 'timestamp' | 'symbol' | ... (enum string values)
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
