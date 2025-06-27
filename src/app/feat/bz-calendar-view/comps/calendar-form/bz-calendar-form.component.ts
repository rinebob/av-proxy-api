import { Component, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { BenzingaCalendarStore } from '../../store/bz-calendar.store';
import { BenzingaEndpoint } from '../../../../common/common-bz';
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
  public readonly BenzingaEndpoint = BenzingaEndpoint;

  private getDefaultStartDate(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1); // 1 year ago
    return date;
  }

  searchForm = new FormGroup({
    calendarType: new FormControl(this.bzCalendarStore.selectedEndpoint(), Validators.required),
    ticker: new FormControl('', [Validators.required, Validators.pattern('^[A-Za-z]{1,5}$')]),
    startDate: new FormControl(this.getDefaultStartDate(), Validators.required),
    endDate: new FormControl(new Date(), Validators.required),
    // Dividend-specific fields (conditionally enabled)
    dividendYieldGt: new FormControl(''),
    dateSort: new FormControl('desc')
  });

  ngOnInit() {
    // Sync calendarType with store and adjust fields on endpoint change
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
      const found = paramMetas.some(pm => pm.formKey === key);
      if (found) {
        this.searchForm.get(key)?.enable({ emitEvent: false });
      } else {
        this.searchForm.get(key)?.disable({ emitEvent: false });
      }
    });
  }

  onSubmit() {
    if (this.searchForm.invalid) {
      // Optionally, show validation errors here
      this.searchForm.markAllAsTouched();
      return;
    }
    const { calendarType, ticker, startDate, endDate, dividendYieldGt, dateSort } = this.searchForm.value;
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
    const params: any = {
      calendarType: calendarType as BenzingaEndpoint,
      ticker: ticker?.toUpperCase(), // for store signals and UI logic
      tickers: ticker?.toUpperCase(), // for API
      date_from: startDate.toISOString().slice(0, 10),
      date_to: endDate.toISOString().slice(0, 10),
      page: 0, // default page
      pagesize: 20 // default page size (could be made configurable)
    };
    // If dividends, include dividend-specific params if filled
    if (calendarType === BenzingaEndpoint.DIVIDENDS) {
      if (dividendYieldGt) params.dividendYieldGt = dividendYieldGt;
      if (dateSort) params.dateSort = `date:${dateSort}`;
    }
    this.bzCalendarStore.searchCalendar(params);
  }
}



