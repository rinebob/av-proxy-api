import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

// Shared types
import { HealthMetricsSortBy, SortOrder, type HealthMetricsFilter } from '@shared/health-metrics';
import { AV_IMPLEMENTED_ENDPOINTS, type AlphaVantageEndpoint } from '@shared/alpha-vantage';

// DM helpers
import { DataMaintainerFunctionName, getDataMaintainerFunctionUrl, type ListSymbolsResponse } from '../../../data-maintainer-view/common/fe-common-dm-api';

// Angular Material
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatExpansionModule } from '@angular/material/expansion';

// 30-day window used for historical review bounds
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-health-filters-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, MatToolbarModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatButtonModule, MatIconModule, MatDatepickerModule, MatNativeDateModule, MatExpansionModule],
  templateUrl: './health-filters-bar.component.html',
  styleUrls: ['./health-filters-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthFiltersBarComponent extends HealthViewBase {
  private readonly http = inject(HttpClient);

  // Endpoints from shared implemented set
  readonly endpointsList = Array.from(AV_IMPLEMENTED_ENDPOINTS) as AlphaVantageEndpoint[];

  // Tracked symbols populated from DM listSymbolsV2
  readonly symbolsList = signal<string[]>([]);

  // UI state (single source of truth)
  readonly selectedEndpointIds = signal<string[]>([]);
  readonly selectedSymbols = signal<string[]>([]);
  readonly fromStr = signal<string>(''); // ISO local datetime string
  readonly toStr = signal<string>('');   // ISO local datetime string
  readonly sortBySig = signal<HealthMetricsSortBy | null>(null);
  readonly sortOrderSig = signal<SortOrder | null>(null);

  // Computed Date objects for binding the datepicker values
  readonly fromDate = computed<Date | null>(() => this.parseDate(this.fromStr()) ?? null);
  readonly toDate = computed<Date | null>(() => this.parseDate(this.toStr()) ?? null);

  // Date bounds: last 30 days up to today (no future)
  readonly minDate = computed<Date>(() => {
    const now = new Date();
    return new Date(now.getTime() - THIRTY_DAYS_MS);
  });
  readonly maxDate = computed<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()); // start of today
  });

  // Quick time range selection
  readonly activeQuickRange = signal<'today' | '24h' | 'week' | 'all' | null>('all');

  // Header summary for expansion panel description
  readonly headerSummary = computed(() => {
    const epCount = this.selectedEndpointIds().length;
    const symCount = this.selectedSymbols().length;
    const sortBy = this.sortBySig() ?? HealthMetricsSortBy.Timestamp;
    const sortOrder = this.sortOrderSig() ?? SortOrder.Desc;

    // Range label
    let range = 'All';
    const qr = this.activeQuickRange();
    if (qr) {
      if (qr === '24h') range = 'Last 24h';
      else if (qr === 'week') range = '1 week';
      else if (qr === 'today') range = 'Today';
      else range = 'All';
    } else if (this.fromStr() || this.toStr()) {
      const from = this.fromStr() ? new Date(this.fromStr()).toLocaleString() : '—';
      const to = this.toStr() ? new Date(this.toStr()).toLocaleString() : '—';
      range = `${from} → ${to}`;
    }

    return `Endpoints: ${epCount || 'All'} • Symbols: ${symCount || 'All'} • Range: ${range} • Sort: ${sortBy}/${sortOrder}`;
  });

  // Structured header segments for precise spacing in the panel header
  readonly headerPairs = computed((): { key: string; value: string }[] => {
    const epCount = this.selectedEndpointIds().length;
    const symCount = this.selectedSymbols().length;
    const sortBy = this.sortBySig() ?? HealthMetricsSortBy.Timestamp;
    const sortOrder = this.sortOrderSig() ?? SortOrder.Desc;

    let range = 'All';
    const qr = this.activeQuickRange();
    if (qr) {
      if (qr === '24h') range = 'Last 24h';
      else if (qr === 'week') range = '1 week';
      else if (qr === 'today') range = 'Today';
      else range = 'All';
    } else if (this.fromStr() || this.toStr()) {
      const from = this.fromStr() ? new Date(this.fromStr()).toLocaleString() : '—';
      const to = this.toStr() ? new Date(this.toStr()).toLocaleString() : '—';
      range = `${from} → ${to}`;
    }

    return [
      { key: 'Endpoints', value: String(epCount || 'All') },
      { key: 'Symbols', value: String(symCount || 'All') },
      { key: 'Range', value: range },
      { key: 'Sort', value: `${sortBy}/${sortOrder}` },
    ];
  });

  constructor() {
    super();

    // Hydrate UI signals from store filters on first load (persists across refresh)
    this.hydrateFromStoreFilters();

    // Load tracked symbols once
    const url = getDataMaintainerFunctionUrl(DataMaintainerFunctionName.LIST_SYMBOLS_V2);
    this.http.get<ListSymbolsResponse>(url).subscribe({
      next: (res) => {
        const symbols = (res?.symbols || []).map(s => s.symbol).filter(Boolean);
        this.symbolsList.set(symbols);

        // Auto-select default symbol if none selected, so Symbol Detail always shows something
        if (!this.healthStore.hasSelectedSymbol() && symbols.length > 0) {
          this.healthStore.selectSymbol(symbols[0]);
        }
      },
      error: () => {
        this.symbolsList.set([]);
      }
    });
  }

  private parseDate(val?: string): Date | undefined {
    if (!val) return undefined;
    const d = new Date(val);
    return isNaN(d.getTime()) ? undefined : d;
  }

  // Convert selected date to start/end-of-day ISO (UTC) for filtering
  private startOfDayIsoLocal(d: Date): string {
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    return local.toISOString();
  }

  private endOfDayIsoLocal(d: Date): string {
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return local.toISOString();
  }

  onFromDateChange(d: Date | null): void {
    if (!d) {
      this.fromStr.set('');
      this.activeQuickRange.set(null);
      return;
    }
    // Clamp to [minDate, maxDate]
    const min = this.minDate();
    const max = this.maxDate();
    const clamped = new Date(Math.min(Math.max(d.getTime(), min.getTime()), max.getTime()));
    this.fromStr.set(this.startOfDayIsoLocal(clamped));
    this.activeQuickRange.set(null);

    // Enforce from <= to
    const to = this.toDate();
    if (to && clamped.getTime() > to.getTime()) {
      this.toStr.set(this.endOfDayIsoLocal(clamped));
    }
  }

  onToDateChange(d: Date | null): void {
    if (!d) {
      this.toStr.set('');
      this.activeQuickRange.set(null);
      return;
    }
    // Clamp to [minDate, maxDate]
    const min = this.minDate();
    const max = this.maxDate();
    const clamped = new Date(Math.min(Math.max(d.getTime(), min.getTime()), max.getTime()));
    this.toStr.set(this.endOfDayIsoLocal(clamped));
    this.activeQuickRange.set(null);

    // Enforce from <= to
    const from = this.fromDate();
    if (from && from.getTime() > clamped.getTime()) {
      this.fromStr.set(this.startOfDayIsoLocal(clamped));
    }
  }

  // Quick range helpers (restored)
  setQuickRange(range: 'today' | '24h' | 'week' | 'all'): void {
    const now = new Date();
    const max = this.maxDate();
    const min = this.minDate();

    let fromISO = '';
    let toISO = '';

    if (range === 'today') {
      const start = new Date(max.getFullYear(), max.getMonth(), max.getDate(), 0, 0, 0, 0);
      const end = new Date(max.getFullYear(), max.getMonth(), max.getDate(), 23, 59, 59, 999);
      fromISO = start.toISOString();
      toISO = end.toISOString();
    } else if (range === '24h') {
      const end = new Date(Math.min(now.getTime(), max.getTime()));
      const start = new Date(Math.max(end.getTime() - 24 * 60 * 60 * 1000, min.getTime()));
      fromISO = start.toISOString();
      toISO = end.toISOString();
    } else if (range === 'week') {
      const end = new Date(Math.min(now.getTime(), max.getTime()));
      const start = new Date(Math.max(end.getTime() - 7 * 24 * 60 * 60 * 1000, min.getTime()));
      fromISO = start.toISOString();
      toISO = end.toISOString();
    } else if (range === 'all') {
      // Full available window
      fromISO = new Date(min.getFullYear(), min.getMonth(), min.getDate(), 0, 0, 0, 0).toISOString();
      const end = new Date(max.getFullYear(), max.getMonth(), max.getDate(), 23, 59, 59, 999);
      toISO = end.toISOString();
    }

    this.fromStr.set(fromISO);
    this.toStr.set(toISO);
    this.activeQuickRange.set(range);

    // Apply immediately so logs refresh and datepickers reflect values
    this.applyFilters();
  }

  applyFilters(): void {
    const fromDate = this.parseDate(this.fromStr());
    const toDate = this.parseDate(this.toStr());

    const nextFilters: Partial<HealthMetricsFilter> = {
      endpointIds: this.selectedEndpointIds().length ? this.selectedEndpointIds() : undefined,
      symbols: this.selectedSymbols().length ? this.selectedSymbols() : undefined,
      timeRange: (fromDate || toDate)
        ? ({ ...(fromDate ? { from: fromDate } : {}), ...(toDate ? { to: toDate } : {}) } as any)
        : undefined,
      sortBy: this.sortBySig() ?? HealthMetricsSortBy.Timestamp,
      sortOrder: this.sortOrderSig() ?? SortOrder.Desc,
    };

    this.healthStore.setFilters(nextFilters);
    this.healthStore.loadLogs();
  }

  clearFilters(): void {
    // Reset UI state
    this.selectedEndpointIds.set([]);
    this.selectedSymbols.set([]);
    this.fromStr.set('');
    this.toStr.set('');
    this.sortBySig.set(null);
    this.sortOrderSig.set(null);
    this.activeQuickRange.set(null);

    // Reset store filters and reload
    const resetFilters: Partial<HealthMetricsFilter> = {
      endpointIds: undefined,
      symbols: undefined,
      timeRange: undefined,
      sortBy: HealthMetricsSortBy.Timestamp,
      sortOrder: SortOrder.Desc,
      limit: this.healthStore.logs().limit,
      offset: 0,
    };

    this.healthStore.setFilters(resetFilters);
    this.healthStore.loadLogs();
  }

  // Sync UI signals from store filters (called on init)
  private hydrateFromStoreFilters(): void {
    const f = this.healthStore.filters();
    const tr = f?.timeRange as { from?: Date; to?: Date } | undefined;

    // Dates -> ISO strings respecting start/end of day behavior used elsewhere
    if (tr?.from instanceof Date) this.fromStr.set(this.startOfDayIsoLocal(tr.from));
    if (tr?.to instanceof Date) this.toStr.set(this.endOfDayIsoLocal(tr.to));

    // Optional: hydrate other UI signals for consistency
    if (Array.isArray((f as any).endpointIds)) this.selectedEndpointIds.set((f as any).endpointIds as string[]);
    if (Array.isArray((f as any).symbols)) this.selectedSymbols.set((f as any).symbols as string[]);
    this.sortBySig.set((f?.sortBy as HealthMetricsSortBy) ?? null);
    this.sortOrderSig.set((f?.sortOrder as SortOrder) ?? null);

    // Quick range is unknown after a refresh; leave as null so header shows explicit range
    this.activeQuickRange.set(null);
  }
}
