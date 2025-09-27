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
import type { EndpointGroup } from '../../utils/health-constants';
import { getTimeMs, buildEventComparator, type SortField, SortKeys } from '../../utils/health-transforms';

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

  // Expose sort keys object for template usage
  readonly SortKeys = SortKeys;

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
    this.sortField.set(SortKeys.timestamp);
    this.sortDir.set('desc');
  }

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

  // TrackBy to stabilize identity while allowing order changes
  trackByEvent = (_: number, row: RefreshRequestLog) => row.id ?? `${getTimeMs(row.timestamp)}:${row.symbol ?? ''}`;

  // Apply UI-specific sorting to events, using base grouped+prioritized data from the store
  readonly groupedByEndpoint = computed<EndpointGroup[]>(() => {
    const baseGroups = (this.healthStore as any).sortedEndpointGroupsByPriority() as EndpointGroup[];
    const active = this.sortField();
    const dir = this.sortDir();

    return baseGroups.map((g) => {
      // Stable base order by latest-first within the group
      const baseOrder = [...g.events].sort((a, b) => getTimeMs(b.timestamp) - getTimeMs(a.timestamp));
      const baseIndex = new Map<RefreshRequestLog, number>();
      baseOrder.forEach((ev, i) => baseIndex.set(ev, i));

      const comparator = buildEventComparator(active, dir, baseIndex);
      const events = [...g.events].sort(comparator);

      // Keep latest from base (already computed in store) to avoid recomputing here
      return { endpointId: g.endpointId, events, latest: g.latest } as EndpointGroup;
    });
  });
}
