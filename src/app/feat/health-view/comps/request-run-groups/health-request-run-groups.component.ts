import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule, MatAccordion } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { HealthViewBase } from '../health-view-base/health-view-base.component';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';
import { TimeAgoPipe } from '../../pipes/time-ago.pipe';
import { RefreshStatus } from '@shared/firestore';
import { DayOfWeekPipe } from '../../pipes/day-of-week.pipe';

@Component({
  selector: 'app-health-request-run-groups',
  standalone: true,
  imports: [CommonModule, MatExpansionModule, MatIconModule, MatButtonModule, TsToIsoPipe, TimeAgoPipe, DayOfWeekPipe],
  templateUrl: './health-request-run-groups.component.html',
  styleUrls: ['./health-request-run-groups.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthRequestRunGroupsComponent extends HealthViewBase {
  protected readonly RefreshStatus = RefreshStatus;

  // TODO(shared-controls): extract Expand/Collapse controls into a shared header-controls
  // standalone component (e.g., FilterControlsComponent) that accepts a context/config to
  // show/hide specific buttons (expand/collapse/priority/most recent/A→Z), mirroring the
  // Endpoint and Symbol detail panels. Keep this inline usage for now.

  // Programmatic control of the accordion for Expand/Collapse All actions (signal-based)
  protected readonly runs = viewChild(MatAccordion);

  protected uppercase(v: unknown): string {
    if (v == null) return '';
    try { return String(v).toUpperCase(); } catch { return ''; }
  }

  protected openSymbolIfAny(symbol?: string): void {
    if (symbol) this.healthStore.openSymbol(symbol);
  }
}
