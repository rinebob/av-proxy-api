import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { BenzingaLogoService, CompanyLogoResponse } from '../services/benzinga-logo.service';

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
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './company-logo-gallery.component.html',
  styleUrls: ['./company-logo-gallery.component.scss']
})
export class CompanyLogoGalleryComponent {
  private benzingaLogoService = inject(BenzingaLogoService);
  private snackBar = inject(MatSnackBar);

  // State using signals and form control
  searchControl = new FormControl('');
  isLoading = signal(false);
  logos = signal<CompanyLogoResponse[]>([]);
  
  // Computed properties for template
  displayLogos = computed<LogoDisplayData[]>(() => {
    return this.logos().map(logo => ({
      logoUrl: logo.logo || 'assets/images/logo-placeholder.png',
      altText: `Logo for ${logo?.ticker || 'company'}`,
      displayName: logo.name || logo.ticker || 'Unknown Company',
      ticker: logo?.ticker || null,
      hasError: false
    }));
  });
  
  isEmpty = computed(() => this.logos().length === 0);
  
  // Default tickers to show on initial load
  private readonly DEFAULT_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META'];

  constructor() {
    this.loadLogos(this.DEFAULT_TICKERS);
  }

  // Handle search form submission
  onSearch(): void {
    const query = this.searchControl.value?.trim();
    if (!query) return;
    
    // Split by comma and trim each ticker
    const tickers = query
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t);
    
    if (tickers.length === 0) {
      this.snackBar.open('Please enter valid ticker symbols', 'OK', { duration: 3000 });
      return;
    }
    
    this.loadLogos(tickers);
  }

  /**
   * Loads logos for the given tickers
   * @param tickers Array of ticker symbols
   */
  private loadLogos(tickers: string[]): void {
    this.isLoading.set(true);
    this.logos.set([]);
    
    this.benzingaLogoService.getCompanyLogos(tickers).subscribe({
      next: (logos) => {
        this.logos.set(logos);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Error loading logos:', error);
        this.snackBar.open('Failed to load company logos', 'OK', { duration: 3000 });
        this.isLoading.set(false);
      }
    });
  }

  // Get display name for a logo (company name or ticker)
  private getDisplayName(logo: CompanyLogoResponse): string {
    return logo.name || logo.ticker || 'Unknown Company';
  }
  
  // Get logo URL with fallback to placeholder
  private getLogoUrl(logo: CompanyLogoResponse): string {
    return logo.logo || 'assets/images/logo-placeholder.png';
  }
}
