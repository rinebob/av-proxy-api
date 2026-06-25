import { Component, OnInit, inject, signal, computed, ViewChild, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabGroup } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatMenuModule } from '@angular/material/menu';
import { SymbolManagerStore } from '../../store/symbol-manager.store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SymbolInputFormComponent } from '../symbols-dialog/symbol-input-form/symbol-input-form.component';

@Component({
  selector: 'app-symbol-manager',
  standalone: true,
  imports: [
    CommonModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatChipsModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatMenuModule,
    SymbolInputFormComponent,
  ],
  templateUrl: './symbol-manager.component.html',
  styleUrls: ['./symbol-manager.component.scss']
})
export class SymbolManagerComponent implements OnInit {
  readonly store = inject(SymbolManagerStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild(MatTabGroup) tabGroup!: MatTabGroup;

  // Table configuration
  displayedV2Columns = [
    'symbol', 'name', 'type', 'region', 'timezone', 'currency', 'matchScore',
    '_createdAt', '_lastUpdated', '_isActive', '_refreshEnabled'
  ];
  pageSize = 10;
  pageIndex = 0;
  sortField = 'symbol';
  sortDirection: 'asc' | 'desc' = 'asc';
  
  // Tab configuration
  readonly tabNames = ['list'] as const;

  // Form controls
  readonly symbolsToAdd = signal('');

  // Table data: show single search result when available, otherwise full list
  readonly displayedSymbols = computed(() => {
    const searchResult = this.store.v2SymbolSearchResult();
    return searchResult ? [searchResult] : this.store.v2Symbols();
  });

  readonly hasActiveSearch = computed(() => this.store.v2SymbolSearchResult() !== null);

  constructor() {}

  ngOnInit(): void {
    // this.store.listSymbols();
    // this.store.symbols$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
    //     next: () => this.showResult('Symbols loaded successfully'),
    //     error: (err: Error) => this.showError(`Error loading symbols: ${err.message}`)
    // });
    
    this.store.listSymbolsV2();
    this.store.v2Symbols$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v2Symbols => {
        console.log('sM ngOI v2Symbols sub:', v2Symbols);
    });
  }

  /**
   * Add one or more symbols from text input
   */
  addSymbols(): void {
    const symbolsText = this.symbolsToAdd();
    if (!symbolsText) return;
    
    // Split by comma or newline and clean up
    const symbols = symbolsText
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    if (symbols.length === 0) return;
    
    this.store.addSymbols(symbols).subscribe({
      next: () => {
        this.showResult(`Successfully added ${symbols.length} symbol(s)`);
        this.symbolsToAdd.set('');
        // Use V2 listing explicitly to avoid legacy schema path
        this.store.listSymbolsV2();
      },
      error: (error) => this.showError(`Failed to add symbols: ${error.message}`)
    });
  }

  /**
   * Show a success message
   */
  private showResult(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }

  /**
   * Show an error message
   */
  private showError(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  /**
   * Remove a symbol by its ID
   */
  removeSymbol(symbol: string): void {
    if (confirm(`Are you sure you want to remove ${symbol}?`)) {
      this.store.removeSymbol(symbol).subscribe({
        next: () => {
          this.showResult(`Successfully removed symbol: ${symbol}`);
        },
        error: (error) => this.showError(`Failed to remove symbol: ${error.message}`)
      });
    }
  }

  onPageChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
  }
  
  onSortChange(sort: Sort): void {
    this.sortField = sort.active;
    this.sortDirection = sort.direction as 'asc' | 'desc';
  }

}
