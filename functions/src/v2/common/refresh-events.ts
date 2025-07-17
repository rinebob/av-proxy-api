import { Timestamp } from 'firebase-admin/firestore';
import { DataMaintainerEndpoint } from './common-dm';
import { FirestoreCollection } from './firestore-collections';

/**
 * Status of a refresh event
 */
export enum RefreshStatus {
  STARTED = 'started',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/**
 * Interface for refresh event documents
 */
export interface RefreshEvent {
  // When the refresh was completed
  completedAt: Timestamp;
  
  // Duration in milliseconds
  durationMs: number;
  
  // Error details if the refresh failed
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
  
  // Additional metadata about the refresh
  metadata?: Record<string, any>;
}

/**
 * Creates a refresh event document in Firestore
 * @param db Firestore instance
 * @param params Parameters for the refresh event
 */
// Maximum number of historical refresh events to keep per endpoint
const MAX_HISTORY_ENTRIES = 30;

// turn off console logs
const pr = false;

export async function logRefreshEvent(
  db: FirebaseFirestore.Firestore,
  params: {
    symbol: string;
    endpoint: DataMaintainerEndpoint;
    status: RefreshStatus;
    error?: Error;
    metadata?: Record<string, any>;
    durationMs?: number;
  }
): Promise<FirebaseFirestore.WriteResult[]> {
  const eventTimestamp = Timestamp.now();
  const event: RefreshEvent = {
    completedAt: eventTimestamp,
    durationMs: params.durationMs || 0,
    metadata: params.metadata || {}
  };
  
  // Add error details if available
  if (params.error) {
    event.error = {
      message: params.error.message,
      code: (params.error as any).code,
      stack: params.error.stack,
    };
  }
  
  // Reference to the refresh event document and history
  const eventRef = db
    .collection(FirestoreCollection.MARKET_DATA)
    .doc(params.symbol)
    .collection(FirestoreCollection.REFRESH_EVENTS)
    .doc(params.endpoint);
    
  // Create a history entry with timestamp as document ID
  const now = new Date();
  // Use ISO string for better sorting and querying
  const timestampString = now.toISOString();
  const historyRef = eventRef.collection(FirestoreCollection.REFRESH_HISTORY).doc(timestampString);
    
  // Get current history count for cleanup
  // First get all history entries (we'll need to sort them in memory)
  const historySnapshot = await eventRef.collection(FirestoreCollection.REFRESH_HISTORY)
    .select()
    .get();
    
  // Sort documents by their ID (which is an ISO timestamp) in descending order
  const sortedDocs = historySnapshot.docs.sort((a, b) => 
    b.id.localeCompare(a.id)
  );

  // Prepare batch for all operations
  const batch = db.batch();
  
  // 1. Update main event document
  batch.set(eventRef, event, { merge: true });
  
  // 2. Add new history entry with timestamp as document ID
  const newHistoryEntry = {
    ...event,
    // No need to store timestamp separately since it's in the document ID
  };
  batch.set(historyRef, newHistoryEntry);
  
  // 3. Clean up old history entries if we're over the limit
  if (sortedDocs.length >= MAX_HISTORY_ENTRIES) {
    // Keep only the most recent MAX_HISTORY_ENTRIES - 1
    const toDelete = sortedDocs.slice(MAX_HISTORY_ENTRIES - 1);
    toDelete.forEach(doc => {
      batch.delete(doc.ref);
    });
    if (pr) console.log(`Cleaned up ${toDelete.length} old history entries for ${params.symbol}/${params.endpoint}`);
  }
  
  return batch.commit();
}

/**
 * Gets the refresh status for a specific symbol and endpoint
 */
export async function getRefreshStatus(
  db: FirebaseFirestore.Firestore,
  symbol: string,
  endpoint: DataMaintainerEndpoint
): Promise<RefreshEvent | null> {
  const doc = await db
    .collection(FirestoreCollection.MARKET_DATA)
    .doc(symbol)
    .collection(FirestoreCollection.REFRESH_EVENTS)
    .doc(endpoint)
    .get();
    
  return doc.exists ? (doc.data() as RefreshEvent) : null;
}

/**
 * Gets the refresh history for a specific symbol and endpoint
 * @param limit Maximum number of history entries to return (default: 1)
 */
export async function getRefreshHistory(
  db: FirebaseFirestore.Firestore,
  symbol: string,
  endpoint: DataMaintainerEndpoint,
  limit = 1
): Promise<RefreshEvent[]> {
  const doc = await db
    .collection(FirestoreCollection.MARKET_DATA)
    .doc(symbol)
    .collection(FirestoreCollection.REFRESH_EVENTS)
    .doc(endpoint)
    .get();
    
  return doc.exists ? [doc.data() as RefreshEvent] : [];
}

/**
 * Gets the last refresh time for a specific symbol and endpoint
 */
export async function getLastRefreshTime(
  db: FirebaseFirestore.Firestore,
  symbol: string,
  endpoint: DataMaintainerEndpoint
): Promise<Date | null> {
  const status = await getRefreshStatus(db, symbol, endpoint);
  return status?.completedAt?.toDate() || null;
}
