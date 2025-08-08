import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { AdminDashboardStore } from '../../store/admin-dashboard.store';

interface BreadcrumbItem {
  name: string;
  path: string | null;
  isCollection: boolean;
}

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './breadcrumb.component.html',
  styleUrls: ['./breadcrumb.component.scss']
})
export class BreadcrumbComponent {
  protected readonly store = inject(AdminDashboardStore);

  protected readonly breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const path = this.store.currentCollectionPath();
    const selectedDoc = this.store.selectedDocument();
    
    if (!path) return [];
    
    const segments = path.split('/').filter(Boolean);
    const items: BreadcrumbItem[] = [];
    
    // Add home as the first item
    items.push({ name: 'Collections', path: '', isCollection: true });
    
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

  navigateToCollection(path: string): void {
    this.store.navigateToCollection(path);
  }
}
