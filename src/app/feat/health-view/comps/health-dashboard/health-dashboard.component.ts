import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { HealthSummaryCardsComponent } from '../summary-cards/health-summary-cards.component';
import { HealthFiltersBarComponent } from '../filters-bar/health-filters-bar.component';
import { HealthRequestLogTableComponent } from '../request-log-table/health-request-log-table.component';
import { HealthEndpointDetailComponent } from '../endpoint-detail/health-endpoint-detail.component';
import { HealthSymbolDrawerComponent } from '../symbol-drawer/health-symbol-drawer.component';
import { HealthViewBase } from '../health-view-base/health-view-base.component';

@Component({
  selector: 'app-health-dashboard',
  standalone: true,
  imports: [
    HealthSummaryCardsComponent,
    HealthFiltersBarComponent,
    HealthRequestLogTableComponent,
    HealthEndpointDetailComponent,
    HealthSymbolDrawerComponent,
  ],
  templateUrl: './health-dashboard.component.html',
  styleUrls: ['./health-dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthDashboardComponent extends HealthViewBase implements OnInit {
  ngOnInit(): void {
    // Kick off initial loads
    this.healthStore.refreshAll();
  }
}
