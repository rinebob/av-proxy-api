import { Component, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

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
    EndpointSelectorRowComponent,
    MatDialogModule
  ],
})
export class DataMaintainerViewComponent {
  // Store reference
  alphaVantageStore = inject(AlphaVantageStore);
  private destroyRef = inject(DestroyRef);
  
  public readonly AlphaVantageEndpoint = AlphaVantageEndpoint;
  // For debounced symbol input
  private symbolInput$ = new Subject<string>();

  ngOnInit() {
    // Set up debounced symbol input
    this.symbolInput$.pipe(
      debounceTime(300),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(symbol => {
      this.alphaVantageStore.setSymbol(symbol);
    });
  }

  onSymbolInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const symbol = input.value.trim().toUpperCase();
    this.alphaVantageStore.setSymbol(symbol);
  }

  onEndpointSelected(endpoint: AlphaVantageEndpoint) {
    this.alphaVantageStore.setEndpoint(endpoint);
  }

  private fetchData() {
    const symbol = this.alphaVantageStore.symbol();
    if (!symbol) {
      return;
    }
    this.alphaVantageStore.fetchData();
  }

  // Clear any error messages
  clearError() {
    this.alphaVantageStore.clearError();
  }

  // Handle form submission (if needed)
  onSubmit(event?: Event) {
    event?.preventDefault();
    this.fetchData();
  }
}
