import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-health-filters-bar',
  standalone: true,
  templateUrl: './health-filters-bar.component.html',
  styleUrl: './health-filters-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthFiltersBarComponent {}
