import { Component, OnInit, inject } from '@angular/core';
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
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { BenzingaService, EarningsItem, EarningsParams } from '../services/benzinga.service';

interface EarningsResponse {
  earnings: EarningsItem[];
  [key: string]: any;
}

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
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTableModule,
    MatTabsModule
  ],
  templateUrl: './benzinga-page.component.html',
  styleUrls: ['./benzinga-page.component.scss'],
  providers: [DatePipe]
})
export class BenzingaPageComponent implements OnInit {
  private fb = inject(FormBuilder);
  private benzingaService = inject(BenzingaService);
  private snackBar = inject(MatSnackBar);
  private datePipe = inject(DatePipe);

  form: FormGroup;
  loading = false;
  error: string | null = null;
  earningsData: EarningsItem[] = [];
  displayedColumns: string[] = [
    'date',
    'ticker',
    'name',
    'period',
    'eps_est',
    'eps_act',
    'eps_surprise_percent',
    'revenue_est',
    'revenue_act',
    'revenue_surprise_percent',
    'conference_call'
  ];

  constructor() { 
    // Set default date range: Jan 1, 2023 to June 30, 2025
    const defaultStartDate = new Date(2023, 0, 1); // Note: months are 0-indexed (0 = January)
    const defaultEndDate = new Date(2025, 5, 30);  // 5 = June (0-indexed)
    
    this.form = this.fb.group({
      ticker: ['NVDA', [Validators.required, Validators.pattern('^[A-Za-z]{1,5}$')]],
      dateFrom: [defaultStartDate],
      dateTo: [defaultEndDate],
      pageSize: [10, [Validators.min(1), Validators.max(100)]]
    });
  }

  ngOnInit(): void {
    
  }

  /**
   * Handles form submission
   */
  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    this.error = null;
    this.earningsData = [];

    const { ticker, dateFrom, dateTo, pageSize } = this.form.value;
    
    // Format dates to YYYY-MM-DD
    const fromDate = this.datePipe.transform(dateFrom, 'yyyy-MM-dd');
    const toDate = this.datePipe.transform(dateTo, 'yyyy-MM-dd');
    
    // Build query parameters
    const params: EarningsParams = {
      tickers: ticker.toUpperCase(),  
      pagesize: pageSize || 10,       
      type: 'earnings'               
    };

    // Add date range if provided
    if (fromDate) {
      params.date_from = fromDate;
    }
    
    if (toDate) {
      params.date_to = toDate;
    }

    // Make the API call
    this.benzingaService.getEarnings(params).subscribe({
      next: (response) => {
        this.earningsData = (response.earnings || []).map(item => ({
          ...item,
          date: item.date || '',
          ticker: item.ticker || '',
          name: item.name || '',
          period: item.period || '',
          eps_est: item.eps_est != null ? +item.eps_est : null,
          eps_act: item.eps_act != null ? +item.eps_act : null,
          revenue_est: item.revenue_est != null ? +item.revenue_est : null,
          revenue_act: item.revenue_act != null ? +item.revenue_act : null,
          time: item.time || 'After Market',
          updated: item.updated || ''
        }));
        
        // Show success message if no data was returned
        if (this.earningsData.length === 0) {
          this.showInfo('No earnings data found for the specified criteria.');
        }
      },
      error: (error) => {
        console.error('Error fetching earnings data:', error);
        this.error = 'Failed to fetch earnings data. Please try again.';
        this.showError(this.error);
        this.loading = false;  // Reset loading state on error
      },
      complete: () => {
        this.loading = false;  // This will still run on successful completion
      }
    });
  }

  formatCurrency(value: number | null | undefined): string {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value / 100);
  }

  hasConferenceCall(item: EarningsItem): string {
    return item.conference_call ? 'Yes' : 'No';
  }

  getSampleRequest() {
    const { ticker, dateFrom, dateTo, pageSize } = this.form?.value || {};
    return {
      ticker: ticker || 'NVDA',
      dateFrom: dateFrom ? new Date(dateFrom).toISOString().split('T')[0] : '',
      dateTo: dateTo ? new Date(dateTo).toISOString().split('T')[0] : '',
      pageSize: pageSize || 10
    };
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  private showInfo(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 3000,
      panelClass: ['info-snackbar']
    });
  }
}
