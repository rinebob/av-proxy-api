import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import type { RefreshRequestLog } from '@shared/health-metrics';
import { RefreshStatus } from '@shared/firestore';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

interface EndpointGroup {
  endpointId: string;
  events: RefreshRequestLog[];
  latest?: RefreshRequestLog;
}

// Preferred display order for well-known endpoints
const ENDPOINT_PRIORITY: string[] = [
  AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
  AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
  AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
  AlphaVantageEndpoint.OVERVIEW,
  AlphaVantageEndpoint.HISTORICAL_OPTIONS,
];
const PRIORITY_INDEX = new Map(ENDPOINT_PRIORITY.map((id, i) => [id, i] as const));

// Endpoints to always render panels for (even if no events were returned)
const ALWAYS_RENDER: string[] = [
  AlphaVantageEndpoint.OVERVIEW,
  AlphaVantageEndpoint.HISTORICAL_OPTIONS,
];

type SortField = 'time' | 'symbol' | 'status';

@Component({
  selector: 'app-health-endpoint-detail',
  standalone: true,
  imports: [
    CommonModule,
    TsToIsoPipe,
    MatTableModule,
    MatChipsModule,
    MatIconModule,
    MatTooltipModule,
    MatExpansionModule,
  ],
  templateUrl: './health-endpoint-detail.component.html',
  styleUrls: ['./health-endpoint-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthEndpointDetailComponent extends HealthViewBase {
  protected readonly RefreshStatus = RefreshStatus;

  // Columns shown in the inner table for each endpoint panel
  readonly displayedColumns: ReadonlyArray<string> = [
    'time',
    'symbol',
    'status',
    'duration',
    'trigger',
    'responseSize',
    'error',
  ] as const;

  // Client-side sort state for per-panel tables
  readonly sortField = signal<SortField | null>(null);
  readonly sortDir = signal<'asc' | 'desc'>('desc');

  constructor() {
    super();
    // Default to time DESC so first toggle behavior is consistent and obvious
    this.sortField.set('time');
    this.sortDir.set('desc');
  }

  onHeaderSort(field: SortField): void {
    const active = this.sortField();
    const dir = this.sortDir();
    if (active === field) {
      this.sortDir.set(dir === 'desc' ? 'asc' : 'desc');
    } else {
      this.sortField.set(field);
      this.sortDir.set(field === 'time' ? 'desc' : 'asc');
    }
  }

  /* Coerce Firestore Timestamp | Date | number | string to epoch ms safely */
  private getTimeMs(val: any): number {
    if (!val) return 0;
    try {
      if (typeof val?.toDate === 'function') return val.toDate().getTime();
      if (val instanceof Date) return val.getTime();
      const d = new Date(val);
      const t = d.getTime();
      return isNaN(t) ? 0 : t;
    } catch {
      return 0;
    }
  }

  // TrackBy to stabilize identity while allowing order changes
  trackByEvent = (_: number, row: RefreshRequestLog) => row.id ?? `${this.getTimeMs(row.timestamp)}:${row.symbol ?? ''}`;

  // Group logs by endpoint and sort events according to sort state
  readonly groupedByEndpoint = computed<EndpointGroup[]>(() => {
    const items = this.healthStore.logs().data as RefreshRequestLog[];
    const selected = this.healthStore.filters().endpointIds || [];

    const map = new Map<string, RefreshRequestLog[]>();
    for (const it of items) {
      const key = it.endpointId || 'unknown';
      const arr = map.get(key);
      if (arr) arr.push(it); else map.set(key, [it]);
    }

    // Ensure selected endpoints with zero events still render a panel
    for (const ep of selected) {
      if (!map.has(ep)) map.set(ep, []);
    }

    // Ensure always-render endpoints are present too
    for (const ep of ALWAYS_RENDER) {
      if (!map.has(ep)) map.set(ep, []);
    }

    const groups: EndpointGroup[] = [];
    const active = this.sortField();
    const dir = this.sortDir();
    const factor = dir === 'asc' ? 1 : -1;

    // Rank for status primary comparison
    const statusRank = (s?: string) => (s === 'SUCCESS' ? 1 : s === 'FAILURE' ? 3 : 2);

    for (const [endpointId, events] of map.entries()) {
      // One-time base order: latest first (natural order)
      const baseOrder = [...events].sort((a, b) => this.getTimeMs(b.timestamp) - this.getTimeMs(a.timestamp));
      const baseIndex = new Map<RefreshRequestLog, number>();
      baseOrder.forEach((ev, i) => baseIndex.set(ev, i));

      const sortedEvents = [...events].sort((a, b) => {
        if (!active || active === 'time') {
          const ta = this.getTimeMs(a.timestamp);
          const tb = this.getTimeMs(b.timestamp);
          const cmp = ta - tb;
          if (cmp !== 0) return factor * cmp;
          // Neutral, deterministic fallback that also respects direction
          const ia = baseIndex.get(a) ?? 0;
          const ib = baseIndex.get(b) ?? 0;
          return factor * (ia - ib);
        }

        if (active === 'symbol') {
          const sa = (a.symbol || '').toUpperCase();
          const sb = (b.symbol || '').toUpperCase();
          const cmp = sa.localeCompare(sb);
          if (cmp !== 0) return factor * cmp;
          const ia = baseIndex.get(a) ?? 0;
          const ib = baseIndex.get(b) ?? 0;
          return factor * (ia - ib);
        }

        // active === 'status'
        const ra = statusRank(a.status as any);
        const rb = statusRank(b.status as any);
        const cmp = ra - rb;
        if (cmp !== 0) return factor * cmp;
        const ia = baseIndex.get(a) ?? 0;
        const ib = baseIndex.get(b) ?? 0;
        return factor * (ia - ib);
      });

      // Latest is the max timestamp regardless of current sort
      const latest = sortedEvents.length
        ? sortedEvents.reduce((acc, ev) => (this.getTimeMs(ev.timestamp) > this.getTimeMs(acc.timestamp) ? ev : acc))
        : undefined as unknown as RefreshRequestLog | undefined;

      groups.push({ endpointId, events: sortedEvents, latest });
    }

    // Sort groups: priority list first, then by latest timestamp desc, then by id asc
    groups.sort((a, b) => {
      const ai = PRIORITY_INDEX.has(a.endpointId) ? PRIORITY_INDEX.get(a.endpointId)! : Number.POSITIVE_INFINITY;
      const bi = PRIORITY_INDEX.has(b.endpointId) ? PRIORITY_INDEX.get(b.endpointId)! : Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
      const ta = a.latest ? this.getTimeMs(a.latest.timestamp as any) : 0;
      const tb = b.latest ? this.getTimeMs(b.latest.timestamp as any) : 0;
      if (tb !== ta) return tb - ta;
      return a.endpointId.localeCompare(b.endpointId);
    });
    return groups;
  });
}
