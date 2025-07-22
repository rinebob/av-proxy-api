import { Component, inject } from '@angular/core';
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

  selectDocument(doc: FirestoreDocument): void {
    this.store.selectDocument(doc);
  }
}
