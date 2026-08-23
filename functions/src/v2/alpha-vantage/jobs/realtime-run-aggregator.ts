/**
 * Aggregator for realtime run completion using the `realtime-runs/{runId}` model.
 *
 * Updates the `realtime-runs/{runId}` document counters when a job reaches
 * a terminal state (SUCCESS or PERMANENT_FAILURE). When all created jobs
 * have reached a terminal state and jobsCreationCompleteAt has been set,
 * the run is marked COMPLETE.
 */
import { db } from '../../../firebase-admin-init';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { FirestoreCollection, RefreshTrigger } from '@shared/firestore';

import { TimeSeriesJobTerminalStatus, TimeSeriesRunStatus, type RealtimeRun } from './time-series-jobs.model';
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
import { MAX_NON_SUCCESS_JOBS_IN_RUN_DOC, MAX_RUN_DURATION_MS } from './job-config';

const logger = betterLogger('rTRA');

async function reconcileRunJobs(runId: string): Promise<void> {
  const runRef = db.doc(`${FirestoreCollection.REALTIME_RUNS}/${runId}`);
  const jobsCol = runRef.collection(FirestoreCollection.JOBS);

  const snap = await jobsCol.get();
  const totalJobs = snap.size;

  let successJobs = 0;
  let permanentFailureJobs = 0;
  const nonSuccessJobs: Array<{
    symbol: string;
    endpoint: string;
    status: string;
    dataFreshness?: string;
    lastAttemptAtMs?: number;
    reason?: string;
  }> = [];

  const nowMs = Date.now();

  for (const doc of snap.docs) {
    const d = doc.data() as any;
    const status = String(d.status || '').toUpperCase();
    const symbol = String(d.symbol || '').toUpperCase();
    const endpoint = String(d.endpoint || '');
    const dataFreshness = d.dataFreshness ? String(d.dataFreshness) : undefined;
    const lastAttemptAt = d.lastAttemptAt as Timestamp | undefined;
    const lastAttemptAtMs =
      lastAttemptAt && typeof (lastAttemptAt as any).toMillis === 'function'
        ? (lastAttemptAt as any).toMillis()
        : undefined;

    const isTerminal = status === 'SUCCESS' || status === 'PERMANENT_FAILURE';

    if (status === 'SUCCESS') {
      successJobs += 1;
      continue;
    }
    if (status === 'PERMANENT_FAILURE') {
      permanentFailureJobs += 1;
      continue;
    }

    let reason: string | undefined;
    if (!isTerminal && lastAttemptAtMs && nowMs - lastAttemptAtMs > MAX_RUN_DURATION_MS) {
      reason = 'timeout';
    } else if (!isTerminal) {
      reason = 'pending';
    } else {
      reason = 'failed';
    }

    if (nonSuccessJobs.length < MAX_NON_SUCCESS_JOBS_IN_RUN_DOC) {
      nonSuccessJobs.push({
        symbol,
        endpoint,
        status,
        dataFreshness,
        lastAttemptAtMs,
        reason,
      });
    }
  }

  const nonSuccessJobsCount = totalJobs - successJobs;

  await runRef.set(
    {
      createdJobs: totalJobs,
      successJobs,
      permanentFailureJobs,
      nonSuccessJobsCount,
      nonSuccessJobs,
    },
    { merge: true },
  );
}

function formatDurationMs(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return undefined;
  }

  const totalSeconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return `${mm}:${ss}`;
}

export interface OnRealtimeRunJobTerminalArgs {
  runId: string;
  symbol: string;
  status: TimeSeriesJobTerminalStatus;
}

