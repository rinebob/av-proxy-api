import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { AdminDashboardStore } from '../../store/admin-dashboard.store';
import { FirestoreDocument } from '../../../../common/fe-common-fs';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [
    CommonModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatToolbarModule,
    MatExpansionModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatChipsModule,
    MatTooltipModule,
    RouterModule
  ],
  templateUrl: './dashboard-layout.component.html',
  styleUrls: ['./dashboard-layout.component.scss']
})
export class DashboardLayoutComponent implements OnInit {
  protected readonly store = inject(AdminDashboardStore);
  private snackBar = inject(MatSnackBar);

  // Computed breadcrumb items
  protected readonly breadcrumbItems = computed(() => {
    const path = this.store.currentCollectionPath();
    const selectedDoc = this.store.selectedDocument();
    
    if (!path) return [];
    
    const segments = path.split('/').filter(Boolean);
    const items = [];
    
    // Add home as the first item
    items.push({ name: 'Home', path: '' });
    
    // Add path segments
    let currentPath = '';
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isDocument = i % 2 === 1; // Documents are at odd indices (0-based)
      
      // Update current path
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      
      // Add the segment to breadcrumb
      items.push({
        name: segment,
        path: isDocument ? null : currentPath, // Only make collections clickable
        isCollection: !isDocument
      });
    }
    
    // Add selected document to the breadcrumb if it exists and we're at a collection level
    if (selectedDoc && segments.length % 2 === 1) {
      items.push({
        name: selectedDoc.id,
        path: null, // Document is not clickable
        isCollection: false
      });
    }
    
    return items;
  });

  ngOnInit(): void {
    // Show error messages in a snackbar
    this.store.error$.subscribe(error => {
      if (error) {
        this.snackBar.open(error, 'Dismiss', { duration: 5000 });
      }
    });
  }

  // Navigate to a collection
  navigateToCollection(path: string): void {
    this.store.navigateToCollection(path);
  }

  // Select a document
  selectDocument(doc: FirestoreDocument): void {
    this.store.selectDocument(doc);
  }

  // Navigate to a subcollection
  navigateToSubcollection(collectionName: string): void {
    const currentPath = this.store.currentCollectionPath();
    const selectedDoc = this.store.selectedDocument();
    
    if (!currentPath || !selectedDoc) return;
    
    // The path should be: currentPath/selectedDoc.id/collectionName
    const newPath = `${currentPath}/${selectedDoc.id}/${collectionName}`;
    console.log(`[Dashboard] Navigating to subcollection: ${newPath}`);
    this.navigateToCollection(newPath);
  }

  // Refresh the current view
  refresh(): void {
    this.store.refresh();
  }
}
