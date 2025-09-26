import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-health-summary-cards',
  standalone: true,
  imports: [CommonModule, TsToIsoPipe, MatCardModule, MatButtonModule, MatIconModule],
  templateUrl: './health-summary-cards.component.html',
  styleUrls: ['./health-summary-cards.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSummaryCardsComponent extends HealthViewBase {
  // Endpoint KPI row (four cards)
  readonly endpointCards = computed(() => {
    const s = this.healthStore.summary();
    return [
      { key: 'totalEndpoints', label: 'Total', icon: 'dashboard', value: s?.totalEndpoints ?? 0 },
      { key: 'healthyEndpoints', label: 'Healthy', icon: 'check_circle', value: s?.healthyEndpoints ?? 0, clazz: 'healthy' },
      { key: 'degradedEndpoints', label: 'Degraded', icon: 'warning', value: s?.degradedEndpoints ?? 0, clazz: 'warn' },
      { key: 'errorEndpoints', label: 'Error', icon: 'error', value: s?.errorEndpoints ?? 0, clazz: 'error' },
    ];
  });

  // Symbols KPI row (four cards)
  readonly symbolCards = computed(() => {
    const s = this.healthStore.summary();
    return [
      { key: 'totalSymbols', label: 'Total', icon: 'insights', value: s?.totalSymbols ?? 0 },
      { key: 'freshSymbols', label: 'Fresh', icon: 'refresh', value: (s as any)?.freshSymbols ?? '—', clazz: 'healthy' },
      { key: 'staleSymbols', label: 'Stale', icon: 'schedule', value: s?.staleSymbols ?? 0, clazz: 'warn' },
      { key: 'errorSymbols', label: 'Error', icon: 'report', value: s?.errorSymbols ?? 0, clazz: 'error' },
    ];
  });
}
