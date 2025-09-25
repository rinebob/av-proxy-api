import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

// Shared types
import type { HealthMetricsSortBy, SortOrder, HealthMetricsFilter } from '@shared/health-metrics';
import { AV_IMPLEMENTED_ENDPOINTS, type AlphaVantageEndpoint } from '@shared/alpha-vantage';

// DM helpers
import { DataMaintainerFunctionName, getDataMaintainerFunctionUrl, type ListSymbolsResponse } from '../../../data-maintainer-view/common/fe-common-dm-api';

@Component({
  selector: 'app-health-filters-bar',
  standalone: true,
  imports: [CommonModule],
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

  constructor() {
    super();

    // Load tracked symbols once
    const url = getDataMaintainerFunctionUrl(DataMaintainerFunctionName.LIST_SYMBOLS_V2);
    this.http.get<ListSymbolsResponse>(url).subscribe({
      next: (res) => {
        const symbols = (res?.symbols || []).map(s => s.symbol).filter(Boolean);
        this.symbolsList.set(symbols);
      },
      error: () => {
        this.symbolsList.set([]);
      }
    });
  }

  applyFilters(endpointsCsvOrSel?: string | HTMLSelectElement, symbolsCsvOrSel?: string | HTMLSelectElement, from?: string, to?: string, sortBy?: string, sortOrder?: string) {
    const parseCsv = (csv?: string): string[] | undefined => {
      const list = (csv || '')
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);
      return list.length ? list : undefined;
    };

    const parseMulti = (sel?: HTMLSelectElement): string[] | undefined => {
      if (!sel) return undefined;
      const vals: string[] = Array.from(sel.selectedOptions).map(o => o.value).filter(Boolean);
      return vals.length ? vals : undefined;
    };

    const parseDate = (val?: string): Date | undefined => {
      if (!val) return undefined;
      const d = new Date(val);
      return isNaN(d.getTime()) ? undefined : d;
    };

    const fromDate = parseDate(from);
    const toDate = parseDate(to);

    const endpointIds = typeof endpointsCsvOrSel === 'string' ? parseCsv(endpointsCsvOrSel) : parseMulti(endpointsCsvOrSel);
    const symbols = typeof symbolsCsvOrSel === 'string' ? parseCsv(symbolsCsvOrSel) : parseMulti(symbolsCsvOrSel);

    const nextFilters: Partial<HealthMetricsFilter> = {
      endpointIds,
      symbols,
      timeRange: (fromDate || toDate)
        ? ({
            ...(fromDate ? { from: fromDate } : {}),
            ...(toDate ? { to: toDate } : {}),
          } as any)
        : undefined,
      sortBy: (sortBy as HealthMetricsSortBy) ?? ('timestamp' as unknown as HealthMetricsSortBy),
      sortOrder: (sortOrder as SortOrder) ?? ('desc' as unknown as SortOrder),
    };

    this.healthStore.setFilters(nextFilters);
    this.healthStore.loadLogs();
  }

  clearFilters(
    endpoints: HTMLSelectElement,
    symbols: HTMLSelectElement,
    from: HTMLInputElement,
    to: HTMLInputElement,
    sortBy: HTMLSelectElement,
    sortOrder: HTMLSelectElement,
  ) {
    // Reset selects
    Array.from(endpoints.options).forEach(o => (o.selected = false));
    Array.from(symbols.options).forEach(o => (o.selected = false));

    // Reset dates and sort
    from.value = '';
    to.value = '';
    sortBy.value = 'timestamp';
    sortOrder.value = 'desc';

    const resetFilters: Partial<HealthMetricsFilter> = {
      endpointIds: undefined,
      symbols: undefined,
      timeRange: undefined,
      sortBy: 'timestamp' as unknown as HealthMetricsSortBy,
      sortOrder: 'desc' as unknown as SortOrder,
      limit: this.healthStore.logs().limit,
      offset: 0,
    };

    this.healthStore.setFilters(resetFilters);
    this.healthStore.loadLogs();
  }
}
