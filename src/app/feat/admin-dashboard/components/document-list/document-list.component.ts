import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AdminDashboardStore } from '../../store/admin-dashboard.store';
import { FirestoreDocument } from '../../../../common/fe-common-fs';

@Component({
  selector: 'app-document-list',
  standalone: true,
  imports: [CommonModule, MatListModule, MatIconModule, MatTooltipModule],
  templateUrl: './document-list.component.html',
  styleUrls: ['./document-list.component.scss']
})
export class DocumentListComponent {
  protected readonly store = inject(AdminDashboardStore);
  
  // Track the current hovered element
  private hoveredElement = signal<HTMLElement | null>(null);
  
  // Computed signal to check for text overflow
  protected readonly isTextEllipsis = computed(() => {
    const element = this.hoveredElement();
    if (!element) return false;
    
    const textElement = element.querySelector('.document-id');
    if (!textElement) return false;
    
    return textElement.scrollWidth > textElement.clientWidth;
  });
  
  // Method to update the hovered element
  updateHoveredElement(element: EventTarget | HTMLElement | null): void {
    this.hoveredElement.set(element as HTMLElement);
  }

  selectDocument(doc: FirestoreDocument): void {
    this.store.selectDocument(doc);
  }
}
