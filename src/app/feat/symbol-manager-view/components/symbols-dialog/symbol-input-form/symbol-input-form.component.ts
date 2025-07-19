import { Component, OnInit, Output, EventEmitter, inject, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatAutocompleteSelectedEvent, MatAutocomplete, MatAutocompleteModule } from '@angular/material/autocomplete';
import { startWith, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { SymbolManagerStore } from '../../../store/symbol-manager.store';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogContent } from "@angular/material/dialog";
import { MaterialModule } from "../../../../../shared/material.module";
import { SvtAvSymbolMatch } from '../../../../data-maintainer-view/common/fe-common-dm-api';
import { SYMBOL_SEARCH_RESULTS } from '../../../../../../assets/data/symbol-search-results';

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
    MaterialModule,
    MatAutocompleteModule,
    ReactiveFormsModule
  ],
  templateUrl: './symbol-input-form.component.html',
  styleUrls: ['./symbol-input-form.component.scss']
})
export class SymbolInputFormComponent implements OnInit {
  @Output() symbolSelected = new EventEmitter<SvtAvSymbolMatch>();

  symbolManagerStore = inject(SymbolManagerStore);

  searchControl = new FormControl();

  searchResults = signal<SvtAvSymbolMatch[]>([]);
  
  ngOnInit(): void {
    this.initializeDevMode();
    this.setupAutocomplete();
  }

  initializeDevMode() {
    this.searchResults.set(SYMBOL_SEARCH_RESULTS);
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
        //   this.symbolManagerStore.searchSymbols(value);
        }
      }
    );

    this.symbolManagerStore.searchResults$.subscribe(
      (results) => {
        console.log('sIF sA autocomplete searchResults: ', results);
        if (results) this.searchResults.set(results);
      }
    );
  }

  displayFn(match: SvtAvSymbolMatch): string {
    return match ? `${match.symbol} - ${match.name} - ${match.matchScore}` : '';
  }

  onSymbolSelected(event: MatAutocompleteSelectedEvent): void {
    const selected = event.option.value as SvtAvSymbolMatch;
    this.symbolSelected.emit(selected);
  }
}
