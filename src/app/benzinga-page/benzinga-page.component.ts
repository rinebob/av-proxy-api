import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, FormControl, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
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
import { BenzingaService, EarningsItem, EarningsParams } from '../services/benzinga.service';
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
  searchForm: FormGroup;
  isLoading = false;
  error: string | null = null;
  earnings: any[] = [];
  private allEarnings: any[] = [];
  currentPage = 0; // 0-based index for Material paginator
  itemsPerPage = 10;
  totalItems = 0;
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

  // Add this property to control data duplication
  isDuplicationEnabled = false;
  private originalEarnings: any[] = [];
  private duplicatedEarnings: any[] = [];

  constructor(
    private fb: FormBuilder,
    private benzingaService: BenzingaService,
    private snackBar: MatSnackBar,
    private datePipe: DatePipe
  ) {
    this.searchForm = this.fb.group({
      ticker: ['NVDA', [Validators.required, Validators.pattern('^[A-Za-z]{1,5}$')]],
      startDate: [this.getDefaultStartDate(), Validators.required],
      endDate: [new Date(), Validators.required]
    });
  }

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

    this.isLoading = true;
    this.error = null;
    this.currentPage = 0; // Reset to first page on new search

    const { ticker, startDate, endDate } = this.searchForm.value;

    const formatDate = (date: Date) => this.datePipe.transform(date, 'yyyy-MM-dd') || '';
    
    const params: EarningsParams = {
      tickers: ticker.toUpperCase(),
      date_from: formatDate(startDate),
      date_to: formatDate(endDate),
      page: 1, // Always request first page from API
      pagesize: 100 // Request more items to have enough for pagination
    };

    this.benzingaService.getEarningsCalendar(params).subscribe({
      next: (response: any) => {
        // Store original earnings
        this.originalEarnings = response.earnings || [];
        
        // Create duplicated data if needed
        this.duplicatedEarnings = [];
        for (let i = 0; i < 10; i++) {
          const duplicated = this.originalEarnings.map((item: EarningsItem) => ({
            ...item,
            id: `${item.id || ''}-${i}`,
            eps_act: item.eps_act ? item.eps_act + (Math.random() * 0.1 - 0.05) : item.eps_act,
            revenue_act: item.revenue_act ? item.revenue_act * (1 + (Math.random() * 0.1 - 0.05)) : item.revenue_act
          }));
          this.duplicatedEarnings.push(...duplicated);
        }
        
        // Update displayed data based on toggle state
        this.updateDisplayedData();
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error loading earnings:', err);
        this.error = 'Failed to load earnings data. Please try again.';
        this.isLoading = false;
      }
    });
  }

  onPageChange(event: any) {
    this.currentPage = event.pageIndex;
    this.itemsPerPage = event.pageSize;
    this.updateDisplayedEarnings();
  }
  
  private updateDisplayedEarnings() {
    const startIndex = this.currentPage * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    this.earnings = this.allEarnings.slice(startIndex, endIndex);
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
  toggleDuplication() {
    this.isDuplicationEnabled = !this.isDuplicationEnabled;
    this.updateDisplayedData();
  }

  // Update this method to handle both original and duplicated data
  private updateDisplayedData() {
    this.allEarnings = this.isDuplicationEnabled ? this.duplicatedEarnings : this.originalEarnings;
    this.totalItems = this.allEarnings.length;
    this.updateDisplayedEarnings();
  }
}
