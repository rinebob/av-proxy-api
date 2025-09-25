import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';

@Component({
  selector: 'app-health-endpoint-detail',
  standalone: true,
  imports: [CommonModule, TsToIsoPipe],
  templateUrl: './health-endpoint-detail.component.html',
  styleUrls: ['./health-endpoint-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthEndpointDetailComponent extends HealthViewBase {}
