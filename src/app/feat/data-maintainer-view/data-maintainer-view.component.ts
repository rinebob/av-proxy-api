import { Component, signal, inject, DestroyRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { DataMaintainerStore } from './data-maintainer.store';
import { DataMaintainerEndpoint } from './common/fe-common-dm';
import { EndpointSelectorRowComponent } from './comps/endpoint-selector-row.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
  public readonly DataMaintainerEndpoint = DataMaintainerEndpoint;
  public dataMaintainerStore = inject(DataMaintainerStore);
  private destroyRef = inject(DestroyRef);
  private dialog = inject(MatDialog);
  
  private symbolInput$ = new Subject<string>();

  ngOnInit() {
    // Set up debounced symbol input
    this.symbolInput$.pipe(
      debounceTime(300),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(symbol => {
      this.dataMaintainerStore.setSymbol(symbol);
    });

    // Subscribe to store state changes
    this.dataMaintainerStore.awaitingUserDecision$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((awaitingDecision: boolean) => {
        if (awaitingDecision) {
          this.showConfirmationDialog();
        }
      });
  }

  onSymbolChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const symbol = input.value.trim().toUpperCase();
    this.symbolInput$.next(symbol);
  }

  fetchCompanyOverview() {
    this.dataMaintainerStore.fetchCompanyOverview();
  }

  private showConfirmationDialog(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '450px',
      data: { 
        symbol: this.dataMaintainerStore.symbol() 
      },
      disableClose: true // Prevent closing by clicking outside
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        // User confirmed - use real data
        this.dataMaintainerStore.confirmUseRealData();
      } else {
        // User cancelled - reset the state
        this.dataMaintainerStore.cancelRealDataRequest();
      }
    });
  }

  toggleMockData(event: Event) {
    console.log('DMV tMD toggling mock data:', !this.dataMaintainerStore.useMock());
    this.dataMaintainerStore.toggleUseMock();
    // Prevent the default behavior of the checkbox to stop form submission
    event?.preventDefault();
    // No need to fetch here - user will click the fetch button when ready
  }
}
