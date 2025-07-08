import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { DocumentPathOptions, RefreshEvent, RefreshMetadata } from '../common/refresh.types';
import { getDocumentPath, getRefreshHistoryPath } from '../common/firestore-paths';

export class RefreshLoggerService {
  private db: FirebaseFirestore.Firestore;
  private batch: FirebaseFirestore.WriteBatch;
  private batchSize: number;
  private batchCount: number;
  private maxBatchSize = 500; // Firestore batch limit

  constructor() {
    this.db = getFirestore();
    this.batch = this.db.batch();
    this.batchSize = 0;
    this.batchCount = 0;
  }

  /**
   * Logs a refresh event and updates the parent document's metadata
   */
  public async logRefreshEvent(
    event: Omit<RefreshEvent, 'timestamp' | 'instanceId' | 'region'>,
    options: DocumentPathOptions
  ): Promise<void> {
    try {
      const timestamp = admin.firestore.Timestamp.now();
      const docPath = getDocumentPath(options);
      const docRef = this.db.doc(docPath);
      const refreshEvent: RefreshEvent = {
        ...event,
        timestamp,
        instanceId: process.env.FUNCTION_INSTANCE || 'unknown',
        region: process.env.FUNCTION_REGION || 'unknown',
      };

      // Add refresh history document
      const historyRef = this.db.doc(getRefreshHistoryPath(options, timestamp));
      this.batch.set(historyRef, refreshEvent);
      this.batchSize++;

      // Update parent document metadata
      const metadata: RefreshMetadata = {
        lastUpdated: timestamp,
        nextRefreshAt: admin.firestore.Timestamp.fromMillis(
          timestamp.toMillis() + (event.endpointParams?.ttlSeconds || 3600) * 1000
        ),
        ttlSeconds: event.endpointParams?.ttlSeconds || 3600,
        vendor: options.vendor,
        endpoint: options.endpoint,
        ...(options.symbol && { symbol: options.symbol }),
        lastRefreshEvent: {
          timestamp,
          status: event.status,
          durationMs: event.durationMs,
          error: event.error || null,
        },
      };

      // Use set with merge to update only the metadata and lastRefreshEvent fields
      this.batch.set(
        docRef,
        { metadata },
        { merge: true }
      );
      this.batchSize++;

      // Commit batch if we're approaching the limit
      if (this.batchSize >= this.maxBatchSize - 10) { // Leave some room
        await this.commitBatch();
      }
    } catch (error) {
      console.error('Error logging refresh event:', error);
      throw error;
    }
  }

  /**
   * Commits the current batch and starts a new one
   */
  public async commitBatch(): Promise<void> {
    if (this.batchSize === 0) return;

    try {
      await this.batch.commit();
      this.batchCount++;
      console.log(`Committed batch ${this.batchCount} with ${this.batchSize} operations`);
      
      // Start a new batch
      this.batch = this.db.batch();
      this.batchSize = 0;
    } catch (error) {
      console.error('Error committing batch:', error);
      throw error;
    }
  }

  /**
   * Gets a singleton instance of the RefreshLoggerService
   */
  private static instance: RefreshLoggerService;
  public static getInstance(): RefreshLoggerService {
    if (!RefreshLoggerService.instance) {
      RefreshLoggerService.instance = new RefreshLoggerService();
    }
    return RefreshLoggerService.instance;
  }
}

// Export a singleton instance
export const refreshLogger = RefreshLoggerService.getInstance();
