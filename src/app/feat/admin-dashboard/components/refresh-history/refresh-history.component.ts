import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AdminDashboardStore } from '../../store/admin-dashboard.store';
import { TruncatePipe } from '../../../../shared/pipes/truncate.pipe';

@Component({
  selector: 'app-refresh-history',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    TruncatePipe
  ],
  templateUrl: './refresh-history.component.html',
  styleUrls: ['./refresh-history.component.scss']
})
export class RefreshHistoryComponent {
  store = inject(AdminDashboardStore);
  
  // Table columns
  displayedColumns = ['timestamp', 'status', 'duration', 'actions'];
  
  // Refresh the current endpoint
  refreshEndpoint() {
    const endpoint = this.store.selectedEndpoint();
    const collectionId = this.store.selectedCollection();
    if (endpoint && collectionId) {
      this.store.refreshEndpoint({ collectionId, endpoint });
    }
  }
  
  // Format duration in ms to a human readable format
  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }
  
  // Format timestamp to a readable date
  formatTimestamp(timestamp: any): string {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
  }
  
  // Get status icon and color
  getStatusIcon(status: string): { icon: string, color: string } {
    switch (status) {
      case 'success':
        return { icon: 'check_circle', color: 'primary' };
      case 'error':
        return { icon: 'error', color: 'warn' };
      default:
        return { icon: 'help', color: '' };
    }
  }
}
