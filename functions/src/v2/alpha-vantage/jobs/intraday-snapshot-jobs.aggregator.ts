import { db } from '../../../firebase-admin-init';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { PubSub } from '@google-cloud/pubsub';
import { GoogleAuth } from 'google-auth-library';

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
import { computeRunBarStatus, prevTradingDay, isoWeek, monthOf } from '../../common/bar-status/bar-status.service';

const logger = betterLogger('iS.Agg');

export interface OnIntradayRunJobTerminalArgs {
  runId: string;
  symbol: string;
  /** ET trading date (YYYY-MM-DD) for the run — embedded in the PDR payload. */
  marketDate: string;
  /** PT clock label (HHMM) of the tick — included in the PDR payload so consumers can identify which tick completed. */
  clockPt: string;
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
 * notifications per trading day. `clockPt` is included in the payload so
 * consumers can identify which hourly tick triggered the run.
 */
async function publishIntradayPdr(options: {
  runId: string;
  marketDate: string;
  clockPt: string;
  successJobs: number;
  permanentFailureJobs: number;
  trigger: RefreshTrigger | undefined;
  totalDuration: number | undefined;
}): Promise<void> {
  const { runId, marketDate, clockPt, successJobs, permanentFailureJobs, trigger, totalDuration } =
    options;
  
  logger.info('intraday.agg.pdr.enter', { runId, marketDate, clockPt, successJobs, permanentFailureJobs, trigger, totalDuration } as any);

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

  logger.info('intraday.agg.pdr.local_enqueue_start', { runId, payload: { version: payload.version, phase: payload.phase, status: payload.status, runStatus: payload.runStatus } } as any);
  const runBarStatus = computeRunBarStatus('pre', clockPt);
  // Compute barStatusWeekly and barStatusMonthly using prevTradingDay period-boundary logic.
  // # Reason: W/M bars get -1 on the first PRE of a new period, determined by whether the
  // previous trading day falls in a different ISO week / calendar month than today.
  const prev = prevTradingDay(marketDate);
  const runBarStatusWeekly: -1 | 0 = (runBarStatus === -1 && isoWeek(prev) !== isoWeek(marketDate)) ? -1 : 0;
  const runBarStatusMonthly: -1 | 0 = (runBarStatus === -1 && monthOf(prev) !== monthOf(marketDate)) ? -1 : 0;
  await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, {
    runType: PartnerRunType.INTRADAY_SNAPSHOT,
    clockPt,
    successes: String(successJobs),
    permanentFailures: String(permanentFailureJobs),
    barStatusDaily: String(runBarStatus),
    barStatusWeekly: String(runBarStatusWeekly),
    barStatusMonthly: String(runBarStatusMonthly),
  });
  logger.info('intraday.agg.pdr.local_enqueue_done', { runId } as any);

  // Cross-project publish to RS topic for intraday snapshot handler
  const rsProjectId = 'rel-str';
  const rsTopicName = 'partner-data-ready';
  logger.info('intraday.agg.pdr.cross_project_start', { runId, rsProjectId, rsTopicName } as any);
  
  // Log the service account being used
  try {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const credentials = await auth.getCredentials();
    const projectId = await auth.getProjectId();
    logger.info('intraday.agg.pdr.auth_info', { 
      runId, 
      projectId, 
      clientEmail: (client as any)?.email || 'unknown',
      clientId: (client as any)?.id || 'unknown',
      credentialsClientEmail: credentials?.client_email || 'unknown'
    } as any);
  } catch (authErr: any) {
    logger.warn('intraday.agg.pdr.auth_info_failed', { runId, error: String(authErr?.message) } as any);
  }
  
