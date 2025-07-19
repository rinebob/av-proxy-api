import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AvSymbolSearchResult } from '../../../../../feat/data-maintainer-view/common/fe-common-dm-api';
import { MatDialogContent } from "@angular/material/dialog";
import { MaterialModule } from "../../../../../shared/material.module";

export interface SymbolMatch {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
  matchScore: number;
}

@Component({
  selector: 'app-symbol-results',
  standalone: true,
  imports: [
    CommonModule,
    MatListModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDialogContent,
    MaterialModule
],
  templateUrl: './symbol-results.component.html',
  styleUrl: './symbol-results.component.scss'
})
export class SymbolResultsComponent {
  @Input() searchResults: AvSymbolSearchResult | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;
  
  @Output() symbolSelected = new EventEmitter<string>();
  @Output() back = new EventEmitter<void>();
  
  selectedSymbol: SymbolMatch | null = null;
  
  get matches(): SymbolMatch[] {
    if (!this.searchResults?.bestMatches) return [];
    
    return this.searchResults.bestMatches.map(match => ({
      symbol: match.symbol,
      name: match.name,
      type: match.type,
      region: match.region,
      currency: match.currency,
      matchScore: parseFloat(match.matchScore)
    }));
  }
  
  onSelectSymbol(match: SymbolMatch): void {
    this.selectedSymbol = match;
  }
  
  onAddSymbol(): void {
    if (this.selectedSymbol) {
      this.symbolSelected.emit(this.selectedSymbol.symbol);
    }
  }
  
  onBack(): void {
    this.back.emit();
  }
}
