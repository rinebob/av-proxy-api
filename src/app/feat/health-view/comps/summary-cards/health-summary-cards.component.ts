import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';

@Component({
  selector: 'app-health-summary-cards',
  standalone: true,
  imports: [CommonModule, TsToIsoPipe, MatCardModule, MatButtonModule, MatIconModule, MatExpansionModule],
  templateUrl: './health-summary-cards.component.html',
  styleUrls: ['./health-summary-cards.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSummaryCardsComponent extends HealthViewBase {
  // Endpoint KPI row (aligned to current time window via logs)
  readonly endpointCards = computed(() => {
    const k = this.healthStore.endpointWindowKpis();
    return [
      { key: 'totalEndpoints', label: 'Total', icon: 'dashboard', value: k.total },
      { key: 'healthyEndpoints', label: 'Healthy', icon: 'check_circle', value: k.healthy, clazz: 'healthy' },
      { key: 'degradedEndpoints', label: 'Degraded', icon: 'warning', value: k.degraded, clazz: 'warn' },
      { key: 'errorEndpoints', label: 'Error', icon: 'error', value: k.error, clazz: 'error' },
    ];
  });

  // Symbols KPI row (endpoint+symbol latest event, TTL-aware for fresh/stale, aligned to window)
  readonly symbolCards = computed(() => {
    const s = this.healthStore.symbolWindowKpis();
    return [
      { key: 'totalSymbols', label: 'Total', icon: 'insights', value: s.total },
      { key: 'freshSymbols', label: 'Fresh', icon: 'refresh', value: s.fresh, clazz: 'healthy' },
      { key: 'staleSymbols', label: 'Stale', icon: 'schedule', value: s.stale, clazz: 'warn' },
      { key: 'errorSymbols', label: 'Error', icon: 'report', value: s.error, clazz: 'error' },
    ];
  });

  // Requests KPI row (aligned to window)
  readonly requestCards = computed(() => {
    const r = this.healthStore.requestTotals();
    return [
      { key: 'totalRequests', label: 'Total', icon: 'list_alt', value: r.total },
      { key: 'successRequests', label: 'Success', icon: 'check_circle', value: r.success, clazz: 'healthy' },
      { key: 'failedRequests', label: 'Failure', icon: 'error', value: r.failure, clazz: 'error' },
      { key: 'degradedRequests', label: 'Degraded (EP)', icon: 'warning', value: (r as any).degraded ?? 0, clazz: 'warn' },
    ];
  });
}
