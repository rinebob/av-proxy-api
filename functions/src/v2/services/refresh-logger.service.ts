import { db } from '../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { DocumentPathOptions, RefreshEvent } from '../common/refresh.types';
import { getDocumentPath } from '../common/firestore/firestore-paths';

export class RefreshLoggerService {
  /**
   * Logs a refresh event and updates the parent document's metadata
   */
  public async logRefreshEvent(
    pathOptions: DocumentPathOptions,
    event: Omit<RefreshEvent, 'eventId' | 'refreshedAt' | 'nextRefreshAt' | 'ttlHuman' | 'nextRefreshBy'>
  ): Promise<void> {
    const docRef = db.doc(getDocumentPath(pathOptions));
    const now = Timestamp.now();

    const refreshEvent: Partial<RefreshEvent> = {
      eventId: this.createEventId(pathOptions, now),
      refreshedAt: now,
      status: event.status,
      triggeredBy: event.triggeredBy,
      refreshedBy: 'api-request', // Or determine dynamically
      durationMs: event.durationMs,
      errorDetails: event.errorDetails || null,
      httpStatus: event.httpStatus,
    };

    try {
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const existingHistory = doc.data()?.refreshHistory || [];
        
        // Prepend the new event and cap the history
        const newHistory = [refreshEvent, ...existingHistory].slice(0, 10);

        transaction.set(docRef, { 
          refreshHistory: newHistory 
        }, { merge: true });
      });
    } catch (error) {
      console.error('Error logging refresh event:', error);
    }
  }

  private createEventId(pathOptions: DocumentPathOptions, timestamp: Timestamp): string {
    const { vendor, endpoint, symbol } = pathOptions;
    const dateStr = timestamp.toDate().toISOString().replace(/[:.]/g, '-');
    return `${vendor}-${endpoint}-${symbol || 'market'}-${dateStr}`;
  }
}

// Export a singleton instance
export const refreshLogger = new RefreshLoggerService();
