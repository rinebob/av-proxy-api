import { db } from '../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { DocumentPathOptions, RefreshEvent, RefreshStatus, RefreshTrigger } from '../common/refresh.types';
import { formatTtlSeconds } from '../utils/utils';
import type { TimeSeriesInterval } from '../common/common-fn';
import type { TimeSeriesDocumentMetadata } from '../common/common-av';

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
  docPath: string; // docPath is now required
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
    if (!pathOptions.docPath) {
      throw new Error('logRefreshEvent: docPath must be provided in pathOptions. No fallback to internal path construction is allowed.');
    }
    const parentDocPath = pathOptions.docPath;
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

  /**
   * Build metadata for the initial time series data fetch.
   * Only sets histDataPoints, histStartDate, histEndDate, symbol, interval.
   * Does NOT set firstQuoteDate or quoteDataPoints.
   */
  static getInitialTimeSeriesMetadata(
    data: any[],
    symbol: string,
    interval: TimeSeriesInterval
  ): TimeSeriesDocumentMetadata {
    const histDataPoints = Array.isArray(data) ? data.length : 0;
    const histStartDate = histDataPoints > 0 && data[histDataPoints - 1]?.date
      ? Timestamp.fromDate(new Date(data[histDataPoints - 1].date))
      : Timestamp.now();
    const histEndDate = histDataPoints > 0 && data[0]?.date
      ? Timestamp.fromDate(new Date(data[0].date))
      : Timestamp.now();

    return {
      symbol,
      interval,
      histDataPoints,
      histStartDate,
      histEndDate,
      // firstQuoteDate and quoteDataPoints intentionally omitted for initial load
    } as TimeSeriesDocumentMetadata;
  }

  /**
   * Update metadata with quote info (firstQuoteDate, quoteDataPoints) during quote refresh.
   */
  static updateWithQuoteMetadata(
    metadata: TimeSeriesDocumentMetadata,
    quoteData: any[]
  ): TimeSeriesDocumentMetadata {
    const quoteDataPoints = Array.isArray(quoteData) ? quoteData.length : 0;
    const firstQuoteDate = quoteDataPoints > 0 && quoteData[0]?.date
      ? Timestamp.fromDate(new Date(quoteData[0].date))
      : undefined;

    return {
      ...metadata,
      firstQuoteDate,
      quoteDataPoints
    };
  }
}

// Export a singleton instance
export const refreshLogger = new RefreshLoggerService();
