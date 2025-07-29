import { db } from '../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { DocumentPathOptions, RefreshEvent, RefreshStatus, RefreshTrigger } from '../common/refresh.types';
import { getDocumentPath } from '../common/firestore/firestore-paths';
import { formatTtlSeconds } from '../utils/utils';

export interface RefreshEventInput {
  status: RefreshStatus;
  triggeredBy: RefreshTrigger;
  refreshedBy: string;
  durationMs: number;
  errorDetails?: string | null;
  httpStatus?: number;
}

export interface RefreshLoggerPathOptions extends DocumentPathOptions {
  ttlSeconds: number;
}

export interface LogRefreshEventOptions {
  refreshedAt?: Timestamp;
  nextRefreshAt?: Timestamp;
  nextRefreshBy?: string;
  ttlHuman?: string;
}

export class RefreshLoggerService {
  /**
   * Logs a refresh event and updates the parent document's metadata
   */
  public async logRefreshEvent(
    pathOptions: RefreshLoggerPathOptions,
    event: RefreshEventInput,
    options?: LogRefreshEventOptions
  ): Promise<void> {
    const parentDocPath = getDocumentPath({
      vendor: pathOptions.vendor,
      endpoint: pathOptions.endpoint,
      symbol: pathOptions.symbol,
    });
    const docRef = db.doc(parentDocPath);
    const now = Timestamp.now();
    const refreshedAt = options?.refreshedAt ?? now;
    const nextRefreshAt = Timestamp.fromDate(new Date(refreshedAt.toMillis() + pathOptions.ttlSeconds * 1000));
    const ttlHuman = formatTtlSeconds(pathOptions.ttlSeconds);

    const refreshEvent: RefreshEvent = {
      eventId: this.createEventId(pathOptions, now),
      refreshedAt,
      refreshedBy: event.refreshedBy,
      status: event.status,
      triggeredBy: event.triggeredBy,
      durationMs: event.durationMs,
      errorDetails: event.errorDetails || null,
      httpStatus: event.httpStatus,
      nextRefreshAt,
      nextRefreshBy: event.refreshedBy,
      ttlHuman,
    };

    console.log('rLSvc lRE: Logging refresh event:', refreshEvent);

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
      console.error('rLSvc lRE: Error logging refresh event:', error);
    }
  }

  /**
   * Updates or creates a symbol-level Firestore document with minimal metadata fields.
   * Used to ensure symbol doc is reachable in code and contains refresh state.
   */
  public async updateSymbolMetadata({
    symbol,
    endpointName,
    now,
    ttl
  }: {
    symbol: string;
    endpointName: string;
    now: Date;
    ttl: number;
  }) {
    const symbolDocPath = `symbol-data/${symbol}`;
    const symbolDocRef = db.doc(symbolDocPath);
    await symbolDocRef.set({
      refreshedAt: now,
      refreshedBy: endpointName,
      nextRefreshAt: new Date(now.getTime() + ttl * 1000),
      nextRefreshBy: endpointName,
      ttlHuman: formatTtlSeconds(ttl),
    }, { merge: true });
  }

  private createEventId(pathOptions: RefreshLoggerPathOptions, timestamp: Timestamp): string {
    const { vendor, endpoint, symbol } = pathOptions;
    const dateStr = timestamp.toDate().toISOString().replace(/[:.]/g, '-');
    return `${vendor}-${endpoint}-${symbol || 'market'}-${dateStr}`;
  }
}

// Export a singleton instance
export const refreshLogger = new RefreshLoggerService();
