import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

/** Confirm dialog for the Options Enabled toggle (Task #144). Closes `true` on
 * confirm; undefined/cancel otherwise. */
export interface OptionsEnabledDialogData {
    symbol: string;
    /** Target state — true = enable prompt, false = disable prompt. */
    enabled: boolean;
}

@Component({
    selector: 'app-options-enabled-dialog',
    standalone: true,
    imports: [CommonModule, MatDialogModule, MatButtonModule],
    templateUrl: './options-enabled-dialog.component.html',
})
export class OptionsEnabledDialogComponent {
    constructor(
        public dialogRef: MatDialogRef<OptionsEnabledDialogComponent, boolean>,
        @Inject(MAT_DIALOG_DATA) public data: OptionsEnabledDialogData,
    ) {}

    onConfirm(): void {
        this.dialogRef.close(true);
    }
}
