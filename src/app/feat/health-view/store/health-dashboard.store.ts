import { inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed } from '@angular/core';
import { take, catchError, finalize } from 'rxjs/operators';
import { of, forkJoin } from 'rxjs';

import type { HealthSummary, HealthMetricsFilter, HealthMetricsResponse, RefreshRequestLog, SymbolStatus, SymbolRefreshMetrics } from '@shared/health-metrics';
import { HealthMetricsSortBy, SortOrder, SortDir, SortKey } from '@shared/health-metrics';
import { HealthMetricsApiService } from '../../../services/health-metrics-api.service';
import type { EndpointGroup } from '../common/health-constants';
import { getTimeSeriesPriorityIndex } from '@shared/alpha-vantage';
import { groupByEndpoint, computeLatest, getTimeMs, buildEventComparator } from '../utils/health-transforms';
import type { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { getEndpointTtlSecondsById } from '@shared/alpha-vantage';

// Build priority map from AV time-series configs (displayOrder)
const TIME_SERIES_PRIORITY = getTimeSeriesPriorityIndex();

// Default logs window: last 30 days
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const NOW = new Date();
const DEFAULT_FROM_30D = new Date(Date.now() - THIRTY_DAYS_MS);

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

  // UI: active tab index for health dashboard (0=Endpoint Detail, 1=Symbol Detail, 2=Request Logs)
  activeTabIndex: number;

  // UI: Request Logs table sort state (shared across components)
  logsSortField: SortKey;
  logsSortDir: SortDir;

}

