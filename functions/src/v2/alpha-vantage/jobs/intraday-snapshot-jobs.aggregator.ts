import { db } from '../../../firebase-admin-init';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { TimeSeriesInterval } from '@shared/alpha-vantage';
import { FirestoreCollection, RefreshTrigger } from '@shared/firestore';

import { betterLogger } from '../../utils/utils';
import { enqueueDataReadyInternal } from '../../partner/data-ready.handler';
import type { DataReadyPayloadV1 } from '../../partner/schemas/data-ready.schema';
import {
  INTERNAL_PUBLISHER_AUDIT_EMAIL,
  PartnerPhase,
  PartnerRunStatus,
  PartnerRunType,
  PartnerPublishStatus,
  PartnerTrigger,
} from '../../partner/constants';
import { TimeSeriesJobTerminalStatus, TimeSeriesRunStatus } from './time-series-jobs.model';
import { INTRADAY_MAX_RUN_DURATION_MS, MAX_NON_SUCCESS_JOBS_IN_RUN_DOC } from './job-config';

const logger = betterLogger('iS.Agg');

export interface OnIntradayRunJobTerminalArgs {
  runId: string;
  symbol: string;
  /** ET trading date (YYYY-MM-DD) for the run — embedded in the PDR payload. */
  marketDate: string;
  /** ET clock label (HHMM) of the hourly tick — included in the PDR payload so consumers can identify which tick completed. */
  clockEt: string;
  status: TimeSeriesJobTerminalStatus;
}

/**
 * Formats a duration in milliseconds as "MM:SS".
 */
