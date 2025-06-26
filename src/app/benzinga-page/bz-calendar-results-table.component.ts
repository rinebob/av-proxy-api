import { Component, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AbbreviateCurrencyPipe } from '../shared/pipes/abbreviate-currency.pipe';
import { EarningsItem, BENZINGA_ENDPOINTS_MAP, BenzingaEndpoint } from '../common/common-bz';

/**
 * Results table for Benzinga calendar API responses.
 * Interacts directly with NgRx Signal Store for state.
 */
@Component({
  selector: 'bz-calendar-results-table',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    AbbreviateCurrencyPipe
  ],
  templateUrl: './bz-calendar-results-table.component.html',
  styleUrls: ['./bz-calendar-results-table.component.scss']
})
export class BzCalendarResultsTableComponent {
  earnings = input.required<EarningsItem[]>();
  totalItems = input.required<number>();

  isDuplicationEnabled = signal(false);

  toggleDuplication() {
    this.isDuplicationEnabled.update(v => !v);
  }

  // Use the displayedColumns from the earnings endpoint metadata
  displayedColumns = BENZINGA_ENDPOINTS_MAP[BenzingaEndpoint.EARNINGS].displayedColumns;
}
