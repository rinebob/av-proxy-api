import { onSchedule, ScheduleOptions } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { SYMBOL_REQUESTS } from '../../common/firestore-collections';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

// Define schedule options
const WEEKLY_SCHEDULE: ScheduleOptions = {
  schedule: '0 0 * * 0', // Every Sunday at midnight
  timeZone: 'America/Los_Angeles',
  timeoutSeconds: 540, // 9 minutes
  memory: '1GiB'
};

/**
 * Cleans up old symbol sync requests to keep the database size in check
 */
export const cleanupOldSyncRequests = onSchedule(WEEKLY_SCHEDULE, async (event) => {
  try {
    const db = admin.firestore();
    const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    );
    
    const snapshot = await db.collection(SYMBOL_REQUESTS)
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
