import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { db } from '../../../firebase-admin-init';
import { createLogger } from '../../utils/utils';
import { AlphaVantageEndpoint, type CompactBar } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { 
  getSymbolTimeSeriesYearsCollectionPath, 
  getSymbolTimeSeriesAllDocPath 
} from '../../common/firestore/firestore-paths';
import { applyIncrementalSplit } from '../logic/split-math';

const logger = createLogger('[split-remediator]');

export interface SplitRemediationPayload {
  symbol: string;
  splitDate: string;   // YYYY-MM-DD (Ex-Date)
  splitFactor: number; // The raw split coefficient (e.g., 2.0)
}

/**
 * Cloud Task: Remediate Split History
 * 
 * Triggered when a new split is detected during ingestion.
 * Responsibilities:
 * 1. Fetch ALL historical time series data (Daily, Weekly, Monthly).
 * 2. Apply the incremental split adjustment to all bars BEFORE the split date.
 * 3. Commit changes in a batch write.
 * 
 * This ensures that while "Today's" price is correct immediately, the history 
 * catches up asynchronously without blocking the ingestion API.
 */
export const remediateSplitHistory = onTaskDispatched<SplitRemediationPayload>(
  {
    retryConfig: {
      maxAttempts: 3,
      minBackoffSeconds: 60,
    },
    rateLimits: {
      maxConcurrentDispatches: 5,
    },
    memory: '512MiB',
  },
  async (req) => {
    const { symbol, splitDate, splitFactor } = req.data;
    const logCtx = { symbol, splitDate, splitFactor };
    
    logger.info('splitRemediator.start', logCtx);

    if (!symbol || !splitDate || !splitFactor || splitFactor === 1) {
      logger.warn('splitRemediator.invalid_payload', logCtx);
      return;
    }

    const vendor = ApiProvider.ALPHA_VANTAGE;
    const batch = db.batch();
    let totalDocsUpdated = 0;

    // --- 1. Remediation: DAILY (Year Shards) ---
    const dailyPath = getSymbolTimeSeriesYearsCollectionPath(
      symbol, 
      AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, 
      vendor,
      true
    );
    const dailySnap = await db.collection(dailyPath).get();
    
    for (const doc of dailySnap.docs) {
      const bars = (doc.data().bars || []) as CompactBar[];
      const adjustedBars = applyIncrementalSplit(bars, splitDate, splitFactor);
      
      // Optimization: Only write if data actually changed
      // Simple check: JSON stringify comparison or checking if any bars were modified
      // Logic helper returns new array refs if changed, but we map inside. 
      // To be safe and simple, we just write. Firestore handles no-op writes well.
      batch.set(doc.ref, { bars: adjustedBars }, { merge: true });
      totalDocsUpdated++;
    }

    // --- 2. Remediation: WEEKLY (Year Shards) ---
    const weeklyPath = getSymbolTimeSeriesYearsCollectionPath(
      symbol, 
      AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED, 
      vendor,
      true
    );
    const weeklySnap = await db.collection(weeklyPath).get();

    for (const doc of weeklySnap.docs) {
      const bars = (doc.data().bars || []) as CompactBar[];
      const adjustedBars = applyIncrementalSplit(bars, splitDate, splitFactor);
      batch.set(doc.ref, { bars: adjustedBars }, { merge: true });
      totalDocsUpdated++;
    }

    // --- 3. Remediation: MONTHLY (Single Doc) ---
    const monthlyDocPath = getSymbolTimeSeriesAllDocPath(
      symbol, 
      AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED, 
      vendor,
      true
    );
    const monthlyDocRef = db.doc(monthlyDocPath);
    const monthlySnap = await monthlyDocRef.get();

    if (monthlySnap.exists) {
      const bars = (monthlySnap.data()?.bars || []) as CompactBar[];
      const adjustedBars = applyIncrementalSplit(bars, splitDate, splitFactor);
      batch.set(monthlyDocRef, { bars: adjustedBars }, { merge: true });
      totalDocsUpdated++;
    }

    // --- 4. Commit ---
    if (totalDocsUpdated > 0) {
      await batch.commit();
      logger.info('splitRemediator.commit', { ...logCtx, totalDocsUpdated });
    } else {
      logger.info('splitRemediator.no_changes', logCtx);
    }
  }
);
