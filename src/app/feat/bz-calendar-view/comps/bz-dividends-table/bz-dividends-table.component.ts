import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DividendItem, BENZINGA_ENDPOINTS_MAP, BenzingaEndpoint } from '../../../../common/common-bz';
import { BenzingaCalendarStore } from '../../store/bz-calendar.store';
import { BzNoResultsComponent } from '../bz-no-results/bz-no-results.component';

/**
 * Dividends table for Benzinga calendar API responses.
 * Interacts directly with NgRx Signal Store for state.
 */
@Component({
  selector: 'bz-dividends-table',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    BzNoResultsComponent
  ],
  templateUrl: './bz-dividends-table.component.html',
  styleUrls: ['./bz-dividends-table.component.scss']
})
export class BzDividendsTableComponent {
  // Inject the store
  readonly bzCalendarStore = inject(BenzingaCalendarStore);

  // Access pagedResults and totalItems directly from the store
  dividends = this.bzCalendarStore.pagedResults;
  totalItems = this.bzCalendarStore.totalItems;

  // Use static endpointMeta and columns for dividends
  endpointMeta = BENZINGA_ENDPOINTS_MAP[BenzingaEndpoint.DIVIDENDS];
  columns = [
    'date',
    'ticker',
    'name',
    'dividend',
    'dividend_prior',
    'dividend_type',
    'dividend_yield',
    'ex_dividend_date',
    'record_date',
    'payable_date',
    'frequency',
    'currency',
    'importance',
    'exchange',
    'notes'
  ];
}
