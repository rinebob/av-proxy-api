import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { BenzingaLogoService, CompanyLogoResponse } from '../../services/benzinga-logo.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, tap } from 'rxjs';

interface LogoDisplayData {
  logoUrl: string;
  altText: string;
  displayName: string;
  ticker: string | null;
  hasError: boolean;
}

@Component({
  selector: 'app-company-logo-gallery',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './company-logo-gallery.component.html',
  styleUrls: ['./company-logo-gallery.component.scss'],
})
export class CompanyLogoGalleryComponent {
  private benzingaLogoService = inject(BenzingaLogoService);
  private snackBar = inject(MatSnackBar);

  // Reactive state management
  searchControl = new FormControl('');
  isLoading = signal(false);
  tickers = signal<string[]>(['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META']);
  imageErrorTickers = signal<Set<string>>(new Set());

  private logos = toSignal(
    toObservable(this.tickers).pipe(
      tap(() => this.isLoading.set(true)),
      switchMap(tickers =>
        this.benzingaLogoService.getCompanyLogos(tickers).pipe(
          catchError(error => {
            console.error('Error loading logos:', error);
            this.snackBar.open('Failed to load company logos', 'OK', {
              duration: 3000,
            });
            return of([]); // Return empty array on error
          })
        )
      ),
      tap(() => this.isLoading.set(false))
    ),
    { initialValue: [] }
  );

  // Computed properties for the template
  isEmpty = computed(() => !this.isLoading() && this.logos().length === 0);

  displayLogos = computed<LogoDisplayData[]>(() => {
    const errorTickers = this.imageErrorTickers();
    return this.logos().map(logo => {
      const ticker = logo.ticker || '';
      const hasError = !logo.logo || errorTickers.has(ticker);
      return {
        logoUrl: logo.logo as string,
        altText: `Logo for ${logo.name || ticker || 'company'}`,
        displayName: logo.name || ticker || 'Unknown Company',
        ticker: logo.ticker || null,
        hasError: hasError,
      };
    });
  });

  // Handle search form submission
  onSearch(): void {
    const value = this.searchControl.value?.trim();
    if (!value) {
      this.snackBar.open('Please enter at least one ticker symbol.', 'OK', { duration: 3000 });
      return;
    }
    
    const tickers = value.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (tickers.length === 0) {
      this.snackBar.open('Please enter valid ticker symbols.', 'OK', { duration: 3000 });
      return;
    }
    
    this.tickers.set(tickers);
  }

  // Handle image loading errors to prevent infinite loops
  onImageError(ticker: string | null): void {
    if (ticker && !this.imageErrorTickers().has(ticker)) {
      this.imageErrorTickers.update(s => s.add(ticker));
    }
  }
}