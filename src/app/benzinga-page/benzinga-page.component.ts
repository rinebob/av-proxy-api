import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatNativeDateModule } from '@angular/material/core';

@Component({
  selector: 'app-benzinga-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './benzinga-page.component.html',
  styleUrls: ['./benzinga-page.component.scss'],
  providers: [DatePipe]
})
export class BenzingaPageComponent implements OnInit {
  form: FormGroup;
  loading = false;
  error: string | null = null;

  constructor(
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private datePipe: DatePipe
  ) {
    this.form = this.fb.group({
      dateFrom: [null, Validators.required],
      dateTo: [null, Validators.required]
    });
  }

  ngOnInit(): void {
    // Set default date range (last 7 days)
    const today = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(today.getDate() - 7);
    
    this.form.patchValue({
      dateFrom: lastWeek,
      dateTo: today
    });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    this.error = null;

    try {
      const { dateFrom, dateTo } = this.form.value;
      // Format dates as YYYY-MM-DD for the API
      const fromDate = this.datePipe.transform(dateFrom, 'yyyy-MM-dd');
      const toDate = this.datePipe.transform(dateTo, 'yyyy-MM-dd');
      
      console.log('Fetching data from', fromDate, 'to', toDate);
      
      // TODO: Call your Benzinga service here
      // this.benzingaService.getCalendarData(fromDate, toDate).subscribe({
      //   next: (data) => {
      //     console.log('Data received:', data);
      //     this.loading = false;
      //   },
      //   error: (err) => {
      //     console.error('Error fetching data:', err);
      //     this.error = 'Failed to fetch data. Please try again.';
      //     this.showError();
      //     this.loading = false;
      //   }
      // });
      
      // Simulate API call
      setTimeout(() => {
        this.loading = false;
        this.snackBar.open('Data loaded successfully', 'Dismiss', {
          duration: 3000,
          panelClass: 'success-snackbar'
        });
      }, 1500);
      
    } catch (error) {
      console.error('Error:', error);
      this.error = 'An unexpected error occurred';
      this.showError();
      this.loading = false;
    }
  }

  private showError(): void {
    if (this.error) {
      this.snackBar.open(this.error, 'Dismiss', {
        duration: 5000,
        panelClass: 'error-snackbar'
      });
    }
  }

  /**
   * Returns a sample request object for display purposes
   */
  getSampleRequest(): any {
    const dateFrom = this.form.get('dateFrom')?.value;
    const dateTo = this.form.get('dateTo')?.value;
    
    return {
      dateFrom: dateFrom ? this.datePipe.transform(dateFrom, 'yyyy-MM-dd') : null,
      dateTo: dateTo ? this.datePipe.transform(dateTo, 'yyyy-MM-dd') : null,
      status: 'success',
      message: 'This is a sample request. The actual API call will be made with these parameters.'
    };
  }
}
