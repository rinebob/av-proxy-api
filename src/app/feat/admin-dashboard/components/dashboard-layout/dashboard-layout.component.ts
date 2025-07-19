import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { AdminDashboardStore, COLLECTIONS } from '../../store/admin-dashboard.store';
import { RefreshHistoryComponent } from '../refresh-history/refresh-history.component';

@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatSidenavModule,
    MatListModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    RefreshHistoryComponent
  ],
  templateUrl: './dashboard-layout.component.html',
  styleUrls: ['./dashboard-layout.component.scss']
})
export class DashboardLayoutComponent {
  store = inject(AdminDashboardStore);
  collections = COLLECTIONS;
  
  // Track refresh status for each endpoint
  private refreshStatuses = new Map<string, 'success' | 'error'>();

  // Check if currently loading
  get isLoading() {
    return this.store.loading();
  }

  // Get the last known status for an endpoint
  getLastStatus(endpoint: string): 'success' | 'error' | null {
    return this.refreshStatuses.get(endpoint) || null;
  }

  // Select a collection
  selectCollection(collectionId: string) {
    this.store.loadEndpoints(collectionId);
  }

  // Select an endpoint
  selectEndpoint(endpoint: string) {
    const collectionId = this.store.selectedCollection();
    if (collectionId) {
      this.store.selectEndpoint({ collectionId, endpoint });
    }
  }

  // Refresh the list of endpoints
  refreshEndpoints() {
    const collectionId = this.store.selectedCollection();
    if (collectionId) {
      this.store.loadEndpoints(collectionId);
    }
  }

  // Refresh a specific endpoint
  refreshEndpoint(endpoint: string) {
    const collectionId = this.store.selectedCollection();
    if (collectionId) {
      this.store.refreshEndpoint({ collectionId, endpoint });
    }
  }
}
