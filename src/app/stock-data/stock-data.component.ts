import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { JsonPipe, CommonModule } from '@angular/common';
import { catchError, of, switchMap, tap } from 'rxjs';
import { StockDataFunctions, StockDataFunction } from '../common/common-app';
import { MaterialModule } from '../shared/material.module';
import { AlphaVantageService } from '../services/alpha-vantage.service';
import { AlphaVantageFunctionName } from '../common/common-fn';

@Component({
  selector: 'app-stock-data',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule, 
    ReactiveFormsModule, 
    JsonPipe,
    MatDividerModule,
    MaterialModule
  ],
  templateUrl: './stock-data.component.html',
  styleUrls: ['./stock-data.component.scss']
})
export class StockDataComponent {
  readonly StockDataFunctions = StockDataFunctions;
  private readonly alphaVantageService = inject(AlphaVantageService);

  // State as signals
  isLoading = signal(false);
  errorMessage = signal('');
  currentFunction = signal<StockDataFunction>(StockDataFunctions.DAILY_STOCK_DATA);
  searchAction = signal<{ ticker: string, fn: StockDataFunction } | null>(null);

  // Form
  stockForm = new FormGroup({
    tickerSymbol: new FormControl('')
  });

  // Reactive data fetching
  stockData = toSignal(
    toObservable(this.searchAction).pipe(
      switchMap(action => {
        if (!action) return of(null);

        this.isLoading.set(true);
        this.errorMessage.set('');
        this.stockForm.disable();

        const { ticker, fn } = action;
        const request$ = fn === StockDataFunctions.DAILY_STOCK_DATA
          ? this.alphaVantageService.getDailyStockData({ symbol: ticker })
          : this.alphaVantageService.getGlobalQuote({ symbol: ticker });

        return request$.pipe(
          catchError(error => {
            const message = this.getErrorMessage(error);
            this.errorMessage.set(message);
            return of(null); // Return null data on error
          })
        );
      }),
      tap(() => {
        this.isLoading.set(false);
        this.stockForm.enable();
      })
    ),
    { initialValue: null }
  );

  onSubmit(): void {
    const ticker = this.stockForm.value.tickerSymbol?.toUpperCase();
    if (this.stockForm.valid && ticker) {
      this.searchAction.set({ ticker, fn: this.currentFunction() });
    }
  }

  toggleFunction(): void {
    const nextFn = this.currentFunction() === StockDataFunctions.DAILY_STOCK_DATA
      ? StockDataFunctions.GLOBAL_QUOTE
      : StockDataFunctions.DAILY_STOCK_DATA;
    this.currentFunction.set(nextFn);
  }

  private getErrorMessage(error: any): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error?.status === 401 || error?.status === 403) return 'Authentication failed. Please log in again.';
    if (error?.status === 429) return 'API rate limit reached. Please try again later or upgrade your Alpha Vantage API plan.';
    if (error?.status && error.status >= 500) return 'Server error. Please try again later.';
    return 'An unexpected error occurred. Please try again.';
  }
}
