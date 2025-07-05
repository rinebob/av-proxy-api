import { Component, Inject, DestroyRef, effect, inject, Injector } from '@angular/core';
import { SyncSymbolsResponse } from '../../../../feat/data-maintainer-view/common/fe-common-dm-api';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-add-symbols-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './add-symbols-dialog.component.html',
  styleUrl: './add-symbols-dialog.component.scss'
})
export class AddSymbolsDialogComponent {
  symbolsToAdd = '';
  loading = false;
  error: string | null = null;
  syncResults: SyncSymbolsResponse | null = null;

  constructor(
    public dialogRef: MatDialogRef<AddSymbolsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { store: any },
    private destroyRef: DestroyRef
  ) {

    this.data.store.syncResults$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((syncResults: SyncSymbolsResponse | null) => {
      if (syncResults) {
        this.syncResults = syncResults;
        if (syncResults.success) {
          console.log('aSD ctor eff closing dialog with sync results: ', syncResults);
          // Close the dialog on success
          this.dialogRef.close({ success: true })
        }
      }
    });
    // Subscribe to store changes
    effect(() => {
      // const syncResults = this.data.store.syncResults();
      // if (syncResults) {
      //   this.syncResults = syncResults;
      //   if (syncResults.success) {
      //     console.log('aSD ctor eff closing dialog (bypassed) with sync results: ', syncResults);
      //     // Close the dialog on success
      //     this.dialogRef.close({ success: true })
      //   }
      // }
      
      // const error = this.data.store.error();
      // if (error) {
      //   this.error = error;
      // }
      
      // this.loading = this.data.store.loading();
    }, { injector: inject(Injector) });
  }

  onCancel(): void {
    // Clear sync results when dialog is closed
    this.data.store.clearSyncResults();
    this.dialogRef.close();
  }

  addSymbols(): void {
    console.log('-------------- addSymbols Dialog aS -------------------------');
    console.log('aSD aS addSymbols called with input:', this.symbolsToAdd);
    
    if (!this.symbolsToAdd.trim()) {
      console.warn('sAD No symbols entered');
      return;
    }

    // Clear any previous results and errors
    this.data.store.clearSyncResults();
    this.loading = true;
    this.error = null;

    console.log('aSD aS Starting symbol addition process');
    
    // Parse the input into individual symbols
    const symbols = this.symbolsToAdd
      .split(/[,\n]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0);

    console.log('aSD aS Parsed symbols:', symbols);

    if (symbols.length === 0) {
      const errorMsg = 'Please enter at least one valid symbol';
      console.warn(`aSD aS ${errorMsg}`);
      this.error = errorMsg;
      this.loading = false;
      return;
    }

    console.log('aSD aS Calling store.addSymbols with symbols:', symbols);
    
    this.data.store.addSymbols(symbols).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        console.log('aSD aS Successfully added symbols');
      },
      error: (error: unknown) => {
        const errorMsg = error instanceof Error ? error.message : 'Failed to add symbols';
        console.error('aSD aS Error in addSymbols:', {
          error,
          message: errorMsg,
          stack: error instanceof Error ? error.stack : undefined
        });
        this.error = errorMsg;
        this.loading = false;
      },
      complete: () => {
        console.log('aSD aS Completed addSymbols');
        this.loading = false;
      }
    });
  }
}
