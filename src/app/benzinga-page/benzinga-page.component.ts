import { Component, inject, OnInit, ViewChild } from '@angular/core';
import { signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDatepicker } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { BenzingaService, EarningsItem } from '../services/benzinga.service';
import { AbbreviateCurrencyPipe } from '../shared/pipes/abbreviate-currency.pipe';

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
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTableModule,
    MatTabsModule,
    AbbreviateCurrencyPipe
  ],
  templateUrl: './benzinga-page.component.html',
  styleUrls: ['./benzinga-page.component.scss'],
  providers: [DatePipe]
})
export class BenzingaPageComponent implements OnInit {
  // Services
  private fb = inject(FormBuilder);
  private benzingaService = inject(BenzingaService);
  private snackBar = inject(MatSnackBar);
  private datePipe = inject(DatePipe);

  // State as Signals
  isLoading = signal(false);
  error = signal<string | null>(null);
  currentPage = signal(0);
  itemsPerPage = signal(10);
  totalItems = signal(0);
  isDuplicationEnabled = signal(false);
  
  earnings = signal<any[]>([]);
  private originalEarnings = signal<any[]>([]);
  private duplicatedEarnings = signal<any[]>([]);
  private allEarnings = signal<any[]>([]);

  searchForm: FormGroup = this.fb.group({
    ticker: ['NVDA', [Validators.required, Validators.pattern('^[A-Za-z]{1,5}$')]],
    startDate: [this.getDefaultStartDate(), Validators.required],
    endDate: [new Date(), Validators.required]
  });

  // Table configuration
  displayedColumns: string[] = [
    'date',
    'period',
    'eps',
    'eps_est',
    'eps_prior',
    'eps_surprise',
    'eps_surprise_percent',
    'revenue',
    'revenue_est',
    'revenue_prior',
    'revenue_surprise',
    'revenue_surprise_percent',
    'eps_type',
    'notes'
  ];
  allColumns: string[] = [];

  // Add definite assignment assertion
  @ViewChild('startPicker') startPicker!: MatDatepicker<Date>;
  @ViewChild('endPicker') endPicker!: MatDatepicker<Date>;

  constructor() {}

  ngOnInit(): void {
    this.searchEarnings();
  }

  private getDefaultStartDate(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1); // Default to 1 year ago
    return date;
  }

  onSubmit(): void {
    if (this.searchForm.invalid) {
      return;
    }
    
    this.searchEarnings();
  }

  // Update the searchEarnings method
  searchEarnings() {
    if (this.searchForm.invalid) {
      return;
    }

    this.isLoading.set(true);
    this.error.set(null);
    this.currentPage.set(0); // Reset to first page on new search

    const { ticker, startDate, endDate } = this.searchForm.value;
    
    // Ensure we have valid date objects
    if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
      this.error.set('Invalid date range selected');
      this.isLoading.set(false);
      return;
    }

    console.log('Searching with dates:', { startDate, endDate });

    this.benzingaService.getEarningsCalendar({
      tickers: ticker.toUpperCase(),
      startDate,
      endDate,
      page: 1,
      pageSize: 100
    }).subscribe({
      next: (response: any) => {
        console.log('API Response:', response);
        this.originalEarnings.set(response.earnings || []);
        
        // Create duplicated data if needed
        const duplicatedItems: any[] = [];
        for (let i = 0; i < 10; i++) {
          const duplicated = this.originalEarnings().map((item: any) => ({
            ...item,
            id: `${item.id || ''}-${i}`,
            eps_act: item.eps_act ? item.eps_act + (Math.random() * 0.1 - 0.05) : item.eps_act,
            revenue_act: item.revenue_act ? item.revenue_act * (1 + (Math.random() * 0.1 - 0.05)) : item.revenue_act
          }));
          duplicatedItems.push(...duplicated);
        }
        this.duplicatedEarnings.set(duplicatedItems);
        
        this.updateDisplayedData();
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading earnings:', err);
        this.error.set('Failed to load earnings data. Please try again.');
        this.isLoading.set(false);
      }
    });
  }

  onPageChange(event: any) {
    this.currentPage.set(event.pageIndex);
    this.itemsPerPage.set(event.pageSize);
    this.updateDisplayedEarnings();
  }
  
  private updateDisplayedEarnings() {
    const startIndex = this.currentPage() * this.itemsPerPage();
    const endIndex = startIndex + this.itemsPerPage();
    this.earnings.set(this.allEarnings().slice(startIndex, endIndex));
  }

  onDateRangeChange(): void {
    this.searchEarnings(); // Reset to first page when date range changes
  }

  formatCurrency(value: string | number): string {
    if (value === null || value === undefined) return 'N/A';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(num) ? 'N/A' : `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  
  formatPercent(value: string | number): string {
    if (value === null || value === undefined) return 'N/A';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(num) ? 'N/A' : `${(num * 100).toFixed(2)}%`;
  }
  
  private showError(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }
  
  private showInfo(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000
    });
  }

  // Add this method to toggle data duplication
  toggleDuplication(): void {
    this.isDuplicationEnabled.update((v: boolean) => !v);
    this.updateDisplayedData();
  }

  // Update this method to handle both original and duplicated data
  private updateDisplayedData() {
    this.allEarnings.set(this.isDuplicationEnabled() ? this.duplicatedEarnings() : this.originalEarnings());
    this.totalItems.set(this.allEarnings().length);
    this.updateDisplayedEarnings();
  }
}
