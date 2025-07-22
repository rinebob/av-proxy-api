import { Component, inject, signal, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AdminDashboardStore } from '../../store/admin-dashboard.store';
import { CollectionInfo } from '../../../../common/fe-common-fs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';

interface BreadcrumbItem {
  name: string;
  path: string;
}

@Component({
  selector: 'app-dashboard-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatToolbarModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatExpansionModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatTabsModule,
    MatTooltipModule
  ],
  templateUrl: './dashboard-layout.component.html',
  styleUrls: ['./dashboard-layout.component.scss']
})
export class DashboardLayoutComponent implements OnDestroy {
  protected readonly store = inject(AdminDashboardStore);
  
  // Search functionality
  private searchSubject = new Subject<string>();
  searchQuery = signal('');
  
  // Breadcrumb navigation
  breadcrumbItems = signal<BreadcrumbItem[]>([]);
  
  constructor() {
    // Initialize breadcrumb
    this.updateBreadcrumb();
    
    // Subscribe to path changes to update breadcrumb
    this.store.currentPath$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateBreadcrumb());
    
    // Setup search with debounce
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed()
    ).subscribe(query => {
      this.searchQuery.set(query);
      // TODO: Implement search functionality in store
    });
  }
  
  ngOnDestroy() {
    this.searchSubject.complete();
  }
  
  // Update breadcrumb based on current path
  private updateBreadcrumb() {
    const path = this.store.currentPath();
    if (!path) {
      this.breadcrumbItems.set([{ name: 'Home', path: '' }]);
      return;
    }
    
    const segments = path.split('/').filter(segment => segment);
    const items: BreadcrumbItem[] = [{ name: 'Home', path: '' }];
    
    let currentPath = '';
    segments.forEach((segment, index) => {
      currentPath += `${index > 0 ? '/' : ''}${segment}`;
      items.push({
        name: segment,
        path: currentPath
      });
    });
    
    this.breadcrumbItems.set(items);
  }
  
  // Navigation methods
  selectCollection(collectionId: string) {
    this.store.navigateToCollection(collectionId);
  }
  
  selectSubcollection(subcollection: string) {
    this.store.navigateToCollection(subcollection);
  }
  
  selectDocument(document: any) {
    this.store.selectDocument(document);
  }
  
  navigateToBreadcrumb(index: number) {
    const item = this.breadcrumbItems()[index];
    if (index === 0) {
      this.store.navigateToRoot();
    } else {
      // TODO: Implement navigation to specific breadcrumb level
      console.log('Navigate to:', item.path);
    }
  }
  
  // Search handler
  onSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchSubject.next(value);
  }
  
  // Refresh data
  refresh() {
    this.store.loadCollection(this.store.currentCollection().id);
  }
  
  // Clear error message
  clearError() {
    // this.store.clearError();
  }
  
  // Track by functions for ngFor
  trackByCollectionId(index: number, collection: CollectionInfo): string {
    return collection.id;
  }
  
  trackByDocumentId(index: number, doc: any): string {
    return doc.id;
  }
}
