import { Component, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { BenzingaEndpoint, BENZINGA_PARAM_META_MAP, BenzingaCalendarParam, BenzingaCalendarParamFormField } from '../../../../common/fe-common-bz';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSelectModule } from '@angular/material/select';
import { BzCalendarViewBaseComponent } from '../../bz-calendar-view-base.component';

/**
 * Dynamic Benzinga calendar form.
 * Interacts directly with NgRx Signal Store for state.
 */
@Component({
  selector: 'bz-calendar-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatButtonModule,
    MatIconModule,
    MatNativeDateModule,
    MatButtonToggleModule,
    MatSelectModule
  ],
  templateUrl: './bz-calendar-form.component.html',
  styleUrls: ['./bz-calendar-form.component.scss']
})
export class BzCalendarFormComponent extends BzCalendarViewBaseComponent implements OnInit {
  public readonly BENZINGA_PARAM_META_MAP = BENZINGA_PARAM_META_MAP;
  public readonly BenzingaEndpoint = BenzingaEndpoint;
  public readonly BenzingaCalendarParam = BenzingaCalendarParam;
  public readonly BenzingaCalendarParamFormField = BenzingaCalendarParamFormField;

  private getDefaultStartDate(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1); // 1 year ago
    return date;
  }

  /**
 * Form group for Benzinga calendar search.
 * - parameters[dividend_yield_operation]: enum (gt, gte, eq, lte, lt)
 * - parameters[dividend_yield]: number
 */
searchForm = new FormGroup({
  calendarType: new FormControl(this.bzCalendarStore.selectedEndpoint(), Validators.required),
  tickers: new FormControl('', [Validators.required, Validators.pattern('^[A-Za-z]{1,5}$')]),
  startDate: new FormControl(this.getDefaultStartDate(), Validators.required),
  endDate: new FormControl(new Date(), Validators.required),
  // Dividend-specific fields (conditionally enabled)
  sort: new FormControl('desc'),
  // --- Dynamic Benzinga params ---
  pagesize: new FormControl(20, [Validators.min(1), Validators.max(1000)]),
  importance: new FormControl(null, [Validators.min(0), Validators.max(5)]),
  updated: new FormControl(null),
  /**
   * Dividend yield operation (gt, gte, eq, lte, lt)
   * Only used for DIVIDENDS endpoint
   */
  dividendYieldOperation: new FormControl('eq'),
  /**
   * Dividend yield value (number)
   * Only used for DIVIDENDS endpoint
   */
  dividendYield: new FormControl(null, [Validators.min(0)]),
  /**
   * Dividend dateSort (announced, ex, payable, record)
   * Only used for DIVIDENDS endpoint
   */
  dateSort: new FormControl('')
});

  ngOnInit() {
    // Sync endpoint with store and adjust fields on endpoint change
    this.bzCalendarStore.selectedEndpointMeta$
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe(endpointMeta => {
        this.searchForm.get('calendarType')?.setValue(endpointMeta?.name as BenzingaEndpoint | null, { emitEvent: false });
        this.adjustFormFields();
      });
    // Initial adjustment
    this.adjustFormFields();
  }


  private adjustFormFields() {
    const meta = this.bzCalendarStore.selectedEndpointMeta();
    const paramMetas = meta?.params ?? [];
    // Enable/disable fields based on endpoint metadata
    Object.keys(this.searchForm.controls).forEach(key => {
      if (key === 'calendarType') return;
      const found = paramMetas.some(pm => pm === key);
      if (found) {
        this.searchForm.get(key)?.enable({ emitEvent: false });
      } else {
        this.searchForm.get(key)?.disable({ emitEvent: false });
      }
    });
  }

  onSubmit() {
    if (this.searchForm.invalid) {
      this.searchForm.markAllAsTouched();
      return;
    }
    const { calendarType, tickers, startDate, endDate, sort, pagesize, importance, updated, dividendYieldOperation, dividendYield, dateSort } = this.searchForm.value;
    // Defensive: ensure dates are Date objects
    if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
      // Optionally, show error
      return;
    }
    // Defensive: ensure calendarType is present and valid
    if (!calendarType) {
      // Optionally, show error
      return;
    }
    // Prepare params for API
    const endpointMeta = this.bzCalendarStore.selectedEndpointMeta();
    const params: any = {
      calendarType: calendarType as BenzingaEndpoint,
      date_from: startDate.toISOString().slice(0, 10),
      date_to: endDate.toISOString().slice(0, 10),
      page: 0
    };
    // Dynamic params
    if (pagesize) params.pagesize = pagesize;
    if (importance !== null && importance !== undefined) params['parameters[importance]'] = importance;
    if (updated) {
      // Accepts either a Date or a number (timestamp)
      params['parameters[updated]'] = typeof updated === 'number' ? updated : Math.floor(new Date(updated).getTime() / 1000);
    }
    // Only include ticker/tickers if endpoint metadata params includes ticker
    if (endpointMeta?.params.some(p => p === BenzingaCalendarParam.TICKERS)) {
      params.tickers = tickers?.toUpperCase();
    }
    // If dividends, include dividend-specific params if filled
    if (calendarType === BenzingaEndpoint.DIVIDENDS) {
      if (sort) params.sort = `date:${sort}`;
      if (dividendYieldOperation) params['parameters[dividend_yield_operation]'] = dividendYieldOperation;
      if (dividendYield !== null && dividendYield !== undefined && dividendYield !== '') params['parameters[dividend_yield]'] = dividendYield;
      if (dateSort) params['parameters[date_sort]'] = dateSort;
    }
    this.bzCalendarStore.searchCalendar(params);
  }
}



