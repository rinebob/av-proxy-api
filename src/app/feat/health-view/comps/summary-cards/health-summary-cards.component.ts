import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';

@Component({
  selector: 'app-health-summary-cards',
  standalone: true,
  imports: [CommonModule, TsToIsoPipe],
  templateUrl: './health-summary-cards.component.html',
  styleUrls: ['./health-summary-cards.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSummaryCardsComponent extends HealthViewBase {}
