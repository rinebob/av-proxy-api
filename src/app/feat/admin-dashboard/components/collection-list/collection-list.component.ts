import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';

import { AdminDashboardStore } from '../../store/admin-dashboard.store';

@Component({
  selector: 'app-collection-list',
  standalone: true,
  imports: [CommonModule, MatListModule, MatIconModule],
  templateUrl: './collection-list.component.html',
  styleUrls: ['./collection-list.component.scss']
})
export class CollectionListComponent {
  protected readonly store = inject(AdminDashboardStore);

  navigateToCollection(collectionId: string): void {
    this.store.navigateToCollection(collectionId);
  }

  navigateToSubcollection(collectionName: string): void {
    const currentPath = this.store.currentCollectionPath();
    const selectedDoc = this.store.selectedDocument();
    
    if (!currentPath || !selectedDoc) return;
    
    const newPath = `${currentPath}/${selectedDoc.id}/${collectionName}`;
    this.store.navigateToCollection(newPath);
  }
}