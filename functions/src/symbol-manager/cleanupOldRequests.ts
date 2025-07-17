// Import from the correct v2 paths
import { onSchedule, ScheduleOptions } from 'firebase-functions/v2/scheduler';
import type { ScheduledEvent } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { FirestoreCollection } from '../common/firestore-collections';
import { OLD_SYNC_REQUEST_CLEANUP_SCHEDULE } from '../v2/common/function-schedules';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

// Define schedule options
const SCHEDULE_OPTIONS: ScheduleOptions = {
  schedule: OLD_SYNC_REQUEST_CLEANUP_SCHEDULE,
  timeZone: 'America/Los_Angeles',
  timeoutSeconds: 540, // 9 minutes
  memory: '1GiB' as const
};

/**
 * Cleans up old symbol sync requests to keep the database size in check
 */
export const cleanupOldSyncRequests = onSchedule(SCHEDULE_OPTIONS, async (event: ScheduledEvent) => {
  try {
    const db = admin.firestore();
    const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    );
    
    const snapshot = await db.collection(FirestoreCollection.REFRESH_EVENTS)
      .where('timestamp', '<', thirtyDaysAgo)
      .limit(500)
      .get();
    
    const batch = db.batch();
    let count = 0;
    
    snapshot.forEach((doc) => {
      batch.delete(doc.ref);
      count++;
    });
    
    if (count > 0) {
      await batch.commit();
      console.log(`Deleted ${count} old sync requests`);
    }
  } catch (error) {
    console.error('Error in cleanupOldSyncRequests:', error);
    throw error;
  }
});
