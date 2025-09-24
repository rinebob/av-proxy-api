import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-health-symbol-drawer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './health-symbol-drawer.component.html',
  styleUrls: ['./health-symbol-drawer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSymbolDrawerComponent extends HealthViewBase {}
