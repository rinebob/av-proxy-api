import { Component, signal, inject } from '@angular/core';
import { Firestore, docData, doc, updateDoc } from '@angular/fire/firestore';
import { MatSlideToggle } from "@angular/material/slide-toggle";

import { AuthService } from '../../auth/auth.service';
import { MANUAL_FIRESTORE_WRITE_ENABLED_DOCUMENT_PATH } from '../../config/firestore-paths';

@Component({
  selector: 'app-manual-firestore-write-toggle',
  standalone: true,
  templateUrl: './manual-firestore-write-toggle.component.html',
  styleUrls: ['./manual-firestore-write-toggle.component.scss'],
  imports: [MatSlideToggle],
})
export class ManualFirestoreWriteToggleComponent {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  readonly toggleDocRef = doc(this.firestore, `${MANUAL_FIRESTORE_WRITE_ENABLED_DOCUMENT_PATH}`);
  readonly toggleDoc$ = docData(this.toggleDocRef);

  readonly enabled = signal<boolean | null>(null);
  readonly error = signal<string | null>(null);

  readonly isAdmin = this.auth.isAdmin;
  readonly user = this.auth.user;

  constructor() {
    this.toggleDoc$?.subscribe({
      next: (doc) => {
        console.log('[ManualFirestoreWriteToggle] doc/enabled:', doc, doc?.['enabled']);
        this.enabled.set(doc?.['enabled'] ?? false);
        this.error.set(null);
      },
      error: (err) => {
        this.error.set('Could not load toggle state');
        console.error('[ManualFirestoreWriteToggle] Error fetching doc:', err);
      }
    });
  }

  async toggleWrite() {
    const newValue = !this.enabled();
    const user = this.auth.user();
    const updatedBy = user?.email ?? 'unknown';
    const update = { enabled: newValue, updatedBy, updatedAt: new Date() };
    try {
      await updateDoc(this.toggleDocRef, update);
      this.enabled.set(newValue);
      this.error.set(null);
      
    } catch (err) {
      this.error.set('Failed to update toggle');
      console.error('[ManualFirestoreWriteToggle] Error writing doc:', err);
    }
  }
}