const initialState: HealthDashboardState = {
  summary: undefined,
  logs: {
    data: [],
    total: 0,
    limit: 1000,
    offset: 0,
    hasMore: false,
  },
  filters: {
    // Default to last 30 days; newest first
    timeRange: { from: DEFAULT_FROM_30D, to: NOW },
    sortBy: HealthMetricsSortBy.Timestamp,
    sortOrder: SortOrder.Desc,
    limit: 1000,
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
  // ui
  activeTabIndex: 0,
  // request logs sort defaults: newest first
  logsSortField: SortKey.TIMESTAMP,
  logsSortDir: SortDir.DESC,
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

    // Sorted logs for Request Logs tab (UI-specific sorting centralized here)
    const sortedLogs = computed<RefreshRequestLog[]>(() => {
      const rows = store.logs().data as RefreshRequestLog[];
      if (!rows?.length) return [];
      // Stable newest-first baseline
      const baseOrder = [...rows].sort((a, b) => getTimeMs(b.timestamp) - getTimeMs(a.timestamp));
      const baseIndex = new Map<RefreshRequestLog, number>();
      baseOrder.forEach((ev, i) => baseIndex.set(ev, i));

      const active = store.logsSortField();
      const dir = store.logsSortDir();
      if (active === SortKey.TIMESTAMP && dir === SortDir.DESC) return baseOrder;
      const comparator = buildEventComparator(active, dir, baseIndex);
      return [...rows].sort(comparator);
    });

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

    // Helper to get TTL seconds for an endpoint id
    const getTtlSeconds = (endpointId: string): number => getEndpointTtlSecondsById(endpointId);

    // Endpoint KPIs in current time window based on latest log per endpoint
    const endpointWindowKpis = computed(() => {
      const rows = store.logs().data as RefreshRequestLog[];
      if (!rows?.length) return { total: 0, healthy: 0, error: 0, degraded: 0 } as const;
      // Sort by timestamp desc and iterate to capture latest per endpoint
      const sorted = [...rows].sort((a, b) => getTimeMs(b.timestamp) - getTimeMs(a.timestamp));
      const seen = new Map<string, { latest: 'SUCCESS' | 'FAILURE'; seenSuccess: boolean; seenFailure: boolean }>();
      for (const r of sorted) {
        const id = r.endpointId;
        const status = String(r.status).toUpperCase() === 'SUCCESS' ? 'SUCCESS' : 'FAILURE';
        const entry = seen.get(id) || { latest: status, seenSuccess: false, seenFailure: false };
        // Only set latest the first time we encounter (newest-first)
        if (!seen.has(id)) entry.latest = status;
        if (status === 'SUCCESS') entry.seenSuccess = true; else entry.seenFailure = true;
        seen.set(id, entry);
      }
      let healthy = 0, error = 0, degraded = 0;
      for (const v of seen.values()) {
        const hasBoth = v.seenSuccess && v.seenFailure;
        if (hasBoth && v.latest === 'FAILURE') degraded++;
        else if (v.latest === 'SUCCESS') healthy++;
        else error++;
      }
      return { total: seen.size, healthy, error, degraded } as const;
    });

    // Symbol KPIs in current time window at endpoint+symbol level using TTL
    const symbolWindowKpis = computed(() => {
      const rows = store.logs().data as RefreshRequestLog[];
      if (!rows?.length) return { total: 0, fresh: 0, stale: 0, error: 0 } as const;
      // Latest per endpoint+symbol
      const sorted = [...rows].sort((a, b) => getTimeMs(b.timestamp) - getTimeMs(a.timestamp));
      const keyLatest = new Map<string, RefreshRequestLog>();
      for (const r of sorted) {
        if (!r.symbol) continue;
        const key = `${r.endpointId}|${String(r.symbol).toUpperCase()}`;
        if (!keyLatest.has(key)) keyLatest.set(key, r);
      }
      let fresh = 0, stale = 0, error = 0;
      const nowMs = Date.now();
      const symbolSet = new Set<string>();
      for (const [key, ev] of keyLatest.entries()) {
        const latestStatus = String(ev.status).toUpperCase();
        if (ev.symbol) symbolSet.add(String(ev.symbol).toUpperCase());
        if (latestStatus === 'FAILURE') {
          error++;
          continue;
        }
        const ttlSeconds = getTtlSeconds(ev.endpointId);
        const ageMs = nowMs - getTimeMs(ev.timestamp);
        if (ttlSeconds > 0 && ageMs > ttlSeconds * 1000) stale++; else fresh++;
      }
      // Total should reflect unique symbols in the window (not endpoint+symbol pairs)
      return { total: symbolSet.size, fresh, stale, error } as const;
    });

    // Aggregated request counters derived from current logs
    const requestTotals = computed(() => {
      const rows = store.logs().data as RefreshRequestLog[];
      let success = 0;
      let failure = 0;
      // For degraded: endpoints that have both statuses in window and latest is FAILURE
      const sorted = [...rows].sort((a, b) => getTimeMs(b.timestamp) - getTimeMs(a.timestamp));
      const seen = new Map<string, { latest: 'SUCCESS' | 'FAILURE'; seenSuccess: boolean; seenFailure: boolean }>();
      for (const r of rows) {
        if (!r?.status) continue;
        if (String(r.status).toUpperCase() === 'SUCCESS') success++;
        else if (String(r.status).toUpperCase() === 'FAILURE') failure++;
      }
      for (const r of sorted) {
        const id = r.endpointId;
        const status = String(r.status).toUpperCase() === 'SUCCESS' ? 'SUCCESS' : 'FAILURE';
        const entry = seen.get(id) || { latest: status, seenSuccess: false, seenFailure: false };
        if (!seen.has(id)) entry.latest = status;
        if (status === 'SUCCESS') entry.seenSuccess = true; else entry.seenFailure = true;
        seen.set(id, entry);
      }
      let degraded = 0;
      for (const v of seen.values()) if (v.seenSuccess && v.seenFailure && v.latest === 'FAILURE') degraded++;
      const totalFromBackend = store.logs().total || 0;
      const cap = store.filters().limit ?? 1000;
      return { total: Math.min(totalFromBackend, cap), success, failure, degraded } as const;
    });

    // Unique symbol count based on currently loaded logs
    const uniqueSymbolsCount = computed(() => {
      const rows = store.logs().data as RefreshRequestLog[];
      if (!rows?.length) return 0;
      const set = new Set<string>();
      for (const r of rows) if (r?.symbol) set.add(String(r.symbol).toUpperCase());
      return set.size;
    });

    // Group logs by runId for the new Run Groups UI (with fallback for legacy rows)
    type RunGroup = {
      runId: string;
      run: NonNullable<RefreshRequestLog['metadata']>['run'] | undefined;
      rows: RefreshRequestLog[];
      latestTs: number;
      symbolsUpdated: number; // unique symbols with SUCCESS status in this run
    };

    const runGroups = computed<RunGroup[]>(() => {
      const rows = store.logs().data as RefreshRequestLog[];
      if (!rows?.length) return [];
      const map = new Map<string, RunGroup>();

      // Helper: derive ET market date, DOW, and phase from a timestamp
      const deriveFromTs = (ts: Date | number): { date: string; dow: string; phase: 'pre' | 'post' } => {
        const d = typeof ts === 'number' ? new Date(ts) : (ts instanceof Date ? ts : new Date(getTimeMs(ts)));
        const tz = 'America/New_York';
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); // YYYY-MM-DD
        const dowIdx = Number(new Date(d.toLocaleString('en-US', { timeZone: tz })).getDay());
        const DOW = ['SUN','MON','TUE','WED','THU','FRI','SAT'] as const;
        const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(d));
        const phase = hour >= 16 ? 'post' : 'pre';
        return { date: parts, dow: DOW[dowIdx], phase };
      };

      for (const r of rows) {
        const meta = r.metadata || {} as any;
        let rid: string | undefined = meta.runId;
        let run: any = meta.run;

        // Fallback: synthesize run grouping for legacy rows that lack runId/run
        if (!rid) {
          const { date, dow, phase } = deriveFromTs(r.timestamp as any);
          // Use exact endpointId to avoid ambiguity; render human header with these pieces
          rid = `${date}_${dow}_${String(phase).toUpperCase()}_${r.endpointId}`;
          run = {
            id: rid,
            date,
            dow, // UI can map to label directly
            phase, // shared TradingPhase uses 'pre'|'post', compatible here
            endpointId: r.endpointId,
            endpointShort: undefined,
            trigger: meta.trigger,
          };
        }

        const g: RunGroup = map.get(rid) || {
          runId: rid,
          run,
          rows: [] as RefreshRequestLog[],
          latestTs: 0,
          symbolsUpdated: 0,
        };
        g.rows.push(r);
        const ts = getTimeMs(r.timestamp);
        if (ts > g.latestTs) g.latestTs = ts;
        map.set(rid, g);
      }

      // compute unique success symbol counts per group
      for (const g of map.values()) {
        const symSet = new Set<string>();
        for (const r of g.rows) {
          if (String(r.status).toUpperCase() === 'SUCCESS' && r.symbol) symSet.add(String(r.symbol).toUpperCase());
        }
        g.symbolsUpdated = symSet.size;
      }
      // sort by latestTs desc
      const groups = [...map.values()];
      groups.sort((a, b) => b.latestTs - a.latestTs);
      return groups;
    });

    return { 
      isBusy, 
      hasSummary, 
      logsCount, 
      hasSelectedSymbol, 
      sortedLogs, 
      runGroups,
      endpointGroupsRaw, 
      sortedEndpointGroupsByPriority, 
      requestTotals, 
      uniqueSymbolsCount, 
      endpointWindowKpis, 
      symbolWindowKpis 
    };
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
        .subscribe((summary: HealthSummary | undefined) => {
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
        .subscribe((resp: HealthMetricsResponse<RefreshRequestLog> | undefined) => {
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

    // Request Logs: update/toggle sort state
    setLogsSort(field: SortKey): void {
      const active = store.logsSortField();
      const dir = store.logsSortDir();
      if (active === field) {
        patchState(store, { logsSortDir: dir === SortDir.DESC ? SortDir.ASC : SortDir.DESC });
      } else {
        patchState(store, { logsSortField: field, logsSortDir: field === SortKey.TIMESTAMP ? SortDir.DESC : SortDir.ASC });
      }
    },

    // Convenience to refresh both summary and logs
    refreshAll(): void {
      const ts = new Date().toISOString();
      console.log('[HealthStore] refreshAll() start', { ts });
      this.loadSummary();
      this.loadLogs();
      console.log('[HealthStore] refreshAll() queued', { ts });
    },

    // ---------------- Tabs ----------------
    setActiveTab(index: number): void {
      patchState(store, { activeTabIndex: index });
    },

    // Open a symbol in the drawer (single-call convenience)
    openSymbol(symbol: string): void {
      const sym = (symbol || '').toUpperCase();
      if (!sym) return;
      patchState(store, { selectedSymbol: sym });
      this.setActiveTab(1);
      this.loadSymbolDetail(sym);
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
      patchState(store, {
        selectedSymbol: sym,
        loadingSymbol: true,
        errorSymbol: '',
        symbolStatus: undefined,
        symbolMetrics: undefined,
      });

      // Call V2 endpoints through the ApiService (service already points to V2)
      forkJoin({
        status: api.getSymbolStatus(sym).pipe(take(1), catchError(() => of(null))),
        metrics: api.getSymbolMetrics(sym).pipe(take(1), catchError(() => of(null))),
      }).pipe(finalize(() => patchState(store, { loadingSymbol: false })))
        .subscribe(({ status, metrics }) => {
          patchState(store, { symbolStatus: status, symbolMetrics: metrics });
        });
    },
  }))
);
