import { Component, OnInit, inject, signal, computed, ViewChild, effect, DestroyRef } from '@angular/core';
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
import { MatPaginatorModule, MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
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
    MatTooltipModule,
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
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  // Table configuration
  displayedV2Columns = [
    'symbol', 'name', 'type', 'region', 'timezone', 'currency', 'matchScore',
    '_createdAt', '_lastUpdated', '_isActive'
  ];
  readonly pageSize = signal(25);
  readonly pageIndex = signal(0);
  sortField = 'symbol';
  sortDirection: 'asc' | 'desc' = 'asc';

  // Tab configuration
  readonly tabNames = ['list'] as const;

  // Form controls
  readonly symbolsToAdd = signal('');
  readonly filterText = signal('');

  // Reason: filter against symbol and name fields, case-insensitive
  private readonly filteredSymbols = computed(() => {
    const searchResult = this.store.v2SymbolSearchResult();
    if (searchResult) return [searchResult];
    const filter = this.filterText().toLowerCase().trim();
    const all = this.store.v2Symbols();
    if (!filter) return all;
    return all.filter(s =>
      s.symbol?.toLowerCase().includes(filter) ||
      s.name?.toLowerCase().includes(filter)
    );
  });

  readonly totalFiltered = computed(() => this.filteredSymbols().length);

  // Reason: slice filtered list to current page
  readonly displayedSymbols = computed(() => {
    const all = this.filteredSymbols();
    const start = this.pageIndex() * this.pageSize();
    return all.slice(start, start + this.pageSize());
  });

  readonly hasActiveSearch = computed(() => this.store.v2SymbolSearchResult() !== null);

  constructor() {
    // Reason: reset to page 0 whenever the filter changes so user doesn't land on empty page
    effect(() => {
      this.filterText();
      this.pageIndex.set(0);
      if (this.paginator) this.paginator.firstPage();
    });
  }

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
    this.pageSize.set(event.pageSize);
    this.pageIndex.set(event.pageIndex);
  }
  
  onSortChange(sort: Sort): void {
    this.sortField = sort.active;
    this.sortDirection = sort.direction as 'asc' | 'desc';
  }

}
