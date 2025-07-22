import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { JsonPipe } from '@angular/common';
import { AdminDashboardStore } from '../../store/admin-dashboard.store';
import { FirestoreDocument } from '../../../../common/fe-common-fs';
import { PathGeneratorService } from '../../../../core/services/path-generator.service';
import { FirestoreCollection } from '../../../../core/config/firestore-collection-enum';

@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [
    CommonModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatToolbarModule,
    MatTooltipModule,
    MatSnackBarModule,
    JsonPipe,
  ],
  templateUrl: './dashboard-layout.component.html',
  styleUrls: ['./dashboard-layout.component.scss']
})
export class DashboardLayoutComponent {
  // Services
  readonly store = inject(AdminDashboardStore);
  readonly pathGenerator = inject(PathGeneratorService);
  private readonly snackBar = inject(MatSnackBar);
  
  // Template bindings
  readonly FirestoreCollection = FirestoreCollection;
  
  // Current breadcrumb items
  breadcrumbItems: Array<{ name: string; path: string }> = [];
  
  constructor() {
    // Update breadcrumb when the current path changes
    this.store.currentPath$.subscribe(path => {
      this.breadcrumbItems = this.pathGenerator.buildBreadcrumb(path);
    });
    
    // Show error messages
    this.store.error$.subscribe(error => {
      if (error) {
        this.snackBar.open(error, 'Dismiss', { duration: 5000 });
      }
    });
  }
  
  // Handle collection selection from sidebar
  selectCollection(collectionId: string): void {
    this.store.navigateToCollection(collectionId);
  }
  
  // Handle document selection
  selectDocument(document: FirestoreDocument): void {
    console.log(`[INFO] [DashboardLayout] selectDocument:`, document);
    this.store.selectDocument(document);
  }
  
  // Handle subcollection selection
  selectSubcollection(subcollection: string): void {
    this.store.navigateTo(subcollection);
  }
  
  // Refresh current view
  refresh(): void {
    const currentPath = this.store.currentPath();
    if (currentPath) {
      this.store.loadCollection(currentPath);
    } else {
      // Default to the current collection's ID if no path is set
      this.store.loadCollection(this.store.currentCollection().id);
    }
  }
  
  // Navigate using breadcrumb
  navigateToBreadcrumb(index: number): void {
    const path = this.breadcrumbItems[index]?.path;
    if (!path) {
      if (index === 0) {
        // If clicking on the root breadcrumb, navigate to the root collection
        this.store.navigateToRoot();
      }
      return;
    }

    // Get the path parts up to the current breadcrumb item
    const pathParts = path.split('/');
    
    // If the path has an even number of segments, it's a document reference
    // We need to navigate to its parent collection
    if (pathParts.length % 2 === 0) {
      // Remove the last segment to get the parent collection path
      const parentPath = pathParts.slice(0, -1).join('/');
      this.store.loadCollection(parentPath);
    } else {
      // It's already a collection path
      this.store.loadCollection(path);
    }
  }
}
