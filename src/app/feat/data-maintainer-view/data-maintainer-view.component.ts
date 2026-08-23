import { Component, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, JsonPipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { debounceTime } from 'rxjs/operators';

import { AlphaVantageEndpoint, AV_ENDPOINT_CONFIGS } from '@shared/alpha-vantage';

import { AlphaVantageStore } from './store/alpha-vantage.store';
import { EndpointSelectorRowComponent } from './comps/endpoint-selector-row.component';

@Component({
  selector: 'app-data-maintainer-view',
  standalone: true,
  templateUrl: './data-maintainer-view.component.html',
  styleUrls: ['./data-maintainer-view.component.scss'],
  imports: [
    CommonModule, 
    JsonPipe, 
    FormsModule,
    ReactiveFormsModule,
    EndpointSelectorRowComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatInputModule,
    MatSlideToggleModule,
  ],
})
export class DataMaintainerViewComponent {
  // Store reference
  alphaVantageStore = inject(AlphaVantageStore);
  private destroyRef = inject(DestroyRef);
  
  public readonly AlphaVantageEndpoint = AlphaVantageEndpoint;
  // Reactive symbol control with required validation (enabled by default)
  public symbolControl = new FormControl<string>('', { nonNullable: true, validators: [Validators.required] });
  // Reactive date control with required validation (used for HISTORICAL_OPTIONS) (enabled by default)
  public dateControl = new FormControl<Date | null>(null, { validators: [Validators.required] });
  // Toggle for Alpha Vantage time-series output size (compact vs full)
  public outputFullControl = new FormControl<boolean>(false, { nonNullable: true });
  // Local-only date for HISTORICAL_OPTIONS (YYYY-MM-DD)
  private histOptionsDate: string | null = null;

  ngOnInit() {
    // Immediately sync controls with current loading state to avoid initial disabled state lingering
    this.alphaVantageStore.loading$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(loading => {
        if (loading) {
          this.symbolControl.disable({ emitEvent: false });
          this.dateControl.disable({ emitEvent: false });
        } else {
          this.symbolControl.enable({ emitEvent: false });
          this.dateControl.enable({ emitEvent: false });
        }

    });

    // Drive store symbol from control (debounced, uppercase)
    this.symbolControl.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(v => {
        const symbol = (v || '').trim().toUpperCase();
        this.alphaVantageStore.setSymbol(symbol);
      });

    // Drive local formatted date string from date control
    this.dateControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(d => {
        if (d instanceof Date) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          this.histOptionsDate = `${yyyy}-${mm}-${dd}`;
        } else {
          this.histOptionsDate = null;
        }
      });
  }

  onEndpointSelected(endpoint: AlphaVantageEndpoint) {
    this.alphaVantageStore.setEndpoint(endpoint);
  }

  isTimeSeriesEndpoint(endpoint: AlphaVantageEndpoint | null): boolean {
    if (!endpoint) {
      return false;
    }

    return [
      AlphaVantageEndpoint.TIME_SERIES_DAILY,
      AlphaVantageEndpoint.TIME_SERIES_WEEKLY,
      AlphaVantageEndpoint.TIME_SERIES_MONTHLY,
      AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
      AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
      AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
      AlphaVantageEndpoint.TIME_SERIES_INTRADAY,
    ].includes(endpoint);
  }

  /**
   * Returns true if the endpoint's firestorePath has no {symbol} placeholder,
   * meaning it's a global endpoint that doesn't require a symbol.
   */
  isGlobalEndpoint(endpoint: AlphaVantageEndpoint | null): boolean {
    if (!endpoint) {
      return false;
    }
    const config = (AV_ENDPOINT_CONFIGS as any)[endpoint];
    return !config?.firestorePath || !config.firestorePath.includes('{symbol}');
  }

  private fetchData() {
    const endpoint = this.alphaVantageStore.endpoint();
    const isGlobal = this.isGlobalEndpoint(endpoint);

    if (!isGlobal) {
      const symbol = this.alphaVantageStore.symbol();
      if (!symbol) {
        return;
      }
    }

    const params: Record<string, any> = {};
    // Pass date only for HISTORICAL_OPTIONS
    if (endpoint === AlphaVantageEndpoint.HISTORICAL_OPTIONS && this.histOptionsDate) {
      params['date'] = this.histOptionsDate;
    }

    // For time-series endpoints, send outputsize based on the Material toggle
    if (this.isTimeSeriesEndpoint(endpoint)) {
      params['outputsize'] = this.outputFullControl.value ? 'full' : 'compact';
    }

    this.alphaVantageStore.fetchData(params);
  }

  // Clear any error messages
  clearError() {
    this.alphaVantageStore.clearError();
  }

  // Handle form submission (if needed)
  onSubmit(event?: Event) {
    event?.preventDefault();
    const endpoint = this.alphaVantageStore.endpoint();
    // Skip symbol validation for global endpoints (no {symbol} in path)
    if (!this.isGlobalEndpoint(endpoint)) {
      if (this.symbolControl.invalid) {
        this.symbolControl.markAsTouched();
        return;
      }
    }
    // Validate date if HISTORICAL_OPTIONS is selected
    if (endpoint === AlphaVantageEndpoint.HISTORICAL_OPTIONS && this.dateControl.invalid) {
      this.dateControl.markAsTouched();
      return;
    }
    this.fetchData();
  }
}
