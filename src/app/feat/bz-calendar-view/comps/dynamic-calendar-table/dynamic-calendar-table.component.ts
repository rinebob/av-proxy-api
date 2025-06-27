import { Component, Input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BzNoResultsComponent } from '../bz-no-results/bz-no-results.component';
import type { BenzingaEndpointMetadata } from '../../../../common/common-bz';
import { BENZINGA_ENDPOINTS_MAP } from '../../../../common/common-bz';
import { BzCalendarViewBaseComponent } from '../../bz-calendar-view-base.component';
import { AbbreviateCurrencyPipe } from "../../../../shared/pipes/abbreviate-currency.pipe";
import { TruncatePipe } from "../../../../shared/pipes/truncate.pipe";

@Component({
  selector: 'dynamic-calendar-table',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    BzNoResultsComponent,
    AbbreviateCurrencyPipe,
    TruncatePipe
],
  templateUrl: './dynamic-calendar-table.component.html',
  styleUrls: ['./dynamic-calendar-table.component.scss']
})
export class DynamicCalendarTableComponent extends BzCalendarViewBaseComponent {
  // Computes the array of column keys for the current endpoint
  readonly columnKeys = computed(() =>
    this.bzCalendarStore.selectedEndpointMeta()?.columns.map(c => c.key) ?? []
  );
}

