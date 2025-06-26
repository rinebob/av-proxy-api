import { Component } from '@angular/core';
import { FormGroup, FormControl, Validators } from '@angular/forms';
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
    MatButtonToggleModule
  ],
  templateUrl: './bz-calendar-form.component.html',
  styleUrls: ['./bz-calendar-form.component.scss']
})
export class BzCalendarFormComponent {
  private getDefaultStartDate(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1); // 1 year ago
    return date;
  }

  searchForm = new FormGroup({
    calendarType: new FormControl(BenzingaEndpoint.EARNINGS, Validators.required),
    ticker: new FormControl('', [Validators.required, Validators.pattern('^[A-Za-z]{1,5}$')]),
    startDate: new FormControl(this.getDefaultStartDate(), Validators.required),
    endDate: new FormControl(new Date(), Validators.required)
  });
}


