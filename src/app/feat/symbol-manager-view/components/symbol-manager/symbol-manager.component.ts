import { Component, OnInit, inject, signal, computed, ViewChild, ElementRef, effect, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule, MatCheckboxChange } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTabGroup } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SymbolManagerStore } from '../../store/symbol-manager.store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SymbolInputFormComponent } from '../symbols-dialog/symbol-input-form/symbol-input-form.component';
import { formatBeta, formatMarketCap, orDash } from '../../utils/company-info.format';
import { sortTrackedSymbolsMulti, SortLevel } from '../../utils/symbol-sort';
import { TrackedSymbolV2 } from '@shared/alpha-vantage';
import { OptionsEnabledDialogComponent } from '../options-enabled-dialog/options-enabled-dialog.component';

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
    MatCheckboxModule,
    MatDialogModule,
    MatTableModule,
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
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild(MatTabGroup) tabGroup!: MatTabGroup;
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild('tableTop') tableTop?: ElementRef<HTMLElement>;

  // Table configuration
  displayedV2Columns = [
    'symbol', 'name', 'sector', 'industry', 'marketCap', 'beta',
    'type', '_createdAt', '_lastUpdated', 'optionable', 'optionsEnabled'
  ];
  readonly pageSize = signal(100);
  readonly pageIndex = signal(0);
  // Multi-level sort stack: first clicked column is primary; later clicks add
  // secondary levels. Clicking a sorted column cycles asc → desc → remove.
  readonly sortLevels = signal<SortLevel[]>([]);

  // companyInfo column formatters (exposed for the template)
  readonly formatMarketCap = formatMarketCap;
  readonly formatBeta = formatBeta;
  readonly orDash = orDash;

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

  // Reason: sort the whole filtered set BEFORE slicing — global ordering across
  // the loaded list, not just the visible page. Client-side; no refetch.
  private readonly sortedSymbols = computed(() =>
    sortTrackedSymbolsMulti(this.filteredSymbols(), this.sortLevels())
  );

  // Reason: slice sorted list to current page
  readonly displayedSymbols = computed(() => {
    const all = this.sortedSymbols();
    const start = this.pageIndex() * this.pageSize();
    return all.slice(start, start + this.pageSize());
  });

  // Fetch-cap guard: sorting covers only the loaded subset when it exists
  readonly fetchCapHit = computed(() => {
    const total = this.store.v2Total();
    const loaded = this.store.v2Symbols().length;
    return total > 0 && loaded > 0 && loaded < total;
  });

  readonly hasActiveSearch = computed(() => this.store.v2SymbolSearchResult() !== null);

  constructor() {
    // Reason: reset to page 0 whenever the filter changes so user doesn't land on empty page
    effect(() => {
      this.filterText();
      this.resetToFirstPage();
    });
  }

  private resetToFirstPage(): void {
    this.pageIndex.set(0);
    if (this.paginator) this.paginator.firstPage();
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

  /**
   * Options Enabled toggle (Task #144). Enabled only when optionable===true;
   * confirm dialog → governed setOptionsEnabledV2 callable → store patches the
   * row on transition. Cancel/error reverts the checkbox visual.
   */
  onOptionsEnabledToggle(symbol: TrackedSymbolV2, event: MatCheckboxChange): void {
    const revert = () => { event.source.checked = !!symbol.optionsEnabled; };

    if (symbol.optionable !== true) { revert(); return; }

    const enabled = event.checked;
    const ref = this.dialog.open(OptionsEnabledDialogComponent, {
      data: { symbol: symbol.symbol, enabled },
    });

    ref.afterClosed().subscribe((confirmed?: boolean) => {
      if (confirmed !== true) { revert(); return; }

      this.store.setOptionsEnabled(symbol.symbol, enabled).subscribe(r => {
        if (r.ok && r.transitioned) {
          this.showResult(`Options corpus ${enabled ? 'enabled' : 'disabled'} for ${symbol.symbol}`);
        } else if (r.ok) {
          // Idempotent no-op — the flag was already at the target; the row is
          // stale, so revert the visual to what the server reports.
          revert();
          this.showResult(`${symbol.symbol} was already ${enabled ? 'enabled' : 'disabled'}`);
        } else {
          revert();
          this.showError(r.error || `Failed to update optionsEnabled for ${symbol.symbol}`);
        }
      });
    });
  }

  /** Tooltip text for the disabled Options Enabled checkbox. */
  optionsEnabledTooltip(symbol: TrackedSymbolV2): string {
    if (symbol.optionable === true) return '';
    return symbol.optionable === false
      ? 'No listed options — cannot enable'
      : 'Optionability not probed yet';
  }

  onPageChange(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.pageIndex.set(event.pageIndex);
    // Page change leaves the user at the bottom — scroll back to the table top
    this.tableTop?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  
  /**
   * Multi-level sort: clicking an unsorted column appends it as the last
   * sort level; clicking a sorted column cycles asc → desc → removes it.
   */
  onSortClick(field: string): void {
    this.sortLevels.update(levels => {
      const idx = levels.findIndex(l => l.field === field);
      if (idx === -1) return [...levels, { field, direction: 'asc' }];
      if (levels[idx].direction === 'asc') {
        const next = [...levels];
        next[idx] = { field, direction: 'desc' };
        return next;
      }
      return levels.filter(l => l.field !== field);
    });
    // Re-sorting changes global order — land back on page 1
    this.resetToFirstPage();
  }

  /** Header indicator: ▲/▼ plus stack position when multiple levels active. */
  sortIndicator(field: string): string {
    const levels = this.sortLevels();
    const idx = levels.findIndex(l => l.field === field);
    if (idx === -1) return '';
    const arrow = levels[idx].direction === 'asc' ? '▲' : '▼';
    return levels.length > 1 ? `${arrow}${idx + 1}` : arrow;
  }

  /** aria-sort value for a header cell. */
  ariaSort(field: string): 'ascending' | 'descending' | 'none' {
    const level = this.sortLevels().find(l => l.field === field);
    return level ? (level.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  }

}
