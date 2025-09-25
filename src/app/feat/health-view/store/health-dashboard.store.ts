import { inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed } from '@angular/core';
import { take, catchError, finalize } from 'rxjs/operators';
import { of, forkJoin } from 'rxjs';

import type { HealthSummary, HealthMetricsFilter, HealthMetricsResponse, RefreshRequestLog, SymbolStatus, SymbolRefreshMetrics } from '@shared/health-metrics';
import { HealthMetricsSortBy, SortOrder } from '@shared/health-metrics';
import { HealthMetricsApiService } from '../../../services/health-metrics-api.service';

// State shape for the Health Dashboard
export interface HealthDashboardState {
  summary: HealthSummary | undefined;

  // Logs payload mirrors backend response for pagination
  logs: HealthMetricsResponse<RefreshRequestLog>;

  // Current filters for logs
  filters: HealthMetricsFilter;

  // UI state
  loadingSummary: boolean;
  loadingLogs: boolean;
  errorSummary: string; // non-optional: use empty string when no error
  errorLogs: string; // non-optional: use empty string when no error

  // Symbol detail state (non-optional signals; values may be undefined)
  selectedSymbol: string | undefined;
  symbolStatus: SymbolStatus | null | undefined;
  symbolMetrics: SymbolRefreshMetrics | null | undefined;
  loadingSymbol: boolean;
  errorSymbol: string;
}

const initialState: HealthDashboardState = {
  summary: undefined,
  logs: {
    data: [],
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false,
  },
  filters: {
    // Explicitly use enums for typing correctness
    sortBy: HealthMetricsSortBy.Timestamp,
    sortOrder: SortOrder.Desc,
    limit: 50,
    offset: 0,
  },
  loadingSummary: false,
  loadingLogs: false,
  errorSummary: '',
  errorLogs: '',
  // symbol detail
  selectedSymbol: undefined,
  symbolStatus: undefined,
  symbolMetrics: undefined,
  loadingSymbol: false,
  errorSymbol: '',
};

export const HealthDashboardStore = signalStore(
  { providedIn: 'root' },
  withState<HealthDashboardState>(initialState),
  withComputed((store) => ({
    // Derived flags
    isBusy: computed(() => store.loadingSummary() || store.loadingLogs()),
    hasSummary: computed(() => !!store.summary()),
    logsCount: computed(() => store.logs().data.length),
    hasSelectedSymbol: computed(() => !!store.selectedSymbol()),
  })),
  withMethods((store, api = inject(HealthMetricsApiService)) => ({
    // Load the aggregated summary
    loadSummary(): void {
      const ts = new Date().toISOString();
      console.log('[HealthStore] loadSummary() called', { ts });
      patchState(store, { loadingSummary: true, errorSummary: '' });
      api
        .getHealthSummary()
        .pipe(
          take(1),
          catchError((err) => {
            console.error('[HealthStore] loadSummary() error', { ts, error: err?.message });
            patchState(store, { errorSummary: err?.message || 'Failed to load summary' });
            return of(undefined as unknown as HealthSummary);
          }),
          finalize(() => patchState(store, { loadingSummary: false }))
        )
        .subscribe((summary) => {
          console.log('[HealthStore] loadSummary() success', { ts, hasSummary: !!summary });
          if (summary) patchState(store, { summary });
        });
    },

    // Load paginated logs using current filters from state
    loadLogs(partial?: Partial<HealthMetricsFilter>): void {
      const ts = new Date().toISOString();
      console.log('[HealthStore] loadLogs() called', { ts, partial });
      const mergedFilters: HealthMetricsFilter = {
        ...store.filters(),
        ...(partial || {}),
      };

      // Ensure limit/offset are synced to state
      const limit = typeof mergedFilters.limit === 'number' ? mergedFilters.limit : initialState.logs.limit;
      const offset = typeof mergedFilters.offset === 'number' ? mergedFilters.offset : initialState.logs.offset;

      patchState(store, {
        loadingLogs: true,
        errorLogs: '',
        filters: { ...mergedFilters, limit, offset },
      });

      console.log('[HealthStore] loadLogs() request', { ts, filters: { ...mergedFilters, limit, offset } });
      api
        .getRequestLogs({ ...mergedFilters, limit, offset })
        .pipe(
          take(1),
          catchError((err) => {
            console.error('[HealthStore] loadLogs() error', { ts, error: err?.message });
            patchState(store, { errorLogs: err?.message || 'Failed to load logs' });
            return of({ ...initialState.logs });
          }),
          finalize(() => patchState(store, { loadingLogs: false }))
        )
        .subscribe((resp) => {
          console.log('[HealthStore] loadLogs() success', { ts, count: resp?.data?.length ?? 0, total: resp?.total });
          patchState(store, { logs: resp });
        });
    },

    // Update filters (does not auto-load)
    setFilters(filters: Partial<HealthMetricsFilter>): void {
      const ts = new Date().toISOString();
      const merged = { ...store.filters(), ...filters } as HealthMetricsFilter;
      console.log('[HealthStore] setFilters()', { ts, filters: merged });
      patchState(store, { filters: merged });
    },

    // Pagination helpers for logs
    setPage(offset: number): void {
      const f = store.filters();
      console.log('[HealthStore] setPage()', { offset, limit: f.limit });
      this.loadLogs({ offset, limit: f.limit });
    },

    setPageSize(limit: number): void {
      const f = store.filters();
      console.log('[HealthStore] setPageSize()', { limit, prevLimit: f.limit });
      // Reset to first page when page size changes
      this.loadLogs({ limit, offset: 0, sortBy: f.sortBy, sortOrder: f.sortOrder });
    },

    // Convenience to refresh both summary and logs
    refreshAll(): void {
      const ts = new Date().toISOString();
      console.log('[HealthStore] refreshAll() start', { ts });
      this.loadSummary();
      this.loadLogs();
      console.log('[HealthStore] refreshAll() queued', { ts });
    },

    // ---------------- Symbol Detail ----------------
    selectSymbol(symbol: string): void {
      const sym = (symbol || '').toUpperCase();
      if (!sym) return;
      patchState(store, { selectedSymbol: sym });
      this.loadSymbolDetail(sym);
    },

    clearSelectedSymbol(): void {
      patchState(store, { selectedSymbol: undefined, symbolStatus: undefined, symbolMetrics: undefined, errorSymbol: '' });
    },

    loadSymbolDetail(symbol: string): void {
      const sym = (symbol || '').toUpperCase();
      if (!sym) return;
      patchState(store, { loadingSymbol: true, errorSymbol: '' });

      forkJoin({
        status: api.getSymbolStatus(sym).pipe(take(1), catchError(() => of(null))),
        metrics: api.getSymbolMetrics(sym).pipe(take(1), catchError(() => of(null))),
      })
        .pipe(finalize(() => patchState(store, { loadingSymbol: false })))
        .subscribe(({ status, metrics }) => {
          patchState(store, { symbolStatus: status, symbolMetrics: metrics });
        });
    },
  }))
);
