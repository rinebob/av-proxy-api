import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-health-symbol-drawer',
  standalone: true,
  templateUrl: './health-symbol-drawer.component.html',
  styleUrl: './health-symbol-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSymbolDrawerComponent {}
