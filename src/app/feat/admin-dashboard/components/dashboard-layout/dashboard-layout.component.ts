import { Component, inject, OnInit } from '@angular/core';
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
import { JsonPipe } from '@angular/common';
import { CollectionListComponent } from '../collection-list/collection-list.component';
import { MatDividerModule } from '@angular/material/divider';
import { BreadcrumbComponent } from "../breadcrumb/breadcrumb.component";
import { DocumentListComponent } from '../document-list/document-list.component';

@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [
    CommonModule,
    MatSidenavModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSnackBarModule,
    JsonPipe,
    RouterModule,
    CollectionListComponent,
    BreadcrumbComponent,
    DocumentListComponent
],
  templateUrl: './dashboard-layout.component.html',
  styleUrls: ['./dashboard-layout.component.scss']
})
export class DashboardLayoutComponent implements OnInit {
  protected readonly store = inject(AdminDashboardStore);
  private snackBar = inject(MatSnackBar);

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
