import { inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed } from '@angular/core';
import { take, catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

import type { HealthSummary, HealthMetricsFilter, HealthMetricsResponse, RefreshRequestLog } from '@shared/health-metrics';
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
  errorSummary?: string;
  errorLogs?: string;
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
  errorSummary: undefined,
  errorLogs: undefined,
};

export const HealthDashboardStore = signalStore(
  { providedIn: 'root' },
  withState<HealthDashboardState>(initialState),
  withComputed((store) => ({
    // Derived flags
    isBusy: computed(() => store.loadingSummary() || store.loadingLogs()),
    hasSummary: computed(() => !!store.summary()),
    logsCount: computed(() => store.logs().data.length),
  })),
  withMethods((store, api = inject(HealthMetricsApiService)) => ({
    // Load the aggregated summary
    loadSummary(): void {
      patchState(store, { loadingSummary: true, errorSummary: undefined });
      api
        .getHealthSummary()
        .pipe(
          take(1),
          catchError((err) => {
            patchState(store, { errorSummary: err?.message || 'Failed to load summary' });
            return of(undefined as unknown as HealthSummary);
          }),
          finalize(() => patchState(store, { loadingSummary: false }))
        )
        .subscribe((summary) => {
          if (summary) patchState(store, { summary });
        });
    },

    // Load paginated logs using current filters from state
    loadLogs(partial?: Partial<HealthMetricsFilter>): void {
      const mergedFilters: HealthMetricsFilter = {
        ...store.filters(),
        ...(partial || {}),
      };

      // Ensure limit/offset are synced to state
      const limit = typeof mergedFilters.limit === 'number' ? mergedFilters.limit : initialState.logs.limit;
      const offset = typeof mergedFilters.offset === 'number' ? mergedFilters.offset : initialState.logs.offset;

      patchState(store, {
        loadingLogs: true,
        errorLogs: undefined,
        filters: { ...mergedFilters, limit, offset },
      });

      api
        .getRequestLogs({ ...mergedFilters, limit, offset })
        .pipe(
          take(1),
          catchError((err) => {
            patchState(store, { errorLogs: err?.message || 'Failed to load logs' });
            return of({ ...initialState.logs });
          }),
          finalize(() => patchState(store, { loadingLogs: false }))
        )
        .subscribe((resp) => {
          patchState(store, { logs: resp });
        });
    },

    // Update filters (does not auto-load)
    setFilters(filters: Partial<HealthMetricsFilter>): void {
      const merged = { ...store.filters(), ...filters } as HealthMetricsFilter;
      patchState(store, { filters: merged });
    },

    // Pagination helpers for logs
    setPage(offset: number): void {
      const f = store.filters();
      this.loadLogs({ offset, limit: f.limit });
    },

    setPageSize(limit: number): void {
      const f = store.filters();
      // Reset to first page when page size changes
      this.loadLogs({ limit, offset: 0, sortBy: f.sortBy, sortOrder: f.sortOrder });
    },

    // Convenience to refresh both summary and logs
    refreshAll(): void {
      this.loadSummary();
      this.loadLogs();
    },
  }))
);
