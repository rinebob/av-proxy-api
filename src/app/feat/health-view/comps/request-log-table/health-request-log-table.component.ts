import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-health-request-log-table',
  standalone: true,
  templateUrl: './health-request-log-table.component.html',
  styleUrl: './health-request-log-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthRequestLogTableComponent {}
