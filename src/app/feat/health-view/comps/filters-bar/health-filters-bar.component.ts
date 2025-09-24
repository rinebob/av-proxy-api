import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-health-filters-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './health-filters-bar.component.html',
  styleUrls: ['./health-filters-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthFiltersBarComponent extends HealthViewBase {}