  try {
    // CRITICAL FIX: Use default project PubSub client but with full topic path for cross-project
    const rsPubSub = new PubSub();
    const fullTopicPath = `projects/${rsProjectId}/topics/${rsTopicName}`;
    const rsTopic = rsPubSub.topic(fullTopicPath);
    logger.info('intraday.agg.pdr.pubsub_config', { runId, rsProjectId, fullTopicPath, rsTopicName } as any);
    const rsAttributes = {
      runId,
      version: payload.version,
      phase: payload.phase,
      marketDate,
      runType: PartnerRunType.INTRADAY_SNAPSHOT,
      clockPt,
      successes: String(successJobs),
      barStatusDaily: String(runBarStatus),
      barStatusWeekly: String(runBarStatusWeekly),
      barStatusMonthly: String(runBarStatusMonthly),
    };
    logger.info('intraday.agg.pdr.cross_project_publish_attempt', { runId, rsProjectId, rsTopicName, fullTopicPath, payloadSize: JSON.stringify(payload).length } as any);
    const rsMessageId = await rsTopic.publishMessage({ json: payload, attributes: rsAttributes });
    logger.info('intraday.agg.pdr_cross_project_sent', { runId, clockPt, rsProjectId, rsTopicName, rsMessageId } as any);
  } catch (crossErr: any) {
    const errorStr = String(crossErr?.message ?? crossErr ?? 'unknown');
    const errorCode = crossErr?.code ?? 'N/A';
    const fullError = JSON.stringify(crossErr, Object.getOwnPropertyNames(crossErr));
    console.error(`[PDR_CROSS_PROJECT_ERROR] runId=${runId} code=${errorCode} error=${errorStr} full=${fullError}`);
    // Write debug doc to Firestore to capture exact error
    await db.doc(`debug/pdr-cross-project/${runId}`).set({
      timestamp: Timestamp.now(),
      runId,
      errorMessage: errorStr,
      errorCode,
      fullError,
      rsProjectId,
      rsTopicName,
    }).catch(() => {}); // ignore write errors
    logger.warn('intraday.agg.pdr_cross_project_failed', { runId, errorMessage: errorStr, errorCode, fullErrorPreview: fullError.slice(0,200) } as any);
  }
  logger.info('intraday.agg.pdr.exit', { runId } as any);

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
  const { runId, symbol, marketDate, clockPt, status } = args;
  const runRef = db.doc(`${FirestoreCollection.INTRADAY_RUNS}/${runId}`);
  
  // ENTRY LOGGING: Full context at function entry
  logger.info('intraday.agg.enter', { 
    runId, symbol, marketDate, clockPt, status,
    INTRADAY_MAX_RUN_DURATION_MS,
    time: Date.now()
  } as any);

