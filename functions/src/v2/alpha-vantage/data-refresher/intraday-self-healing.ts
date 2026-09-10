import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { FirestoreCollection, RefreshTrigger } from '@shared/firestore';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { TimeSeriesRunStatus } from '../jobs/time-series-jobs.model';
import { PartnerRunStatus } from '../../partner/constants';
import { publishIntradayPdr } from '../jobs/intraday-snapshot-jobs.aggregator';

const logger = betterLogger('iSH');

export interface ForceCompletedRun {
  runId: string;
  clockPt: string;
}

/**
 * Before creating jobs for a new tick, force-completes any IN_PROGRESS
 * intraday runs from a previous tick on the same market date.
 *
 * For each stale run:
 * 1. Uses a Firestore transaction to atomically set `status=COMPLETE`,
 *    `staleRun=true`, and `runFinishedAt=now`. The transaction checks
 *    that the run is still IN_PROGRESS before updating — this prevents
 *    double-completion if a late job callback already completed the run.
 * 2. Publishes a PDR with `runStatus=FAILED` so downstream consumers
 *    (RS, SA) are notified that the run did not complete normally.
 *
 * Returns the list of force-completed runs (empty if none were stale).
 */
export async function forceCompleteStaleIntradayRuns(
  marketDate: string,
): Promise<ForceCompletedRun[]> {
  const staleSnap = await db
    .collection(FirestoreCollection.INTRADAY_RUNS)
    .where('marketDate', '==', marketDate)
    .where('status', '==', TimeSeriesRunStatus.IN_PROGRESS)
    .get();

  if (staleSnap.empty) {
    return [];
  }

  const results: ForceCompletedRun[] = [];

  for (const doc of staleSnap.docs) {
    const runData = doc.data() as any;
    const runId: string = runData.runId;
    const clockPt: string = runData.clockPt;

    let didComplete = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(doc.ref);
      if (!snap.exists) return;
      const current = snap.data() as any;
      if (current?.status === TimeSeriesRunStatus.COMPLETE) return;

      tx.update(doc.ref, {
        status: TimeSeriesRunStatus.COMPLETE,
        staleRun: true,
        runFinishedAt: Timestamp.now(),
      });
      didComplete = true;
    });

    if (!didComplete) {
      logger.info('intraday.self_healing.skip_already_complete', {
        runId,
        marketDate,
        clockPt,
      } as BetterLogPayload);
      continue;
    }

    logger.warn('intraday.self_healing.force_completed', {
      runId,
      marketDate,
      clockPt,
      staleRun: true,
    } as BetterLogPayload);

    try {
      await publishIntradayPdr({
        runId,
        marketDate,
        clockPt,
        successJobs: runData.successJobs ?? 0,
        permanentFailureJobs: runData.permanentFailureJobs ?? 0,
        trigger: runData.trigger as RefreshTrigger | undefined,
        totalDuration: undefined,
        runStatusOverride: PartnerRunStatus.FAILED,
      });
    } catch (e: any) {
      logger.warn('intraday.self_healing.pdr_failed', {
        runId,
        error: String(e?.message ?? e),
      } as BetterLogPayload);
    }

    results.push({ runId, clockPt });
  }

  return results;
}