function formatDurationMs(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined;
  const totalSeconds = Math.floor(ms / 1_000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Re-scans all job documents in the subcollection and recomputes counters.
 * Used by the reconcile path when the run has exceeded INTRADAY_MAX_RUN_DURATION_MS
 * without the fast path (`finishedJobs === createdJobs`) triggering.
 */
async function reconcileIntradayRunJobs(runId: string): Promise<void> {
  const runRef = db.doc(`${FirestoreCollection.INTRADAY_RUNS}/${runId}`);
  const jobsCol = runRef.collection(FirestoreCollection.JOBS);
  const snap = await jobsCol.get();

  let successJobs = 0;
  let permanentFailureJobs = 0;
  const nonSuccessJobs: Array<{ symbol: string; status: string; reason: string }> = [];
  const nowMs = Date.now();

  for (const doc of snap.docs) {
    const d = doc.data() as any;
    const status = String(d.status || '').toUpperCase();
    const symbol = String(d.symbol || '').toUpperCase();
    const lastAttemptAtMs =
      d.lastAttemptAt && typeof d.lastAttemptAt.toMillis === 'function'
        ? d.lastAttemptAt.toMillis()
        : undefined;

    if (status === 'SUCCESS') { successJobs++; continue; }
    if (status === 'PERMANENT_FAILURE') { permanentFailureJobs++; continue; }

    const reason =
      lastAttemptAtMs && nowMs - lastAttemptAtMs > INTRADAY_MAX_RUN_DURATION_MS
        ? 'timeout'
        : 'pending';

    if (nonSuccessJobs.length < MAX_NON_SUCCESS_JOBS_IN_RUN_DOC) {
      nonSuccessJobs.push({ symbol, status, reason });
    }
  }

  await runRef.set(
    {
      createdJobs: snap.size,
      finishedJobs: successJobs + permanentFailureJobs,
      successJobs,
      permanentFailureJobs,
      nonSuccessJobsCount: snap.size - successJobs,
      nonSuccessJobs,
    },
    { merge: true },
  );
}

/**
 * Publishes the partner data-ready END message for an intraday snapshot run.
 *
 * Fires after every completed hourly run so consumers receive up to 6 PRE
 * notifications per trading day. `clockEt` is included in the payload so
 * consumers can identify which hourly tick triggered the run.
 */
async function publishIntradayPdr(options: {
  runId: string;
  marketDate: string;
  clockEt: string;
  successJobs: number;
  permanentFailureJobs: number;
  trigger: RefreshTrigger | undefined;
  totalDuration: number | undefined;
}): Promise<void> {
  const { runId, marketDate, clockEt, successJobs, permanentFailureJobs, trigger, totalDuration } =
    options;

  const triggerPartner: PartnerTrigger | undefined =
    trigger === RefreshTrigger.MANUAL
      ? PartnerTrigger.MANUAL
      : trigger === RefreshTrigger.SCHEDULER
        ? PartnerTrigger.SCHEDULED
        : undefined;

  const hasPermanentFailures = permanentFailureJobs > 0;
  const endRunStatus = hasPermanentFailures
    ? PartnerRunStatus.COMPLETED_WITH_ERRORS
    : PartnerRunStatus.COMPLETED;

  const payload: DataReadyPayloadV1 = {
    version: 'v1',
    runId,
    phase: PartnerPhase.PRE,
    intervals: [TimeSeriesInterval.INTRADAY],
    time: Date.now(),
    marketDate,
    env: (process.env.NODE_ENV || 'dev') as string,
    status: PartnerPublishStatus.END,
    runStatus: endRunStatus,
    durationMs: totalDuration,
    finalizedCountTotal: successJobs,
    pendingCount: 0,
    ...(triggerPartner ? { trigger: triggerPartner } : {}),
  };

  await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, {
    runType: PartnerRunType.INTRADAY_SNAPSHOT,
    clockEt,
    successes: String(successJobs),
    permanentFailures: String(permanentFailureJobs),
  });

  await db.doc(`${FirestoreCollection.INTRADAY_RUNS}/${runId}`).set(
    {
      partnerDataReady: {
        messageSent: true,
        sendTime: Timestamp.fromMillis(Date.now()),
        messagePayload: payload,
      },
    },
    { merge: true },
  );
}

/**
 * Called by the intraday snapshot worker when a job reaches a terminal state.
 *
 * Increments run-level counters and checks for completion via two paths:
 *
 * - **Fast path:** `finishedJobs === createdJobs` → mark COMPLETE and publish PDR immediately.
 * - **Reconcile path:** run age > INTRADAY_MAX_RUN_DURATION_MS without completing →
 *   re-scan job docs, force-complete, publish PDR. Handles lagging Cloud Tasks
 *   retries where the equality check is never hit.
 *
 * @param args Terminal job event args.
 */
export async function onIntradayRunJobTerminal(
  args: OnIntradayRunJobTerminalArgs,
): Promise<void> {
  const { runId, symbol, marketDate, clockEt, status } = args;
  const runRef = db.doc(`${FirestoreCollection.INTRADAY_RUNS}/${runId}`);

  try {
    // Increment counters inside a transaction.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      if (!snap.exists) {
        logger.warn('intraday.agg.run_not_found', { runId } as any);
        return;
      }

      if (status === TimeSeriesJobTerminalStatus.SUCCESS) {
        tx.update(runRef, {
          successJobs: FieldValue.increment(1),
          finishedJobs: FieldValue.increment(1),
        });
      } else if (status === TimeSeriesJobTerminalStatus.PERMANENT_FAILURE) {
        tx.update(runRef, {
          permanentFailureJobs: FieldValue.increment(1),
          finishedJobs: FieldValue.increment(1),
          permanentFailureSymbols: FieldValue.arrayUnion(symbol),
        });
      }
    });

    // Check completion outside the transaction.
    const runSnap = await runRef.get();
    const runData = runSnap.data() as any | undefined;
    if (!runData) return;

    const created: number = typeof runData.createdJobs === 'number' ? runData.createdJobs : 0;
    const finished: number = typeof runData.finishedJobs === 'number' ? runData.finishedJobs : 0;
    const currentStatus: TimeSeriesRunStatus | undefined = runData.status;

    if (currentStatus === TimeSeriesRunStatus.COMPLETE) return;

    // Determine the age of this run for the reconcile path.
    const jobsCreationStartedAt = runData.jobsCreationStartedAt as
      | FirebaseFirestore.Timestamp
      | undefined;
    let runAgeMs = 0;
    if (jobsCreationStartedAt && typeof (jobsCreationStartedAt as any).toMillis === 'function') {
      runAgeMs = Date.now() - (jobsCreationStartedAt as any).toMillis();
    }
    const pastReconcileWindow = runAgeMs > INTRADAY_MAX_RUN_DURATION_MS;

    // Helper to compute duration and mark the run COMPLETE.
    const completeRun = async (): Promise<number | undefined> => {
      const now = Timestamp.now();
      const startedAt =
        (runData.runStartedAt as FirebaseFirestore.Timestamp | undefined) ??
        (runData.runCreatedAt as FirebaseFirestore.Timestamp | undefined);
      let totalDuration: number | undefined;
      if (startedAt && typeof (startedAt as any).toMillis === 'function') {
        totalDuration = (now as any).toMillis() - (startedAt as any).toMillis();
      }
      await runRef.update({
        status: TimeSeriesRunStatus.COMPLETE,
        runFinishedAt: now,
        totalDuration,
        totalDurationFormatted: formatDurationMs(totalDuration),
      });
      return totalDuration;
    };

    // --- Fast path ---
    if (created > 0 && finished === created) {
      const totalDuration = await completeRun();
      logger.info('intraday.agg.run_complete', { runId, marketDate, clockEt } as any);

      try {
        await publishIntradayPdr({
          runId,
          marketDate,
          clockEt,
          successJobs: runData.successJobs ?? 0,
          permanentFailureJobs: runData.permanentFailureJobs ?? 0,
          trigger: runData.trigger as RefreshTrigger | undefined,
          totalDuration,
        });
      } catch (pdrErr: any) {
        logger.warn('intraday.agg.pdr_failed', { runId, error: String(pdrErr?.message ?? pdrErr) } as any);
      }
      return;
    }

    // --- Reconcile path ---
    // Reason: at 760 symbols with Cloud Tasks retries, the last job callback may
    // arrive out of order and the counter equality is never hit. After the
    // 20-min window, re-scan all job docs to determine final state.
    if (created > 0 && finished > 0 && pastReconcileWindow) {
      logger.warn('intraday.agg.reconcile', { runId, created, finished } as any);

      await reconcileIntradayRunJobs(runId);

      const reconSnap = await runRef.get();
      const reconData = reconSnap.data() as any | undefined;
      if (!reconData) return;

      const totalDuration = await completeRun();
      logger.info('intraday.agg.run_complete_after_reconcile', { runId, marketDate, clockEt } as any);

      try {
        await publishIntradayPdr({
          runId,
          marketDate,
          clockEt,
          successJobs: reconData.successJobs ?? 0,
          permanentFailureJobs: reconData.permanentFailureJobs ?? 0,
          trigger: reconData.trigger as RefreshTrigger | undefined,
          totalDuration,
        });
      } catch (pdrErr: any) {
        logger.warn('intraday.agg.pdr_failed', { runId, error: String(pdrErr?.message ?? pdrErr) } as any);
      }
    }
  } catch (e: any) {
    logger.error('intraday.agg.error', {
      runId,
      symbol,
      error: String(e?.message ?? e),
    } as any);
    throw e;
  }
}
