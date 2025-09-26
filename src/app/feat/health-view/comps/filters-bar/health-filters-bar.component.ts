import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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

@Component({
  selector: 'app-health-filters-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, MatToolbarModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatButtonModule, MatIconModule, MatDatepickerModule, MatNativeDateModule],
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

  constructor() {
    super();

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
    this.fromStr.set(d ? this.startOfDayIsoLocal(d) : '');
  }

  onToDateChange(d: Date | null): void {
    this.toStr.set(d ? this.endOfDayIsoLocal(d) : '');
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
}
