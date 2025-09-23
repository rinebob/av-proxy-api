import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-health-summary-cards',
  standalone: true,
  templateUrl: './health-summary-cards.component.html',
  styleUrl: './health-summary-cards.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSummaryCardsComponent {}
