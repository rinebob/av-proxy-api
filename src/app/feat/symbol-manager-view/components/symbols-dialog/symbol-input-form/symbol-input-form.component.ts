import { Component, OnInit, Output, EventEmitter, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { startWith, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { MatAutocompleteSelectedEvent, MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogContent } from "@angular/material/dialog";
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { TrackedSymbolV2 } from '@shared/alpha-vantage';

import { SymbolManagerStore } from '../../../store/symbol-manager.store';


@Component({
  selector: 'app-symbol-input-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDialogContent,
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

  symbolManagerStore = inject(SymbolManagerStore);

  searchControl = new FormControl();

  searchResults = signal<TrackedSymbolV2[]>([]);
  
  ngOnInit(): void {
    this.setupAutocomplete();
  }

  private setupAutocomplete(): void {

    this.searchControl.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      distinctUntilChanged(),
    ).subscribe(
      (value) => {
        console.log('sIF sA setupAutocomplete valueChanges: ', value);
        if (typeof value === 'string' && value.trim().length > 1) {
          this.symbolManagerStore.searchSymbolsV2(value);
        }
      }
    );

    this.symbolManagerStore.v2SearchResults$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      (results) => {
        console.log('sIF sA autocomplete searchResults: ', results);
        if (results) this.searchResults.set(results);
      }
    );
  }

  displayFn(match: TrackedSymbolV2): string {
    return match ? `${match.symbol} - ${match.name} - ${match.matchScore}` : '';
  }

  onSymbolSelected(event: MatAutocompleteSelectedEvent): void {
    const selected = event.option.value as TrackedSymbolV2;
    this.symbolSelected.emit(selected);
  }
}
