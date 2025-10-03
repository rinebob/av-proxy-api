import { ChangeDetectionStrategy, Component, computed, signal, ViewChildren, QueryList } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';
import { TimeAgoPipe } from '../../pipes/time-ago.pipe';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule, MatExpansionPanel } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import type { RefreshRequestLog } from '@shared/health-metrics';
import { RefreshStatus } from '@shared/firestore';
import { SortKey, SortDir, EndpointGroupSortMode } from '@shared/health-metrics';
import type { EndpointGroup } from '../../common/health-constants';
import { getTimeMs, buildEventComparator } from '../../utils/health-transforms';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

@Component({
  selector: 'app-health-endpoint-detail',
  standalone: true,
  imports: [
    CommonModule,
    TsToIsoPipe,
    TimeAgoPipe,
    MatTableModule,
    MatChipsModule,
    MatIconModule,
    MatTooltipModule,
    MatExpansionModule,
    MatButtonModule,
  ],
  templateUrl: './health-endpoint-detail.component.html',
  styleUrls: ['./health-endpoint-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthEndpointDetailComponent extends HealthViewBase {
  protected readonly RefreshStatus = RefreshStatus;

  // Expose enums for template use
  readonly SortKey = SortKey;
  readonly Ui = { SortDir, GroupSortMode: EndpointGroupSortMode } as const;

  // Group sort toggle for endpoint panels: 'priority' | 'alpha' | 'recent'
  // Default: 'priority' (TS endpoints ordered Daily→Weekly→Monthly; others A→Z after)
  readonly groupSortMode = signal<EndpointGroupSortMode>(EndpointGroupSortMode.PRIORITY);
  setGroupSort(mode: EndpointGroupSortMode) { this.groupSortMode.set(mode); }

  // Natural time-series interval ordering for AV endpoints
  private static readonly TS_PRIORITY_ORDER = [
    AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
    AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
  ] as const;
  private static readonly TS_RANK: Readonly<Record<string, number>> =
    HealthEndpointDetailComponent.TS_PRIORITY_ORDER
      .reduce((acc, id, idx) => ({ ...acc, [id]: idx }), {} as Record<string, number>);

  // Reference all expansion panels to support expand/collapse all actions
  @ViewChildren(MatExpansionPanel) private panels!: QueryList<MatExpansionPanel>;

  // Columns shown in the inner table for each endpoint panel
  readonly displayedColumns: ReadonlyArray<string> = [
    'time',
    'timeAgo',
    'symbol',
    'status',
    'duration',
    'trigger',
    'responseSize',
    'error',
  ] as const;

  // Client-side sort state for per-panel tables
  readonly sortField = signal<SortKey | null>(null);
  readonly sortDir = signal<SortDir>(SortDir.DESC);

  // UI group type with counts
  private readonly countGroups = (events: RefreshRequestLog[]) => {
    const syms = new Set<string>();
    for (const ev of events) {
      const s = (ev.symbol || '').toUpperCase();
      if (s) syms.add(s);
    }
    return { symbolCount: syms.size, requestCount: events.length } as const;
  };

  constructor() {
    super();
    // Default to time DESC so first toggle behavior is consistent and obvious
    this.sortField.set(SortKey.TIMESTAMP);
    this.sortDir.set(SortDir.DESC);
  }

  // Expand/collapse controls
  expandAll(): void {
    this.panels?.forEach(p => p.open());
  }
  collapseAll(): void {
    this.panels?.forEach(p => p.close());
  }

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

  // TrackBy to stabilize identity while allowing order changes
  trackByEvent = (_: number, row: RefreshRequestLog) => row.id ?? `${getTimeMs(row.timestamp)}:${row.symbol ?? ''}`;

  // Apply UI-specific sorting to events, using base grouped+prioritized data from the store
  readonly groupedByEndpoint = computed<(EndpointGroup & { symbolCount: number; requestCount: number })[]>(() => {
    // Start from store-provided groups (already contain latest)
    const base = (this.healthStore as any).sortedEndpointGroupsByPriority() as EndpointGroup[];
    // Apply group ordering based on toggle
    const mode = this.groupSortMode();
    let baseGroups: EndpointGroup[];
    if (mode === EndpointGroupSortMode.ALPHA) {
      baseGroups = [...base].sort((a, b) => a.endpointId.localeCompare(b.endpointId));
    } else if (mode === EndpointGroupSortMode.RECENT) {
      baseGroups = [...base].sort((a, b) => {
        const ta = a.latest ? getTimeMs(a.latest.timestamp) : 0;
        const tb = b.latest ? getTimeMs(b.latest.timestamp) : 0;
        if (tb !== ta) return tb - ta;
        return a.endpointId.localeCompare(b.endpointId);
      });
    } else {
      // priority: Only time-series endpoints get ordered Daily→Weekly→Monthly, then others A→Z
      const rank = HealthEndpointDetailComponent.TS_RANK;
      baseGroups = [...base].sort((a, b) => {
        const ra = rank[a.endpointId as string];
        const rb = rank[b.endpointId as string];
        const aIsTs = Number.isFinite(ra);
        const bIsTs = Number.isFinite(rb);
        if (aIsTs && bIsTs) return (ra as number) - (rb as number);
        if (aIsTs && !bIsTs) return -1;
        if (!aIsTs && bIsTs) return 1;
        // neither is TS -> alpha
        return a.endpointId.localeCompare(b.endpointId);
      });
    }
    const active = this.sortField();
    const dir = this.sortDir();

    return baseGroups.map((g) => {
      // Stable base order by latest-first within the group
      const baseOrder = [...g.events].sort((a, b) => getTimeMs(b.timestamp) - getTimeMs(a.timestamp));
      const baseIndex = new Map<RefreshRequestLog, number>();
      baseOrder.forEach((ev, i) => baseIndex.set(ev, i));

      const comparator = buildEventComparator(active, dir, baseIndex);

      // Default newest-first unless user explicitly changes to a different sort
      const useBaseNewestFirst = active === SortKey.TIMESTAMP && dir === SortDir.DESC;
      const events = useBaseNewestFirst ? baseOrder : [...g.events].sort(comparator);

      const { symbolCount, requestCount } = this.countGroups(events);
      // Keep latest from base (already computed in store) to avoid recomputing here
      return { endpointId: g.endpointId, events, latest: g.latest, symbolCount, requestCount } as EndpointGroup & { symbolCount: number; requestCount: number };
    });
  });
}
