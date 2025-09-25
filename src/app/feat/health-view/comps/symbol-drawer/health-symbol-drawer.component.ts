import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { CommonModule } from '@angular/common';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';

@Component({
  selector: 'app-health-symbol-drawer',
  standalone: true,
  imports: [CommonModule, TsToIsoPipe],
  templateUrl: './health-symbol-drawer.component.html',
  styleUrls: ['./health-symbol-drawer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSymbolDrawerComponent extends HealthViewBase {}
