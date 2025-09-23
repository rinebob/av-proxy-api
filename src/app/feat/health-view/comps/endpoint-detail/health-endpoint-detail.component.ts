import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-health-endpoint-detail',
  standalone: true,
  templateUrl: './health-endpoint-detail.component.html',
  styleUrl: './health-endpoint-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthEndpointDetailComponent {}