  try {
    // Increment counters inside a transaction.
    logger.info('intraday.agg.tx.start', { runId, symbol, status } as any);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      logger.info('intraday.agg.tx.run_fetch', { runId, exists: snap.exists } as any);
      if (!snap.exists) {
        logger.warn('intraday.agg.run_not_found', { runId } as any);
        return;
      }

      if (status === TimeSeriesJobTerminalStatus.SUCCESS) {
        logger.info('intraday.agg.tx.increment_success', { runId, symbol } as any);
        tx.update(runRef, {
          successJobs: FieldValue.increment(1),
          finishedJobs: FieldValue.increment(1),
        });
      } else if (status === TimeSeriesJobTerminalStatus.PERMANENT_FAILURE) {
        logger.info('intraday.agg.tx.increment_failure', { runId, symbol } as any);
        tx.update(runRef, {
          permanentFailureJobs: FieldValue.increment(1),
          finishedJobs: FieldValue.increment(1),
          permanentFailureSymbols: FieldValue.arrayUnion(symbol),
        });
      }
    });
    logger.info('intraday.agg.tx.complete', { runId, symbol, status } as any);

    // Check completion outside the transaction.
    const runSnap = await runRef.get();
    const runData = runSnap.data() as any | undefined;
    logger.info('intraday.agg.run_data_fetched', { 
      runId, 
      hasData: !!runData,
      createdJobs: runData?.createdJobs,
      finishedJobs: runData?.finishedJobs,
      successJobs: runData?.successJobs,
      currentStatus: runData?.status,
      jobsCreationStartedAt: runData?.jobsCreationStartedAt?.toMillis?.() || runData?.jobsCreationStartedAt
    } as any);
    if (!runData) return;

    const created: number = typeof runData.createdJobs === 'number' ? runData.createdJobs : 0;
    const finished: number = typeof runData.finishedJobs === 'number' ? runData.finishedJobs : 0;
    const currentStatus: TimeSeriesRunStatus | undefined = runData.status;
    
    logger.info('intraday.agg.counters', { runId, created, finished, currentStatus, willCheckCompletion: currentStatus !== TimeSeriesRunStatus.COMPLETE } as any);

    if (currentStatus === TimeSeriesRunStatus.COMPLETE) {
      logger.info('intraday.agg.already_complete', { runId } as any);
      return;
    }

    // Determine the age of this run for the reconcile path.
    const jobsCreationStartedAt = runData.jobsCreationStartedAt as
      | FirebaseFirestore.Timestamp
      | undefined;
    let runAgeMs = 0;
    if (jobsCreationStartedAt && typeof (jobsCreationStartedAt as any).toMillis === 'function') {
      runAgeMs = Date.now() - (jobsCreationStartedAt as any).toMillis();
    }
    const pastReconcileWindow = runAgeMs > INTRADAY_MAX_RUN_DURATION_MS;
    logger.info('intraday.agg.reconcile_check', { runId, runAgeMs, INTRADAY_MAX_RUN_DURATION_MS, pastReconcileWindow } as any);

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
    logger.info('intraday.agg.path_check', { runId, created, finished, isFastPath: created > 0 && finished === created, isReconcilePath: created > 0 && finished > 0 && pastReconcileWindow } as any);
    if (created > 0 && finished === created) {
      logger.info('intraday.agg.fast_path_enter', { runId, created, finished } as any);
      const totalDuration = await completeRun();
      logger.info('intraday.agg.run_complete', { runId, marketDate, clockPt, totalDuration } as any);

      try {
        logger.info('intraday.agg.pdr_invoke', { runId, marketDate, clockPt, successJobs: runData.successJobs ?? 0, permanentFailureJobs: runData.permanentFailureJobs ?? 0 } as any);
        await publishIntradayPdr({
          runId,
          marketDate,
          clockPt,
          successJobs: runData.successJobs ?? 0,
          permanentFailureJobs: runData.permanentFailureJobs ?? 0,
          trigger: runData.trigger as RefreshTrigger | undefined,
          totalDuration,
        });
        logger.info('intraday.agg.pdr_returned', { runId } as any);
      } catch (pdrErr: any) {
        logger.warn('intraday.agg.pdr_failed', { runId, error: String(pdrErr?.message ?? pdrErr) } as any);
      }
      logger.info('intraday.agg.fast_path_exit', { runId } as any);
      return;
    }

    // --- Reconcile path ---
    // Reason: at 760 symbols with Cloud Tasks retries, the last job callback may
    // arrive out of order and the counter equality is never hit. After the
    // 20-min window, re-scan all job docs to determine final state.
    if (created > 0 && finished > 0 && pastReconcileWindow) {
      logger.warn('intraday.agg.reconcile_enter', { runId, created, finished, runAgeMs } as any);

      await reconcileIntradayRunJobs(runId);

      const reconSnap = await runRef.get();
      const reconData = reconSnap.data() as any | undefined;
      if (!reconData) return;

      const totalDuration = await completeRun();
      logger.info('intraday.agg.run_complete_after_reconcile', { runId, marketDate, clockPt } as any);

      try {
        await publishIntradayPdr({
          runId,
          marketDate,
          clockPt,
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
      marketDate,
      clockPt,
      status,
      error: String(e?.message ?? e),
      stack: e?.stack,
      phase: 'onIntradayRunJobTerminal'
    } as any);
    throw e;
  }
}
