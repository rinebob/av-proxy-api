import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AbbreviateCurrencyPipe } from '../../../../shared/pipes/abbreviate-currency.pipe';
import { EarningsItem, BENZINGA_ENDPOINTS_MAP, BenzingaEndpoint } from '../../../../common/common-bz';
import { BenzingaCalendarStore } from '../../store/bz-calendar.store';
import { BzNoResultsComponent } from "../bz-no-results/bz-no-results.component";

/**
 * Earnings table for Benzinga calendar API responses.
 * Interacts directly with NgRx Signal Store for state.
 */
@Component({
  selector: 'bz-earnings-table',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    AbbreviateCurrencyPipe,
    BzNoResultsComponent
],
  templateUrl: './bz-earnings-table.component.html',
  styleUrls: ['./bz-earnings-table.component.scss']
})
export class BzEarningsTableComponent {
  // Inject the store
  readonly bzCalendarStore = inject(BenzingaCalendarStore);

  // Access pagedResults and totalItems directly from the store
  earnings = this.bzCalendarStore.pagedResults;
  totalItems = this.bzCalendarStore.totalItems;

  isDuplicationEnabled = signal(false);

  // Use static endpointMeta for earnings
  endpointMeta = BENZINGA_ENDPOINTS_MAP[BenzingaEndpoint.EARNINGS];
  // Array of column keys for table rendering (metadata-driven)
  columns = this.endpointMeta.columns.map(c => c.key);

  toggleDuplication() {
    this.isDuplicationEnabled.update(v => !v);
  }
}

