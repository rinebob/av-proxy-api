import { Component, signal, inject } from '@angular/core';
import { Firestore, docData, doc, updateDoc, setDoc } from '@angular/fire/firestore';
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
  readonly loading = signal<boolean>(true);

  readonly isAdmin = this.auth.isAdmin;
  readonly user = this.auth.user;

  constructor() {
    this.toggleDoc$?.subscribe({
      next: async (docSnap) => {
        console.log('[ManualFirestoreWriteToggle] doc/enabled:', docSnap, docSnap?.['enabled']);
        const exists = !!docSnap;
        if (!exists) {
          // Initialize default document lazily; keep disabled by default
          try {
            const createdBy = this.auth.user()?.email ?? 'system';
            await setDoc(this.toggleDocRef, { enabled: false, updatedBy: createdBy, updatedAt: new Date() }, { merge: true });
          } catch (e) {
            console.warn('[ManualFirestoreWriteToggle] Could not initialize toggle doc:', e);
          }
          this.enabled.set(false);
        } else {
          this.enabled.set(!!docSnap?.['enabled']);
        }
        this.error.set(null);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('Could not load toggle state');
        this.loading.set(false);
        console.error('[ManualFirestoreWriteToggle] Error fetching doc:', err);
      }
    });
  }

  async toggleWrite() {
    const current = this.enabled();
    const newValue = !(current ?? false);
    const user = this.auth.user();
    const updatedBy = user?.email ?? 'unknown';
    const update = { enabled: newValue, updatedBy, updatedAt: new Date() };
    try {
      // Upsert to avoid NOT_FOUND when doc doesn't exist yet
      await setDoc(this.toggleDocRef, update, { merge: true });
      this.enabled.set(newValue);
      this.error.set(null);
    } catch (err) {
      this.error.set('Failed to update toggle');
      console.error('[ManualFirestoreWriteToggle] Error writing doc:', err);
    }
  }
}
