import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';
import { RefreshStatus } from '@shared/firestore';
import { MatIconModule } from '@angular/material/icon';
import { SortKeys, type SortField } from '../../utils/health-transforms';

@Component({
  selector: 'app-health-request-log-table',
  standalone: true,
  imports: [CommonModule, TsToIsoPipe, MatIconModule],
  templateUrl: './health-request-log-table.component.html',
  styleUrls: ['./health-request-log-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthRequestLogTableComponent extends HealthViewBase {
  protected readonly RefreshStatus = RefreshStatus;
  readonly SortKeys = SortKeys;

  // Forward header sort events to the store so template bindings (healthStore.*) update correctly
  onHeaderSort(field: SortField): void {
    this.healthStore.setLogsSort(field);
  }
}
