import { db } from '../../../firebase-admin-init';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { RefreshStatus, RefreshTrigger } from '@shared/firestore';
import type { EndpointConfig } from '@shared/core';

import { RefreshLoggerService } from '../../services/refresh-logger.service';
import { createLogger } from '../../utils/utils';
import { formatPtDateTime } from './av-firestore-utils';

const log = createLogger('av-standard-data.writer');

/**
 * Saves Alpha Vantage STANDARD (non-time-series) data to Firestore and logs refresh event using RefreshLoggerService.
 * @param data - The data to save
 * @param symbol - The symbol
 * @param endpoint - The Alpha Vantage endpoint
 * @param endpointConfig - The endpoint configuration
 * @returns Promise that resolves when persistence and logging complete
 */
export async function saveAvData(
  data: any,
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  endpointConfig: EndpointConfig
): Promise<void> {
  console.log(`aFH sAD start ${endpoint} ${symbol}`);
  log.info('standard.save.start', { symbol, endpoint });
  const { firestorePath, ttl } = endpointConfig;

  if (typeof ttl !== 'number') {
    throw new Error('ttl (ttlSeconds) must be provided in endpoint config');
  }

  const startTime = Date.now();

  try {
    // 1. Prepare document path
    if (!firestorePath) {
      throw new Error(`No firestorePath configured for endpoint: ${endpoint}. A firestorePath must be provided.`);
    }
    const docPath = firestorePath.replace('{symbol}', symbol);

    // 2. Prepare common metadata fields for non-time-series AV endpoints
    const nowTs = Timestamp.now();
    const nextTs = Timestamp.fromDate(new Date(Date.now() + ttl * 1000));

    const updateData: Record<string, any> = {
      // Standard payload container
      data,
      metadata: {
        lastUpdated: nowTs,
        lastUpdatedHr: formatPtDateTime(nowTs),
        nextUpdate: nextTs,
        nextUpdateHr: formatPtDateTime(nextTs),
        // Remove legacy fields that may exist from older schemas
        nextRefreshAt: FieldValue.delete(),
        ttlSeconds: ttl,
        vendor: ApiProvider.ALPHA_VANTAGE,
        endpoint,
        symbol,
      },
    };

    // 3. Proceed with Firestore write and refresh event logging
    await db.doc(docPath).set(updateData, { merge: true });

    // 4. Log refresh event using RefreshLoggerService
    const refreshLogger = new RefreshLoggerService();
    await refreshLogger.logRefreshEvent(
      {
        vendor: ApiProvider.ALPHA_VANTAGE,
        endpoint,
        symbol,
        ttlSeconds: ttl,
        docPath, // canonical Firestore path must be provided
      },
      {
        refreshedBy: 'system',
        status: RefreshStatus.SUCCESS,
        triggeredBy: RefreshTrigger.SCHEDULER,
        durationMs: Date.now() - startTime,
        httpStatus: 200
        // Add other RefreshEvent fields as needed
      }
    );

    console.log(`aFH sAD ✓ ${endpoint} ${symbol}`);
    log.info('standard.save.success', { symbol, endpoint, docPath, durationMs: Date.now() - startTime });
  } catch (error) {
    console.error('! aFH sAD error', (error as any)?.message || error);
    log.error('standard.save.error', { error: String((error as any)?.message || error) });
    throw error;
  }
}
