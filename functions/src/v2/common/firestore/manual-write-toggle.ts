import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreCollection } from '@shared/firestore';

const MANUAL_WRITE_TOGGLE_DOC_ID = 'manualFirestoreWriteEnabled';

const MANUAL_WRITE_TOGGLE_DOC = `${FirestoreCollection.CONFIG}/${MANUAL_WRITE_TOGGLE_DOC_ID}`;

/**
 * Sets the manual write toggle in Firestore.
 * @param enabled - Whether manual writes are enabled.
 * @param updatedBy - User or system making the change.
 */
export async function setManualWriteToggle(enabled: boolean, updatedBy: string): Promise<void> {
  const newDoc = {
    enabled,
    updatedBy,
    updatedAt: new Date(),
  };
  await getFirestore().doc(MANUAL_WRITE_TOGGLE_DOC).set(newDoc, { merge: true });
  console.log('[ManualWriteToggle] Set doc:', newDoc);
}

/**
 * Reads the manual write toggle from Firestore.
 * @returns boolean - true if manual writes are enabled, false otherwise.
 */
export async function isManualWriteEnabled(): Promise<boolean> {
  const doc = await getFirestore().doc(MANUAL_WRITE_TOGGLE_DOC).get();
  console.log('[ManualWriteToggle] Read doc:', {
    exists: doc.exists,
    data: doc.data(),
  });
  return !!doc.exists && !!doc.data()?.enabled;
}
