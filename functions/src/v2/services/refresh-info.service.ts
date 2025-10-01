import { DocumentReference, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../firebase-admin-init';
import {
  DataDocument,
  RefreshEvent,
  RefreshStatus,
  RefreshTrigger,
} from '@shared/firestore';
import { formatTtlSeconds } from '../utils/utils';

const MAX_HISTORY_LENGTH = 10;

/**
 * A service to manage refresh metadata in Firestore documents.
 */
export class RefreshInfoService {
  /**
   * Updates a Firestore document with new data and a new refresh event in its history.
   *
   * This function transactionally updates the document by:
   * 1. Setting the new data payload.
   * 2. Creating a new `RefreshEvent` containing all metadata.
   * 3. Prepending the event to the `refreshHistory` array and capping it.
   *
   * @param docRef - The reference to the Firestore document to update.
   * @param newData - The new data payload to save.
   * @param eventDetails - Details of the refresh event that just occurred.
   * @param scheduleDetails - Details about the scheduling and context of the refresh.
   */
  static async updateDocumentWithRefreshInfo<T>(
    docRef: DocumentReference,
    newData: T | null,
    eventDetails: {
      status: RefreshStatus;
      durationMs: number;
      triggeredBy: RefreshTrigger;
      errorDetails: string | null;
      httpStatus?: number;
    },
    scheduleDetails: {
      ttlSeconds: number;
      refreshedBy: string;
      nextRefreshBy: string;
    }
  ): Promise<void> {
    await db.runTransaction(async (transaction) => {
      const now = Timestamp.now();
      const eventId = `evt_${now.toMillis()}_${Math.random().toString(36).substring(2, 9)}`;
      const { ttlSeconds, refreshedBy, nextRefreshBy } = scheduleDetails;

      const newRefreshEvent: RefreshEvent = {
        eventId,
        triggeredBy: eventDetails.triggeredBy,
        refreshedAt: now,
        refreshedBy,
        durationMs: eventDetails.durationMs,
        nextRefreshAt: Timestamp.fromMillis(now.toMillis() + ttlSeconds * 1000),
        nextRefreshBy,
        ttlHuman: formatTtlSeconds(ttlSeconds),
        status: eventDetails.status,
        errorDetails: eventDetails.errorDetails,
        httpStatus: eventDetails.httpStatus,
      };

      const currentDoc = await transaction.get(docRef);
      const currentHistory = (currentDoc.data() as DataDocument<T> | undefined)?.refreshHistory;

      let newHistory = [newRefreshEvent];
      if (currentHistory && Array.isArray(currentHistory)) {
        newHistory = [newRefreshEvent, ...currentHistory];
      }

      // Cap the history array
      if (newHistory.length > MAX_HISTORY_LENGTH) {
        newHistory = newHistory.slice(0, MAX_HISTORY_LENGTH);
      }

      const dataToSet: DataDocument<T> = {
        data: newData,
        refreshHistory: newHistory,
      };

      transaction.set(docRef, dataToSet);
    });
  }
}
