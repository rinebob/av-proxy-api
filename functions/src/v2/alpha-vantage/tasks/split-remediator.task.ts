import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { db } from '../../../firebase-admin-init';
import { createLogger } from '../../utils/utils';
import { AlphaVantageEndpoint, type CompactBar } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import {
  getSymbolTimeSeriesYearsCollectionPath,
} from '../../common/firestore/firestore-paths';
import { applyIncrementalSplit } from '../logic/split-math';

const logger = createLogger('[split-remediator]');

export interface SplitRemediationPayload {
  symbol: string;
  splitDate: string;   // YYYY-MM-DD (Ex-Date)
  splitFactor: number; // The raw split coefficient (e.g., 2.0)
}
interface RemediationOptions {
  adjustDaily: boolean;
}

/**
 * MATHEMATICAL CORRECTNESS: Present-to-Past Split Adjustment (DAILY ONLY)
 *
 * This task applies a SINGLE split event to existing **daily split-adjusted** history
 * by multiplying all bars BEFORE the split date by 1 / splitFactor (via
 * `applyIncrementalSplit`).
 *
 * When multiple splits exist, any caller that replays them over history MUST process
 * them in REVERSE CHRONOLOGICAL ORDER (newest → oldest). This keeps intermediate
 * bars on the correct relative scale as the cumulative factor evolves.
 *
 * See `docs/split-adjustment-math.md` for the full derivation and examples.
 */

async function runSplitRemediationInternal(
  payload: SplitRemediationPayload,
  options: RemediationOptions,
): Promise<void> {
  const { symbol, splitDate, splitFactor } = payload;
  const logCtx = { symbol, splitDate, splitFactor };

  logger.info('splitRemediator.start', { ...logCtx, options });

  if (!symbol || !splitDate || !splitFactor || splitFactor === 1) {
    logger.warn('splitRemediator.invalid_payload', logCtx);
    return;
  }

  const vendor = ApiProvider.ALPHA_VANTAGE;
  const batch = db.batch();
  let totalDocsUpdated = 0;

  // --- 1. Remediation: DAILY (Year Shards) ---
  if (options.adjustDaily) {
    const dailyPath = getSymbolTimeSeriesYearsCollectionPath(
      symbol,
      AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
      vendor,
      true,
    );
    const dailySnap = await db.collection(dailyPath).get();

    for (const doc of dailySnap.docs) {
      const bars = (doc.data().bars || []) as CompactBar[];
      const adjustedBars = applyIncrementalSplit(bars, splitDate, splitFactor);
      batch.set(doc.ref, { bars: adjustedBars }, { merge: true });
      totalDocsUpdated++;
    }
  }

  // --- 4. Commit ---
  if (totalDocsUpdated > 0) {
    await batch.commit();
    logger.info('splitRemediator.commit', { ...logCtx, totalDocsUpdated });
  } else {
    logger.info('splitRemediator.no_changes', logCtx);
  }
}

export async function runSplitRemediation(payload: SplitRemediationPayload): Promise<void> {
  // Full remediation for realtime splits: adjust Daily + W/M
  return runSplitRemediationInternal(payload, { adjustDaily: true });
}

export async function runSplitRemediationForHistory(payload: SplitRemediationPayload): Promise<void> {
  // History replay: W/M only (Daily already fully adjusted by backfill)
  return runSplitRemediationInternal(payload, { adjustDaily: false });
}

/**
 * Cloud Task: Remediate Split History
 *
 * Triggered when a new split is detected during ingestion.
 * Responsibilities (CURRENT IMPLEMENTATION):
 * 1. Fetch ALL **daily split-adjusted** year shards for the symbol.
 * 2. Apply the incremental split adjustment to all daily bars BEFORE the split date.
 * 3. Commit changes in a batch write.
 *
 * Weekly/Monthly split-adjusted series are handled exclusively by the
 * handler + `_internalSaveAvTimeSeriesData` + `adjustHistoryForBackfill` pipeline
 * during full backfills (see `docs/backfill-and-split-toolkit.md`).
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
    await runSplitRemediation(req.data);
  },
);
