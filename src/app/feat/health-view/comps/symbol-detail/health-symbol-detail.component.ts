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
import { getTimeMs, buildEventComparator } from '../../utils/health-transforms';
import { SortKey, SortDir, SymbolGroupSortMode } from '@shared/health-metrics';
import { HEALTH_LABEL_EM_DASH } from '../../common/health-constants';

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
  readonly SortKey = SortKey;
  readonly Ui = { SortDir, GroupSortMode: SymbolGroupSortMode } as const;
  readonly sortField = signal<SortKey | null>(SortKey.TIMESTAMP);
  readonly sortDir = signal<SortDir>(SortDir.DESC);

  // Group sort toggle for symbol panels: 'alpha' | 'recent'
  readonly groupSortMode = signal<SymbolGroupSortMode>(SymbolGroupSortMode.ALPHA);
  setGroupSort(mode: SymbolGroupSortMode) { this.groupSortMode.set(mode); }

  // Ref to all panels for expand/collapse all
  @ViewChildren(MatExpansionPanel) private panels!: QueryList<MatExpansionPanel>;

  expandAll(): void { this.panels?.forEach(p => p.open()); }
  collapseAll(): void { this.panels?.forEach(p => p.close()); }

  onHeaderSort(field: SortKey): void {
    const active = this.sortField();
    const dir = this.sortDir();
    if (active === field) {
      this.sortDir.set(dir === SortDir.DESC ? SortDir.ASC : SortDir.DESC);
    } else {
      this.sortField.set(field);
      this.sortDir.set(field === SortKey.TIMESTAMP ? SortDir.DESC : SortDir.ASC);
    }
  }

  // Table columns used inside each expansion panel
  readonly displayedColumns: ReadonlyArray<string> = ['time', 'timeAgo', 'endpoint', 'status', 'trigger', 'duration'];

  // Group all current-page logs by symbol, sorted by latest event desc, with events sorted latest-first
  readonly symbolGroups = computed<SymbolGroup[]>(() => {
    const rows = (this.healthStore.logs().data || []) as RefreshRequestLog[];
    const map = new Map<string, RefreshRequestLog[]>();

    for (const r of rows) {
      const sym = (r.symbol || HEALTH_LABEL_EM_DASH).toUpperCase();
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
      const tableEvents = (active === SortKey.TIMESTAMP && dir === SortDir.DESC) ? sorted : [...sorted].sort(comparator);
      groups.push({ symbol, events: tableEvents, latest, endpointCount, requestCount });
    }

    // Apply group ordering based on toggle
    const mode = this.groupSortMode();
    if (mode === SymbolGroupSortMode.RECENT) {
      // Order by latest activity (desc), tie-breaker by symbol
      groups.sort((a, b) => {
        const ta = a.latest ? getTimeMs(a.latest.timestamp) : 0;
        const tb = b.latest ? getTimeMs(b.latest.timestamp) : 0;
        if (tb !== ta) return tb - ta;
        return a.symbol.localeCompare(b.symbol);
      });
    } else {
      // Strict alphabetical A→Z
      groups.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }

    return groups;
  });
}
