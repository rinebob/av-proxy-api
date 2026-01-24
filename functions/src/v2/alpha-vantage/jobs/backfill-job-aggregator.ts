import { db } from '../../../firebase-admin-init';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { TimeSeriesInterval } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';
import { betterLogger } from '../../utils/utils';
import { TimeSeriesJobTerminalStatus, TimeSeriesRunStatus } from './time-series-jobs.model';

const logger = betterLogger('bfJA');

export interface OnBackfillJobTerminalArgs {
  runId: string;
  symbol: string;
  interval: TimeSeriesInterval;
  status: TimeSeriesJobTerminalStatus;
}

/**
 * Aggregator for backfill job completion.
 * 
 * Updates the backfill-runs/{runId} document counters when a job reaches
 * a terminal state (SUCCESS or PERMANENT_FAILURE). Checks if the run is
 * complete based on expectedJobs (immutable) vs actual completed jobs.
 * 
 * Unlike the realtime aggregator, this does NOT publish any Pub/Sub events
 * since backfill is a one-time admin operation.
 */
export async function onBackfillJobTerminal(
  args: OnBackfillJobTerminalArgs,
): Promise<void> {
  const { runId, symbol, interval, status } = args;
  const runRef = db.doc(`${FirestoreCollection.BACKFILL_RUNS}/${runId}`);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      if (!snap.exists) {
        logger.error('backfill.run_not_found', { runId, symbol, interval } as any);
        return;
      }

      const now = Timestamp.now();

      // Increment appropriate counter
      if (status === 'SUCCESS') {
        tx.update(runRef, {
          successJobs: FieldValue.increment(1),
          updatedAt: now,
        });
      } else if (status === 'PERMANENT_FAILURE') {
        tx.update(runRef, {
          permanentFailureJobs: FieldValue.increment(1),
          updatedAt: now,
        });
      }
    });

    // Check completion outside transaction to avoid read-after-write issues
    const runSnap = await runRef.get();
    const runData = runSnap.data();

    if (!runData) {
      return;
    }

    const expected = runData.expectedJobs || 0;
    const success = runData.successJobs || 0;
    const failure = runData.permanentFailureJobs || 0;
    const currentStatus = runData.status;

    // Check if run is complete: all expected jobs have reached terminal state
    if (success + failure >= expected && currentStatus !== TimeSeriesRunStatus.COMPLETE) {
      await runRef.update({
        status: TimeSeriesRunStatus.COMPLETE,
        runCompletedAt: Timestamp.now(),
      });

      logger.info('backfill.run_complete', {
        runId,
        expectedJobs: expected,
        successJobs: success,
        permanentFailureJobs: failure,
      } as any);
    }
  } catch (e: any) {
    logger.error('backfill.aggregator_error', {
      runId,
      symbol,
      interval,
      status,
      error: String(e?.message || e),
    } as any);
    throw e;
  }
}
