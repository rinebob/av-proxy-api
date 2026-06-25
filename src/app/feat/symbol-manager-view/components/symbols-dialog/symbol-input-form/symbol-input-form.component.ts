import { Component, OnInit, Output, EventEmitter, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { startWith, debounceTime, distinctUntilChanged, switchMap, forkJoin, of, EMPTY } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { MatAutocompleteSelectedEvent, MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { TrackedSymbolV2 } from '@shared/alpha-vantage';

import { SymbolManagerStore } from '../../../store/symbol-manager.store';
import { SymbolManagerService } from '../../../services/symbol-manager.service';


@Component({
  selector: 'app-symbol-input-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
    ReactiveFormsModule
  ],
  templateUrl: './symbol-input-form.component.html',
  styleUrls: ['./symbol-input-form.component.scss']
})
export class SymbolInputFormComponent implements OnInit {
  destroyRef = inject(DestroyRef);
  
  @Output() symbolSelected = new EventEmitter<TrackedSymbolV2>();
  @Output() isTracked = new EventEmitter<boolean>();
  /** Emits the raw search string on every keystroke so the parent can filter the table */
  @Output() searchTermChange = new EventEmitter<string>();

  symbolManagerStore = inject(SymbolManagerStore);
  private symbolService = inject(SymbolManagerService);

  searchControl = new FormControl();

  searchResults = signal<TrackedSymbolV2[]>([]);
  /** Map of symbol string → whether it exists in tracked-symbols collection */
  trackedMap = signal<Record<string, boolean>>({});
  checkingDb = signal(false);
  
  ngOnInit(): void {
    this.setupAutocomplete();
  }

  private setupAutocomplete(): void {
    // Reason: emit raw value immediately (before debounce) so parent table filter is responsive
    this.searchControl.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
      startWith('')
    ).subscribe(value => {
      this.searchTermChange.emit(typeof value === 'string' ? value : '');
    });

    this.searchControl.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
      startWith(''),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((value) => {
        if (typeof value !== 'string' || value.trim().length < 2) {
          this.searchResults.set([]);
          this.trackedMap.set({});
          this.checkingDb.set(false);
          return EMPTY;
        }
        const term = value.trim();
        this.checkingDb.set(true);
        this.searchResults.set([]);
        this.trackedMap.set({});

        // Reason: check Firestore first — if the exact symbol exists we skip the AV call entirely
        return this.symbolService.getSymbolDetailsV2(term).pipe(
          switchMap((response) => {
            if (response.ok && response.exists && response.data) {
              // Found in DB — surface it directly, no AV call needed
              const result = response.data as TrackedSymbolV2;
              this.searchResults.set([result]);
              this.trackedMap.set({ [result.symbol]: true });
              this.checkingDb.set(false);
              return EMPTY;
            }
            // Not in DB — fall back to AV keyword search
            return this.symbolService.searchSymbolsV2(term).pipe(
              switchMap((avResults) => {
                const results = Array.isArray(avResults)
                  ? avResults
                  : Array.isArray((avResults as any)?.data)
                    ? (avResults as any).data
                    : [];
                this.searchResults.set(results);
                if (results.length === 0) {
                  this.trackedMap.set({});
                  this.checkingDb.set(false);
                  return EMPTY;
                }
                // Reason: batch-check all AV results against DB so badges show in the dropdown
                const checks = results.map((r: TrackedSymbolV2) =>
                  this.symbolService.getSymbolDetailsV2(r.symbol).pipe(
                    map(res => ({ symbol: r.symbol, tracked: res.ok && res.exists === true })),
                    catchError(() => of({ symbol: r.symbol, tracked: false }))
                  )
                );
                return forkJoin(checks).pipe(
                  map(entries => (entries as { symbol: string; tracked: boolean }[]).reduce(
                    (acc, e) => ({ ...acc, [e.symbol]: e.tracked }),
                    {} as Record<string, boolean>
                  ))
                );
              })
            );
          }),
          catchError(() => {
            this.checkingDb.set(false);
            return EMPTY;
          })
        );
      })
    ).subscribe((map) => {
      this.trackedMap.set(map as Record<string, boolean>);
      this.checkingDb.set(false);
    });
  }

  displayFn(match: TrackedSymbolV2): string {
    if (!match?.symbol) return '';
    return match.name ? `${match.symbol} - ${match.name}` : match.symbol;
  }

  onSymbolSelected(event: MatAutocompleteSelectedEvent): void {
    const selected = event.option.value as TrackedSymbolV2;
    const tracked = this.trackedMap()[selected.symbol] ?? false;
    this.symbolSelected.emit(selected);
    this.isTracked.emit(tracked);

    if (tracked) {
      // Already in DB — just clear so user can search again
      this.reset();
      return;
    }

    // Not tracked — add immediately then clear
    this.symbolManagerStore.addSymbolFromSearch(selected);
    this.reset();
  }

  private reset(): void {
    this.searchControl.reset();
    this.searchResults.set([]);
    this.trackedMap.set({});
    this.searchTermChange.emit('');
  }
}