export async function onRealtimeRunJobTerminal(args: OnRealtimeRunJobTerminalArgs): Promise<void> {
  const { runId, symbol, status } = args;
  const runRef = db.doc(`${FirestoreCollection.REALTIME_RUNS}/${runId}`);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      if (!snap.exists) {
        logger.warn('realtime.run_not_found', { runId } as any);
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
          // Track the set of symbols that reached permanent failure for
          // this run so that downstream tooling can inspect or surface
          // them without re-scanning all job docs.
          permanentFailureSymbols: FieldValue.arrayUnion(symbol),
          // Permanent failures are always part of the per-run retry set so
          // that future A/B/C passes can selectively target them.
          retrySymbols: FieldValue.arrayUnion(symbol),
        });
      }
    });

    // Check completion outside transaction.
    const runSnap = await runRef.get();
    const runData = runSnap.data() as RealtimeRun | undefined;
    if (!runData) {
      return;
    }

    const created = typeof runData.createdJobs === 'number' ? runData.createdJobs : 0;
    const finished = typeof runData.finishedJobs === 'number' ? runData.finishedJobs : 0;
    const currentStatus: TimeSeriesRunStatus | undefined = runData.status;

    const jobsCreationStartedAt = runData.jobsCreationStartedAt as Timestamp | undefined;
    let withinWindow = false;
    if (jobsCreationStartedAt && typeof (jobsCreationStartedAt as any).toMillis === 'function') {
      try {
        const startMs = (jobsCreationStartedAt as any).toMillis();
        withinWindow = Date.now() - startMs < MAX_RUN_DURATION_MS;
      } catch {
        withinWindow = false;
      }
    }

    // Fast path: all jobs finished within the processing window.
    if (created > 0 && finished === created && currentStatus !== TimeSeriesRunStatus.COMPLETE) {
      const now = Timestamp.now();
      const startedAt = (runData.runStartedAt as Timestamp | undefined) ?? (runData.runCreatedAt as Timestamp | undefined);
      let totalDuration: number | undefined;

      if (startedAt && typeof (startedAt as any).toMillis === 'function') {
        try {
          const startMs = (startedAt as any).toMillis();
          const endMs = (now as any).toMillis();
          totalDuration = typeof startMs === 'number' && typeof endMs === 'number' ? endMs - startMs : undefined;
        } catch {
          totalDuration = undefined;
        }
      }

      const totalDurationFormatted = formatDurationMs(totalDuration);

      // Atomically claim completion: only one worker wins the race to set COMPLETE.
      // This prevents duplicate PDR messages when multiple workers finish
      // concurrently and both see finished === created.
      let didComplete = false;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(runRef);
        if (!snap.exists) return;
        const current = snap.data() as any;
        if (current?.status === TimeSeriesRunStatus.COMPLETE) return;
        tx.update(runRef, {
          status: TimeSeriesRunStatus.COMPLETE,
          runFinishedAt: now,
          totalDuration,
          totalDurationFormatted,
        });
        didComplete = true;
      });

      if (!didComplete) {
        // Another worker already completed this run; skip PDR publish.
        logger.info('realtime.run_already_complete', { runId } as any);
        return;
      }

      // Snapshot the final run doc for alerting/logging. Expose the full
      // run state in the message body, but omit the potentially large
      // retrySymbols array and instead surface its length.
      const retrySymbolsArr = Array.isArray(runData.retrySymbols) ? runData.retrySymbols : [];
      const { retrySymbols, ...runDocSansRetry } = runData as any;
      const finalSummary = {
        ...runDocSansRetry,
        retrySymbolsCount: retrySymbolsArr.length,
      };

      logger.info('realtime.run_complete', {
        runId,
        message: JSON.stringify(finalSummary),
      } as any);

      // After marking the realtime run COMPLETE, emit a single
      // partner-data-ready END message for this interval run. This
      // mirrors the existing RS contract while providing interval-
      // level retrySymbols for selective ingestion.
      try {
        const nowMs = Date.now();

        // Map internal TradingPhase/RefreshTrigger to partner enums.
        const phasePartner = PartnerPhase.POST;
        const triggerInternal = runData.trigger as RefreshTrigger | undefined;
        const triggerPartner: PartnerTrigger | undefined =
          triggerInternal === RefreshTrigger.MANUAL
            ? PartnerTrigger.MANUAL
            : triggerInternal === RefreshTrigger.SCHEDULER
              ? PartnerTrigger.SCHEDULED
              : undefined;

        const hasPermanentFailures = (runData.permanentFailureJobs || 0) > 0;
        const endRunStatus = hasPermanentFailures
          ? PartnerRunStatus.COMPLETED_WITH_ERRORS
          : PartnerRunStatus.COMPLETED;

        const intervals = [runData.interval];

        // Derive includeSymbols / excludeSymbols semantics for RS based on
        // runType and sequence:
        // - A (ts-post-all-intervals-initial): initial full-universe run.
        //   RS treats this as the full universe minus excludeSymbols.
        //   excludeSymbols = retrySymbols, includeSymbols omitted.
        // - B/C (ts-post-all-intervals-retry): retry-only passes.
        //   RS reads includeSymbols only; these are symbols that became
        //   fresh in this retry pass.

        const runTypeStr = (runData.runType || '').toString();
        const seq = ((runData as any).sequence || '').toString();
        const retrySymbolsArr = Array.isArray(runData.retrySymbols) ? runData.retrySymbols : [];
        const retrySuccessArr = Array.isArray((runData as any).retrySuccessSymbols)
          ? (runData as any).retrySuccessSymbols as string[]
          : [];

        let excludeSymbols: string[] = [];
        let includeSymbols: string[] = [];

        if (runTypeStr === 'ts-post-all-intervals-initial' && seq === 'A') {
          // Initial A run: full universe minus retrySymbols.
          excludeSymbols = retrySymbolsArr;
        } else if (runTypeStr === 'ts-post-all-intervals-retry' && (seq === 'B' || seq === 'C')) {
          // Retry runs (B/C): only includeSymbols matter for RS.
          includeSymbols = retrySuccessArr;
        }

        const payload: DataReadyPayloadV1 = {
          version: 'v1',
          runId,
          phase: phasePartner,
          intervals,
          time: nowMs,
          marketDate: runData.marketDate,
          env: (process.env.NODE_ENV || 'dev') as string,
          status: PartnerPublishStatus.END,
          runStatus: endRunStatus,
          durationMs: totalDuration,
          finalizedCountTotal: runData.successJobs,
          pendingCount: 0,
          // retrySymbols is now obsolete for RS behavior; includeSymbols /
          // excludeSymbols carry the fetch semantics. We keep retrySymbols on
          // the run doc for internal diagnostics only.
          includeSymbols: includeSymbols.length > 0 ? includeSymbols : undefined,
          excludeSymbols: excludeSymbols.length > 0 ? excludeSymbols : undefined,
          ...(triggerPartner ? { trigger: triggerPartner } : {}),
        };

        await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, {
          runType: PartnerRunType.TS_POST_ALL_INTERVALS,
          interval: String(runData.interval),
          successes: String(runData.successJobs || 0),
          permanentFailures: String(runData.permanentFailureJobs || 0),
        });

        // Persist partner data-ready message state on the run doc for
        // observability and debugging.
        await runRef.update({
          partnerDataReady: {
            messageSent: true,
            sendTime: Timestamp.fromMillis(nowMs),
            messagePayload: payload,
          },
        });
      } catch (pubErr: any) {
        logger.error('realtime.run_pdr_error', {
          runId,
          error: String(pubErr?.message || pubErr),
        } as any);
      }
    } else if (
      created > 0 &&
      finished > 0 &&
      !withinWindow &&
      currentStatus !== TimeSeriesRunStatus.COMPLETE
    ) {
      // Outside the processing window and still not complete: reconcile job
      // state from the jobs subcollection, then force-complete and publish a
      // PDR based on the reconciled counters and non-success summary.
      logger.warn('realtime.run_reconcile_before_complete', {
        runId,
        createdJobs: created,
        finishedJobs: finished,
      } as any);

      await reconcileRunJobs(runId);

      const reconciledSnap = await runRef.get();
      const reconciledData = reconciledSnap.data() as RealtimeRun | undefined;
      if (!reconciledData) {
        return;
      }

      const recCreated = typeof reconciledData.createdJobs === 'number' ? reconciledData.createdJobs : 0;
      const recFinished = typeof reconciledData.finishedJobs === 'number' ? reconciledData.finishedJobs : 0;

      if (recCreated === 0 || recFinished === 0) {
        return;
      }

      const now = Timestamp.now();
      const startedAt = (reconciledData.runStartedAt as Timestamp | undefined)
        ?? (reconciledData.runCreatedAt as Timestamp | undefined);
      let totalDuration: number | undefined;

      if (startedAt && typeof (startedAt as any).toMillis === 'function') {
        try {
          const startMs = (startedAt as any).toMillis();
          const endMs = (now as any).toMillis();
          totalDuration = typeof startMs === 'number' && typeof endMs === 'number' ? endMs - startMs : undefined;
        } catch {
          totalDuration = undefined;
        }
      }

      const totalDurationFormatted = formatDurationMs(totalDuration);

      // Atomically claim completion to prevent duplicate PDR from concurrent reconcile.
      let didComplete = false;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(runRef);
        if (!snap.exists) return;
        const current = snap.data() as any;
        if (current?.status === TimeSeriesRunStatus.COMPLETE) return;
        tx.update(runRef, {
          status: TimeSeriesRunStatus.COMPLETE,
          runFinishedAt: now,
          totalDuration,
          totalDurationFormatted,
        });
        didComplete = true;
      });

      if (!didComplete) {
        logger.info('realtime.run_already_complete_after_reconcile', { runId } as any);
        return;
      }

      const retrySymbolsArr = Array.isArray(reconciledData.retrySymbols) ? reconciledData.retrySymbols : [];
      const { retrySymbols, ...runDocSansRetry } = reconciledData as any;
      const finalSummary = {
        ...runDocSansRetry,
        retrySymbolsCount: retrySymbolsArr.length,
      };

      logger.info('realtime.run_complete_after_reconcile', {
        runId,
        message: JSON.stringify(finalSummary),
      } as any);

      try {
        const nowMs = Date.now();

        const phasePartner = PartnerPhase.POST;
        const triggerInternal = reconciledData.trigger as RefreshTrigger | undefined;
        const triggerPartner: PartnerTrigger | undefined =
          triggerInternal === RefreshTrigger.MANUAL
            ? PartnerTrigger.MANUAL
            : triggerInternal === RefreshTrigger.SCHEDULER
              ? PartnerTrigger.SCHEDULED
              : undefined;

        const hasPermanentFailures = (reconciledData.permanentFailureJobs || 0) > 0;
        const endRunStatus = hasPermanentFailures
          ? PartnerRunStatus.COMPLETED_WITH_ERRORS
          : PartnerRunStatus.COMPLETED;

        const intervals = [reconciledData.interval];

        const runTypeStr = (reconciledData.runType || '').toString();
        const seq = ((reconciledData as any).sequence || '').toString();
        const retrySymbolsArr = Array.isArray(reconciledData.retrySymbols) ? reconciledData.retrySymbols : [];
        const retrySuccessArr = Array.isArray((reconciledData as any).retrySuccessSymbols)
          ? (reconciledData as any).retrySuccessSymbols as string[]
          : [];

        let excludeSymbols: string[] = [];
        let includeSymbols: string[] = [];

        if (runTypeStr === 'ts-post-all-intervals-initial' && seq === 'A') {
          excludeSymbols = retrySymbolsArr;
        } else if (runTypeStr === 'ts-post-all-intervals-retry' && (seq === 'B' || seq === 'C')) {
          includeSymbols = retrySuccessArr;
        }

        const payload: DataReadyPayloadV1 = {
          version: 'v1',
          runId,
          phase: phasePartner,
          intervals,
          time: nowMs,
          marketDate: reconciledData.marketDate,
          env: (process.env.NODE_ENV || 'dev') as string,
          status: PartnerPublishStatus.END,
          runStatus: endRunStatus,
          durationMs: totalDuration,
          finalizedCountTotal: reconciledData.successJobs,
          pendingCount: 0,
          includeSymbols: includeSymbols.length > 0 ? includeSymbols : undefined,
          excludeSymbols: excludeSymbols.length > 0 ? excludeSymbols : undefined,
          ...(triggerPartner ? { trigger: triggerPartner } : {}),
        };

        await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, {
          runType: PartnerRunType.TS_POST_ALL_INTERVALS,
          interval: String(reconciledData.interval),
          successes: String(reconciledData.successJobs || 0),
          permanentFailures: String(reconciledData.permanentFailureJobs || 0),
        });

        await runRef.update({
          partnerDataReady: {
            messageSent: true,
            sendTime: Timestamp.fromMillis(nowMs),
            messagePayload: payload,
          },
        });
      } catch (pubErr: any) {
        logger.error('realtime.run_pdr_error_after_reconcile', {
          runId,
          error: String(pubErr?.message || pubErr),
        } as any);
      }
    }
  } catch (e: any) {
    logger.error('realtime.aggregator_error', {
      runId,
      status,
      error: String(e?.message || e),
    } as any);
    throw e;
  }
}
