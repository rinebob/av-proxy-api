import { ChangeDetectionStrategy, Component, computed, signal, ViewChildren, QueryList } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';
import { TimeAgoPipe } from '../../pipes/time-ago.pipe';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatListModule } from '@angular/material/list';
import { MatTableModule } from '@angular/material/table';
import { MatExpansionModule, MatExpansionPanel } from '@angular/material/expansion';
import type { RefreshRequestLog } from '@shared/health-metrics';
import { getTimeMs, buildEventComparator, SortKeys, type SortField } from '../../utils/health-transforms';

interface SymbolGroup {
  symbol: string;
  events: RefreshRequestLog[];
  latest?: RefreshRequestLog;
  endpointCount: number;
  requestCount: number;
}

@Component({
  selector: 'app-health-symbol-detail',
  standalone: true,
  imports: [
    CommonModule,
    TsToIsoPipe,
    TimeAgoPipe,
    MatCardModule,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatChipsModule,
    MatListModule,
    MatTableModule,
    MatExpansionModule,
  ],
  templateUrl: './health-symbol-detail.component.html',
  styleUrls: ['./health-symbol-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSymbolDetailComponent extends HealthViewBase {
  // Sorting state shared by all per-symbol tables
  readonly SortKeys = SortKeys;
  readonly sortField = signal<SortField | null>(SortKeys.timestamp);
  readonly sortDir = signal<'asc' | 'desc'>('desc');

  // Ref to all panels for expand/collapse all
  @ViewChildren(MatExpansionPanel) private panels!: QueryList<MatExpansionPanel>;

  expandAll(): void { this.panels?.forEach(p => p.open()); }
  collapseAll(): void { this.panels?.forEach(p => p.close()); }

  onHeaderSort(field: SortField): void {
    const active = this.sortField();
    const dir = this.sortDir();
    if (active === field) {
      this.sortDir.set(dir === 'desc' ? 'asc' : 'desc');
    } else {
      this.sortField.set(field);
      this.sortDir.set(field === SortKeys.timestamp ? 'desc' : 'asc');
    }
  }

  // Table columns used inside each expansion panel
  readonly displayedColumns: ReadonlyArray<string> = ['time', 'timeAgo', 'endpoint', 'status', 'duration'];

  // Group all current-page logs by symbol, sorted by latest event desc, with events sorted latest-first
  readonly symbolGroups = computed<SymbolGroup[]>(() => {
    const rows = (this.healthStore.logs().data || []) as RefreshRequestLog[];
    const map = new Map<string, RefreshRequestLog[]>();

    for (const r of rows) {
      const sym = (r.symbol || '—').toUpperCase();
      const arr = map.get(sym);
      if (arr) arr.push(r); else map.set(sym, [r]);
    }

    const groups: SymbolGroup[] = [];
    const active = this.sortField();
    const dir = this.sortDir();
    for (const [symbol, events] of map.entries()) {
      const sorted = [...events].sort((a, b) => getTimeMs(b.timestamp) - getTimeMs(a.timestamp));
      const latest = sorted[0];
      const endpoints = new Set(sorted.map(e => e.endpointId || ''));
      const endpointCount = endpoints.size;
      const requestCount = sorted.length;
      // Build a stable base index for comparator tie-breaking
      const baseIndex = new Map<RefreshRequestLog, number>();
      sorted.forEach((ev, i) => baseIndex.set(ev, i));
      const comparator = buildEventComparator(active, dir, baseIndex);
      const tableEvents = (active === SortKeys.timestamp && dir === 'desc') ? sorted : [...sorted].sort(comparator);
      groups.push({ symbol, events: tableEvents, latest, endpointCount, requestCount });
    }

    groups.sort((a, b) => {
      const ta = a.latest ? getTimeMs(a.latest.timestamp) : 0;
      const tb = b.latest ? getTimeMs(b.latest.timestamp) : 0;
      if (tb !== ta) return tb - ta;
      return a.symbol.localeCompare(b.symbol);
    });

    return groups;
  });
}
