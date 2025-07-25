import { Component, inject, DestroyRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { SymbolInputFormComponent } from './symbol-input-form/symbol-input-form.component';
import { SymbolManagerStore } from '../../store/symbol-manager.store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TrackedSymbolV2 } from '../../../data-maintainer-view/common/fe-common-av-api-v2';

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
    this.selectedSymbol.set(selectedSymbol);
  }

  onAddSymbol(): void {
    const symbol = this.selectedSymbol();
    if (symbol) {
      this.store.addSymbolFromSearch(symbol);
    }
    this.dialogRef.close();
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
