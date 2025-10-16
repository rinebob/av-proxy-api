import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { SortDir, SortKey } from '@shared/health-metrics';
import { HealthFilterLabel, HEALTH_LABEL_ALL, HEALTH_LABEL_EM_DASH } from '../../common/health-constants';

// Shared types
import { HealthMetricsSortBy, SortOrder, type HealthMetricsFilter } from '@shared/health-metrics';
import { AV_IMPLEMENTED_ENDPOINTS, type AlphaVantageEndpoint, type ListSymbolsV2Response } from '@shared/alpha-vantage';

// DM helpers
import { DataMaintainerFunctionName } from '../../../data-maintainer-view/common/fe-common-dm-api';

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
import { API_BASES } from 'src/app/core/api/api.tokens';

// 30-day window used for historical review bounds
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const PERSIST_FILTERS = false; // set to true if you want filter state to survive route transitions

export enum QuickRange {
  TODAY = 'today',
  LAST_24H = '24h',
  WEEK = 'week',
  ALL = 'all',
}

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
  private readonly apiBases = inject(API_BASES);

  // Expose enum to template
  readonly QuickRange = QuickRange;

  // Endpoints from shared implemented set
  readonly endpointsList = Array.from(AV_IMPLEMENTED_ENDPOINTS) as AlphaVantageEndpoint[];

  // Tracked symbols populated from DM listSymbolsV2
  readonly symbolsList = signal<string[]>([]);
  // Total tracked symbols (from backend response.total)
  readonly totalSymbolsCount = signal<number>(0);

  // UI state (single source of truth)
  readonly selectedEndpointIds = signal<string[]>([]);
  readonly selectedSymbols = signal<string[]>([]);
  readonly fromStr = signal<string>(''); // ISO local datetime string
  readonly toStr = signal<string>('');   // ISO local datetime string
  readonly sortBySig = signal<HealthMetricsSortBy | null>(null);
  readonly sortOrderSig = signal<SortOrder | null>(null);
  // Show/hide custom date pickers
  readonly showCustomDates = signal<boolean>(false);

  // Quick time range selection (default set in constructor)
  readonly activeQuickRange = signal<QuickRange | null>(null);

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

  // Header summary for expansion panel description
  readonly headerSummary = computed(() => {
    const epCount = this.selectedEndpointIds().length;
    const selectedCount = this.selectedSymbols().length;
    const total = this.totalSymbolsCount();
    const sortBy = this.sortBySig() ?? HealthMetricsSortBy.Timestamp;
    const sortOrder = this.sortOrderSig() ?? SortOrder.Desc;

    const range = this.buildRangeLabel();

    // Show selection vs total when nothing selected
    const symbolsLabel = selectedCount > 0
      ? `${selectedCount}/${total || HEALTH_LABEL_EM_DASH}`
      : `${HEALTH_LABEL_ALL}${total ? ` (${total})` : ''}`;
    return `${HealthFilterLabel.ENDPOINTS}: ${epCount || HEALTH_LABEL_ALL} • ${HealthFilterLabel.SYMBOLS}: ${symbolsLabel} • ${HealthFilterLabel.RANGE}: ${range} • ${HealthFilterLabel.SORT}: ${sortBy}/${sortOrder}`;
  });

  // Structured header segments for precise spacing in the panel header
  readonly headerPairs = computed((): { key: string; value: string }[] => {
    const epCount = this.selectedEndpointIds().length;
    const selectedCount = this.selectedSymbols().length;
    const total = this.totalSymbolsCount();
    const sortBy = this.sortBySig() ?? HealthMetricsSortBy.Timestamp;
    const sortOrder = this.sortOrderSig() ?? SortOrder.Desc;

    const range = this.buildRangeLabel();

    return [
      { key: HealthFilterLabel.ENDPOINTS, value: String(epCount || HEALTH_LABEL_ALL) },
      { key: HealthFilterLabel.SYMBOLS, value: selectedCount > 0 ? `${selectedCount}/${total || HEALTH_LABEL_EM_DASH}` : `${HEALTH_LABEL_ALL}${total ? ` (${total})` : ''}` },
      { key: HealthFilterLabel.RANGE, value: range },
      { key: HealthFilterLabel.SORT, value: `${sortBy}/${sortOrder}` },
    ];
  });

  constructor() {
    super();

    // Hydrate UI signals from store filters on first load (persists across refresh)
    this.hydrateFromStoreFilters();

    if (!PERSIST_FILTERS) {
      // Always start from a known default when entering the view
      this.setQuickRange(QuickRange.ALL);
      this.showCustomDates.set(false);
    } else {
      // Try to map existing dates to a quick range; otherwise mark as Custom
      this.deriveQuickRangeFromCurrent();
    }

    // Load tracked symbols once (build from DI-provided base to avoid localhost in prod)
    // Request active-only with a higher limit to avoid pagination undercount
    const params = new URLSearchParams({
      activeOnly: 'true',
      limit: '1000',
      offset: '0',
      sortBy: SortKey.SYMBOL,
      sortDirection: SortDir.ASC
    });
    const url = `${this.apiBases.dm}/${DataMaintainerFunctionName.LIST_SYMBOLS_V2}?${params.toString()}`;
    this.http.get<ListSymbolsV2Response>(url).subscribe({
      next: (res) => {
        const symbols = (res?.symbols || []).map(s => s.symbol).filter(Boolean);
        this.symbolsList.set(symbols);
        if (typeof (res as any)?.total === 'number') this.totalSymbolsCount.set((res as any).total as number);

        // Auto-select default symbol if none selected, so Symbol Detail always shows something
        if (!this.healthStore.hasSelectedSymbol() && symbols.length > 0) {
          this.healthStore.selectSymbol(symbols[0]);
        }
      },
      error: () => {
        this.symbolsList.set([]);
        this.totalSymbolsCount.set(0);
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
  setQuickRange(range: QuickRange): void {
    const now = new Date();
    const max = this.maxDate();
    const min = this.minDate();

    let fromISO = '';
    let toISO = '';

    if (range === QuickRange.TODAY) {
      const start = new Date(max.getFullYear(), max.getMonth(), max.getDate(), 0, 0, 0, 0);
      const end = new Date(max.getFullYear(), max.getMonth(), max.getDate(), 23, 59, 59, 999);
      fromISO = start.toISOString();
      toISO = end.toISOString();
    } else if (range === QuickRange.LAST_24H) {
      const end = new Date(Math.min(now.getTime(), max.getTime()));
      const start = new Date(Math.max(end.getTime() - 24 * 60 * 60 * 1000, min.getTime()));
      fromISO = start.toISOString();
      toISO = end.toISOString();
    } else if (range === QuickRange.WEEK) {
      const end = new Date(Math.min(now.getTime(), max.getTime()));
      const start = new Date(Math.max(end.getTime() - 7 * 24 * 60 * 60 * 1000, min.getTime()));
      fromISO = start.toISOString();
      toISO = end.toISOString();
    } else if (range === QuickRange.ALL) {
      // Full available window
      fromISO = new Date(min.getFullYear(), min.getMonth(), min.getDate(), 0, 0, 0, 0).toISOString();
      const end = new Date(max.getFullYear(), max.getMonth(), max.getDate(), 23, 59, 59, 999);
      toISO = end.toISOString();
    }

    this.fromStr.set(fromISO);
    this.toStr.set(toISO);
    this.activeQuickRange.set(range);
    this.showCustomDates.set(false); // hide pickers on non-custom

    // Apply immediately so logs refresh and datepickers reflect values
    this.applyFilters();
  }

  // Show the custom date pickers and mark quick range as custom
  onCustomClick(): void {
    this.showCustomDates.set(true);
    this.activeQuickRange.set(null);
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
    // Reset UI state (except time range, which we set to default below)
    this.selectedEndpointIds.set([]);
    this.selectedSymbols.set([]);
    this.fromStr.set('');
    this.toStr.set('');
    this.sortBySig.set(null);
    this.sortOrderSig.set(null);
    this.showCustomDates.set(false);

    // Set default quick range to All data (also applies filters)
    this.setQuickRange(QuickRange.ALL);
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

    // Quick range is derived after hydration in constructor
  }

  /** Try to infer the active quick range from current from/to.
   * If matches Today, Last 24 hrs, 1 week, or All data, set the active range and hide custom pickers.
   * Otherwise mark as Custom and show pickers so the Custom button highlights. */
  private deriveQuickRangeFromCurrent(): void {
    const from = this.parseDate(this.fromStr());
    const to = this.parseDate(this.toStr());
    const now = new Date();

    if (!from || !to) {
      // No explicit dates; treat as default
      this.setQuickRange(QuickRange.ALL);
      return;
    }

    const max = this.maxDate();
    const min = this.minDate();

    const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const ms = (d: Date) => d.getTime();
    const within = (a: number, b: number, tolMs = 60 * 1000) => Math.abs(a - b) <= tolMs; // 1-minute tolerance

    // Build canonical targets
    const todayStart = new Date(max.getFullYear(), max.getMonth(), max.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(max.getFullYear(), max.getMonth(), max.getDate(), 23, 59, 59, 999);

    const end24 = new Date(Math.min(now.getTime(), max.getTime()));
    const start24 = new Date(Math.max(end24.getTime() - 24 * 60 * 60 * 1000, min.getTime()));

    const end7 = new Date(Math.min(now.getTime(), max.getTime()));
    const start7 = new Date(Math.max(end7.getTime() - 7 * 24 * 60 * 60 * 1000, min.getTime()));

    if (sameDay(from, todayStart) && sameDay(to, todayEnd)) {
      this.setQuickRange(QuickRange.TODAY);
      return;
    }
    if (within(ms(from), ms(start24)) && within(ms(to), ms(end24))) {
      this.setQuickRange(QuickRange.LAST_24H);
      return;
    }
    if (within(ms(from), ms(start7)) && within(ms(to), ms(end7))) {
      this.setQuickRange(QuickRange.WEEK);
      return;
    }

    // If dates span min->max window approximately, treat as All
    if (within(ms(from), ms(new Date(min.getFullYear(), min.getMonth(), min.getDate(), 0, 0, 0, 0))) &&
        within(ms(to), ms(todayEnd))) {
      this.setQuickRange(QuickRange.ALL);
      return;
    }

    // Fallback: Custom
    this.activeQuickRange.set(null);
    this.showCustomDates.set(true); // highlight Custom
  }

  /** Build the Range label with optional prefix (Today/Last 24 hrs/1 week/All data/Custom)
   * and a formatted date span without seconds. */
  private buildRangeLabel(): string {
    const qr = this.activeQuickRange();
    const from = this.parseDate(this.fromStr());
    const to = this.parseDate(this.toStr());

    const fmt = (d?: Date | null) => d ? this.formatDateTime(d) : '—';

    if (qr === QuickRange.TODAY) {
      return `Today: ${fmt(from)} → ${fmt(to)}`;
    }
    if (qr === QuickRange.LAST_24H) {
      return `Last 24 hrs: ${fmt(from)} → ${fmt(to)}`;
    }
    if (qr === QuickRange.WEEK) {
      return `1 week: ${fmt(from)} → ${fmt(to)}`;
    }
    if (qr === QuickRange.ALL) {
      return `All data: ${fmt(from)} → ${fmt(to)}`;
    }
    if (from || to) {
      return `Custom: ${fmt(from)} → ${fmt(to)}`;
    }
    return 'All';
  }

  /** Format date without seconds, with hours:minutes and am/pm. */
  private formatDateTime(d: Date): string {
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    } as Intl.DateTimeFormatOptions);
  }
}
