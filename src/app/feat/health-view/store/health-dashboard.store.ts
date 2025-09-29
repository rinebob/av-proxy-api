import { inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed } from '@angular/core';
import { take, catchError, finalize } from 'rxjs/operators';
import { of, forkJoin } from 'rxjs';

import type { HealthSummary, HealthMetricsFilter, HealthMetricsResponse, RefreshRequestLog, SymbolStatus, SymbolRefreshMetrics } from '@shared/health-metrics';
import { HealthMetricsSortBy, SortOrder } from '@shared/health-metrics';
import { HealthMetricsApiService } from '../../../services/health-metrics-api.service';
import type { EndpointGroup } from '../utils/health-constants';
import { getTimeSeriesPriorityIndex } from '@shared/alpha-vantage/av-endpoint-configs';
import { groupByEndpoint, computeLatest, getTimeMs } from '../utils/health-transforms';
import type { AlphaVantageEndpoint } from '@shared/alpha-vantage';

// Build priority map from AV time-series configs (displayOrder)
const TIME_SERIES_PRIORITY = getTimeSeriesPriorityIndex();

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
  withComputed((store) => {
    // Derived flags
    const isBusy = computed(() => store.loadingSummary() || store.loadingLogs());
    const hasSummary = computed(() => !!store.summary());
    const logsCount = computed(() => store.logs().data.length);
    const hasSelectedSymbol = computed(() => !!store.selectedSymbol());

    // Group logs by endpoint and prepare latest-first base ordering (no UI-specific sorting)
    const endpointGroupsRaw = computed<EndpointGroup[]>(() => {
      const items = store.logs().data as RefreshRequestLog[];
      const selected = (store.filters().endpointIds || []) as string[];

      // 1) group
      const map = groupByEndpoint(items);

      // 2) ensure selected endpoints exist (even if empty) so user intent is honored
      for (const ep of selected) if (!map.has(ep)) map.set(ep, []);

      // 3) for each group: base sort by latest timestamp desc and compute latest
      const groups: EndpointGroup[] = [];
      for (const [endpointId, events] of map.entries()) {
        const baseSorted = [...events].sort((a, b) => getTimeMs(b.timestamp) - getTimeMs(a.timestamp));
        const latest = computeLatest(baseSorted);
        groups.push({ endpointId, events: baseSorted, latest });
      }
      return groups;
    });

    // Sort groups: priority list first, then by latest timestamp desc, then by id asc
    const sortedEndpointGroupsByPriority = computed<EndpointGroup[]>(() => {
      const groups = [...endpointGroupsRaw()];
      groups.sort((a, b) => {
        const ai = TIME_SERIES_PRIORITY.get(a.endpointId as AlphaVantageEndpoint) ?? Number.POSITIVE_INFINITY;
        const bi = TIME_SERIES_PRIORITY.get(b.endpointId as AlphaVantageEndpoint) ?? Number.POSITIVE_INFINITY;
        if (ai !== bi) return ai - bi;
        const ta = a.latest ? getTimeMs(a.latest.timestamp as any) : 0;
        const tb = b.latest ? getTimeMs(b.latest.timestamp as any) : 0;
        if (tb !== ta) return tb - ta;
        return a.endpointId.localeCompare(b.endpointId);
      });
      return groups;
    });

    return { isBusy, hasSummary, logsCount, hasSelectedSymbol, endpointGroupsRaw, sortedEndpointGroupsByPriority };
  }),
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
