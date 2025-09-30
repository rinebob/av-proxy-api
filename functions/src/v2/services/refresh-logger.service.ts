import { db } from '../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { DocumentPathOptions, RefreshStatus, RefreshTrigger } from '@shared/firestore';
import type { TimeSeriesDocumentMetadata, TimeSeriesInterval } from '@shared/alpha-vantage';

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
   * [DEPRECATED NO-OP]
   * Previously logged a refresh event into the parent document's refreshHistory array.
   * HealthView no longer reads per-doc refreshHistory; request-logs and health-metrics
   * are the canonical sources. This method is intentionally a no-op to avoid
   * writing redundant data into symbol-data docs.
   */
  public async logRefreshEvent(
    pathOptions: RefreshLoggerPathOptions,
    event: RefreshEventInput,
    options?: LogRefreshEventOptions
  ): Promise<void> {
    // Intentionally no-op
    return;
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
