import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { OptionsEnabledDialogComponent } from './options-enabled-dialog.component';

describe('OptionsEnabledDialogComponent (Task #144)', () => {
  let close: jasmine.Spy;

  function create(enabled = true) {
    close = jasmine.createSpy('close');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { symbol: 'AAPL', enabled } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    return TestBed.createComponent(OptionsEnabledDialogComponent).componentInstance;
  }

  it('confirm closes with true', () => {
    const c = create(true);
    c.onConfirm();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('cancel closes with no result', () => {
    const c = create(false);
    c.dialogRef.close();
    expect(close).toHaveBeenCalledWith();
  });
});
