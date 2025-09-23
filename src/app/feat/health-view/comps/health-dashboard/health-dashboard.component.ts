import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-health-dashboard',
  standalone: true,
  templateUrl: './health-dashboard.component.html',
  styleUrl: './health-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthDashboardComponent {
  // View-level container for Health Metrics Dashboard
  // Store wiring will be added later.
}
