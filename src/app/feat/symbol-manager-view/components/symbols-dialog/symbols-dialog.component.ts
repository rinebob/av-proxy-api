import { Component, inject, DestroyRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { TrackedSymbolV2 } from '@shared/alpha-vantage';

import { SymbolInputFormComponent } from './symbol-input-form/symbol-input-form.component';
import { SymbolManagerStore } from '../../store/symbol-manager.store';

@Component({
  selector: 'app-symbols-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    SymbolInputFormComponent
  ],
  templateUrl: './symbols-dialog.component.html',
  styleUrl: './symbols-dialog.component.scss'
})
export class SymbolsDialogComponent {
  private dialogRef = inject(MatDialogRef<SymbolsDialogComponent>);
  store = inject(SymbolManagerStore);
  destroyRef = inject(DestroyRef);
  
  // Dialog state
  selectedSymbol = signal<TrackedSymbolV2 | undefined>(undefined);
 
  constructor() {
    this.store.symbolSelected$.pipe(
        takeUntilDestroyed(this.destroyRef)
      ).subscribe((symbolSelected: boolean) => {
        if (symbolSelected) {
          console.log('sD symbolsDialog ctor symbol selected, closing dialog');
          this.dialogRef.close({ 
            success: true,
          });
        }
      });
  }

  onSymbolSelected(selectedSymbol: TrackedSymbolV2): void {
    console.log('sD symbolsDialog onSymbolSelected: ', selectedSymbol);
    this.selectedSymbol.set(selectedSymbol);
  }

  onAddSymbol(): void {
    console.log('sD symbolsDialog onAddSymbol called');
    const symbol = this.selectedSymbol();
    if (symbol) {
      this.store.addSymbolFromSearch(symbol);
    }
  }

  onCancel(): void {
    this.dialogRef.close({ 
        result: 'canceled',
      });
  }
}
