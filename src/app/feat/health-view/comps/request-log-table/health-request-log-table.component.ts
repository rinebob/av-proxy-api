import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-health-request-log-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './health-request-log-table.component.html',
  styleUrls: ['./health-request-log-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthRequestLogTableComponent extends HealthViewBase {}
