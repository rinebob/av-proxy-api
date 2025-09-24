import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';

// Import shared types to satisfy strict typing on filters
import type { HealthMetricsSortBy, SortOrder, HealthMetricsFilter } from '@shared/health-metrics';

@Component({
  selector: 'app-health-filters-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './health-filters-bar.component.html',
  styleUrls: ['./health-filters-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthFiltersBarComponent extends HealthViewBase {
  applyFilters(endpointsCsv?: string, symbolsCsv?: string, from?: string, to?: string, sortBy?: string, sortOrder?: string) {
    const parseCsv = (csv?: string): string[] | undefined => {
      const list = (csv || '')
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);
      return list.length ? list : undefined;
    };

    const parseDate = (val?: string): Date | undefined => {
      if (!val) return undefined;
      const d = new Date(val);
      return isNaN(d.getTime()) ? undefined : d;
    };

    const fromDate = parseDate(from);
    const toDate = parseDate(to);

    const nextFilters: Partial<HealthMetricsFilter> = {
      endpointIds: parseCsv(endpointsCsv),
      symbols: parseCsv(symbolsCsv),
      // Only provide timeRange when at least one bound exists; also omit undefined fields
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
    endpoints: HTMLInputElement,
    symbols: HTMLInputElement,
    from: HTMLInputElement,
    to: HTMLInputElement,
    sortBy: HTMLSelectElement,
    sortOrder: HTMLSelectElement,
  ) {
    endpoints.value = '';
    symbols.value = '';
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
