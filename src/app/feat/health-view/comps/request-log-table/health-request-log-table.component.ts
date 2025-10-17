import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';
import { TimeAgoPipe } from '../../pipes/time-ago.pipe';
import { RefreshStatus } from '@shared/firestore';
import { MatIconModule } from '@angular/material/icon';
import { SortDir, SortKey } from '@shared/health-metrics';

@Component({
  selector: 'app-health-request-log-table',
  standalone: true,
  imports: [CommonModule, TsToIsoPipe, TimeAgoPipe, MatIconModule],
  templateUrl: './health-request-log-table.component.html',
  styleUrls: ['./health-request-log-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthRequestLogTableComponent extends HealthViewBase {
  protected readonly RefreshStatus = RefreshStatus;
  readonly SortKey = SortKey;
  readonly Ui = { SortDir } as const;

  // Forward header sort events to the store so template bindings (healthStore.*) update correctly
  onHeaderSort(field: SortKey): void {
    this.healthStore.setLogsSort(field);
  }
}
