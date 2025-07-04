import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

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
  syncResults: any = null;

  constructor(
    public dialogRef: MatDialogRef<AddSymbolsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { clientId: string; clientName: string; store: any }
  ) {}

  onCancel(): void {
    this.dialogRef.close();
  }

  async addSymbols(): Promise<void> {
    if (!this.symbolsToAdd.trim()) {
      return;
    }

    this.loading = true;
    this.error = null;
    this.syncResults = null;

    try {
      const symbols = this.symbolsToAdd
        .split(/[,\n]+/)
        .map(s => s.trim().toUpperCase())
        .filter(s => s.length > 0);

      if (symbols.length === 0) {
        this.error = 'Please enter at least one valid symbol';
        return;
      }

      const result = await this.data.store.addSymbols(
        symbols,
        this.data.clientId,
        this.data.clientName
      ).toPromise();

      this.syncResults = result;
      
      if (result?.ok) {
        // Auto-close after a short delay on success
        setTimeout(() => {
          this.dialogRef.close(true);
        }, 1500);
      }
    } catch (error) {
      console.error('Error adding symbols:', error);
      this.error = error instanceof Error ? error.message : 'Failed to add symbols';
    } finally {
      this.loading = false;
    }
  }
}
