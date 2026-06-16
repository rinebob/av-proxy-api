import { db } from '../../../firebase-admin-init';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, OutputSize, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import { TradingPhase } from '@shared/health-metrics';

import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import {
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
} from '../../common/firestore/firestore-paths';
import {
  TimeSeriesJobStatus,
  TimeSeriesJobMode,
  TimeSeriesJobTerminalStatus,
  PeriodStatus,
  TimeSeriesJobType,
  TimeSeriesDataFreshness,
} from './time-series-jobs.model';
import { onBackfillJobTerminal } from './backfill-job-aggregator';
import { onRealtimeRunJobTerminal } from './realtime-run-aggregator';
import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { publishSymbolsReadyBatch } from '../../partner/symbols-ready.publisher';
import {
  deleteDailyAdjustedForSymbol,
  deleteWeeklyAdjustedForSymbol,
  deleteMonthlyAdjustedForSymbol,
} from '../firestore/av-backfill-delete-helpers';
import { MAX_JOB_ATTEMPTS, JOB_EXECUTION_DELAY_MS } from './job-config';

// Dedicated logger for the time-series job worker so pipeline logs are easy to filter
const logger = betterLogger('tSJ.w');

/**
 * Internal payload shape for processing a single time-series job.
 *
 * This is intentionally scoped to Alpha Vantage DAILY POST jobs for
 * the initial rollout. Weekly/Monthly and PRE-phase jobs can be added
 * later once the pipeline is validated.
 */
export interface ProcessTimeSeriesJobPayload {
  marketDate: string; // YYYY-MM-DD (ET trading date)
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  phase: TradingPhase;

  // Optional execution mode for this job. When omitted, the job is treated
  // as a standard compact refresh. FULL_BACKFILL jobs perform a destructive
  // refresh for the target symbol+endpoint using OutputSize.FULL.
  mode?: TimeSeriesJobMode;

  // Job type for routing to correct Firestore paths. Defaults to Realtime.
  // - Realtime: Uses time-series-jobs/{date}/jobs/{id} paths
  // - Backfill: Uses backfill-jobs/{runId}/jobs/{symbol} paths
  jobType?: TimeSeriesJobType;

  // Run ID for backfill jobs. Required when jobType is 'backfill'.
  // Format: YYYY-MM-DD-ENDPOINT-FULL_BACKFILL (e.g., "2026-01-24-DAILY-FULL_BACKFILL")
  runId?: string;

  // Optional flag indicating that this job is part of a deadline run
  // (e.g. the C run in the A/B/C POST sequence). Deadline runs are allowed
  // to treat persistently stale data as a terminal failure after retries.
  deadlineRun?: boolean;
}

/**
 * Core worker implementation for a single Alpha Vantage time-series job.
 *
 * NOTE: This function is not yet wired to a Cloud Function export. It is
 * intended to be called by a future HTTPS/Tasks wrapper once the job
 * pipeline is ready to be enabled in non-production environments.
 */

export async function processTimeSeriesJobInternal(payload: ProcessTimeSeriesJobPayload): Promise<void> {
  // Fixed delay to spread AV calls and make executions visible
  await new Promise((resolve) => setTimeout(resolve, JOB_EXECUTION_DELAY_MS));

  const { marketDate, symbol, endpoint, phase, jobType, runId, deadlineRun } = payload;

  const interval: TimeSeriesInterval =
    endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED
      ? TimeSeriesInterval.DAILY
      : endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED
        ? TimeSeriesInterval.WEEKLY
        : TimeSeriesInterval.MONTHLY;

  const baseLogPayload: BetterLogPayload = {
    function: 'pSJI',
    symbol,
    marketDate,
    interval,
    endpoint,
  };

  // Per-job pipeline logs: explicit START marker + initial worker.start event
  try {
    logger.start('ts.jobs.worker', baseLogPayload);
    logger.info('ts.jobs.worker.start', baseLogPayload);
  } catch {}

  // For Phase 1 we only support POST-phase time-series jobs for
  // DAILY/WEEKLY/MONTHLY adjusted endpoints.
  const isSupportedEndpoint =
    endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED ||
    endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED ||
    endpoint === AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED;
  if (!isSupportedEndpoint || phase !== TradingPhase.POST) {
    return;
  }

  // Route to correct Firestore path based on jobType.
  // BACKFILL jobs: backfill-runs/{runId}/jobs/{symbol-endpoint-phase}
  // Realtime jobs: realtime-runs/{runId}/jobs/{symbol-endpoint-phase}
  const jobId = `${symbol.toUpperCase()}-${endpoint}-${phase}`;
  let jobPath: string;

  if (jobType === TimeSeriesJobType.BACKFILL) {
    if (!runId) {
      logger.error('ts.jobs.worker.missing_runId', baseLogPayload);
      throw new Error('runId is required for backfill jobs');
    }
    jobPath = `${FirestoreCollection.BACKFILL_RUNS}/${runId}/${FirestoreCollection.JOBS}/${jobId}`;
  } else {
    // All realtime jobs must have a runId in the new pipeline
    if (!runId) {
      logger.error('ts.jobs.worker.missing_runId', baseLogPayload);
      throw new Error('runId is required for realtime jobs');
    }
    jobPath = `${FirestoreCollection.REALTIME_RUNS}/${runId}/${FirestoreCollection.JOBS}/${jobId}`;
  }
  const jobRef = db.doc(jobPath);

  // Load and gate on current status.
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    // No job to process; idempotent no-op.
    return;
  }

  const jobData = jobSnap.data() as any;
  const status: TimeSeriesJobStatus | undefined = jobData?.status;
  const rawMode = jobData?.mode as TimeSeriesJobMode | undefined;
  const mode: TimeSeriesJobMode = rawMode ?? TimeSeriesJobMode.Compact;

  if (status === TimeSeriesJobStatus.Success || status === TimeSeriesJobStatus.PermanentFailure) {
    // Terminal states: nothing to do.
    return;
  }

  try {
    logger.timeStart('worker.symbol', baseLogPayload);
  } catch {}

  // Mark IN_PROGRESS and bump attempts transactionally. Keep this
  // transaction scoped to the job document only to avoid "reads after
  // writes" issues when touching the parent run document.
  await db.runTransaction(async tx => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) {
      return;
    }
    const data = snap.data() as any;
    const currentStatus: TimeSeriesJobStatus | undefined = data?.status;
    if (currentStatus === TimeSeriesJobStatus.Success || currentStatus === TimeSeriesJobStatus.PermanentFailure) {
      return;
    }
    const attempts = typeof data?.attempts === 'number' ? data.attempts : 0;

    tx.set(
      jobRef,
      {
        status: TimeSeriesJobStatus.InProgress,
        attempts: attempts + 1,
        lastAttemptAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  });

  // For realtime runs with a runId, stamp runStartedAt the first time any
  // job enters IN_PROGRESS so that run-level duration captures actual AV
  // fetch time. This is done outside the job transaction to keep the
  // transaction simple and avoid read-after-write constraints.
  if (runId && jobType !== TimeSeriesJobType.BACKFILL) {
    const runRef = db.doc(`${FirestoreCollection.REALTIME_RUNS}/${runId}`);
    try {
      const runSnap = await runRef.get();
      if (runSnap.exists) {
        const runData = runSnap.data() as any;
        if (!runData?.runStartedAt) {
          await runRef.set(
            {
              runStartedAt: Timestamp.now(),
            },
            { merge: true },
          );
        }
      }
    } catch {
      // Best-effort only; do not fail the job if runStartedAt cannot be stamped.
    }
  }

  const targetTs = new Date(`${marketDate}T00:00:00.000Z`).getTime();

  try {
    const handler = AlphaVantageHandlerFactory.createHandler(endpoint);

    // Stamp attempt metadata at the moment we begin the Alpha Vantage fetch so
    // we can distinguish job creation from real work. firstAttemptedAt records
    // when the first AV fetch started; lastAttemptAt records the most recent
    // attempt; attempts is incremented for each worker invocation that reaches
    // this point.
    const nowAttempt = Timestamp.now();
    const snapBefore = await jobRef.get();
    const dataBefore = snapBefore.data() as any;
    const attemptsBefore: number =
      dataBefore && typeof dataBefore.attempts === 'number' ? dataBefore.attempts : 0;

    const attemptUpdates: Record<string, unknown> = {
      lastAttemptAt: nowAttempt,
      attempts: attemptsBefore + 1,
    };

    if (!dataBefore?.firstAttemptedAt) {
      attemptUpdates.firstAttemptedAt = nowAttempt;
    }

    await jobRef.set(attemptUpdates, { merge: true });

    // Derive the desired output size from the job mode. COMPACT jobs perform
    // a small-window refresh, while FULL_BACKFILL jobs perform a destructive
    // full history rebuild for the target symbol+endpoint.
    const outputSizeForJob = mode === TimeSeriesJobMode.FullBackfill ? OutputSize.FULL : OutputSize.COMPACT;

    if (mode === TimeSeriesJobMode.FullBackfill) {
      // For full backfills, clear the existing sa-time-series tree for this
      // symbol+endpoint before fetching FULL history via the canonical handler.
      if (endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED) {
        await deleteDailyAdjustedForSymbol(symbol);
      } else if (endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED) {
        await deleteWeeklyAdjustedForSymbol(symbol);
      } else if (endpoint === AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED) {
        await deleteMonthlyAdjustedForSymbol(symbol);
      }
    }

    await handler.fetch({
      symbol,
      outputsize: outputSizeForJob,
      __phase: phase,
    });

    // Verify that we now have a bar for marketDate or later, based on the
    // authoritative series metadata derived from bars. We intentionally use
    // lastBarTs from the appropriate time-series document, rather than any
    // parent-doc timestamp fields, to avoid coupling completeness to
    // secondary summaries.
    const vendor = ApiProvider.ALPHA_VANTAGE;

    let latestMs: number | null = null;

    if (interval === TimeSeriesInterval.DAILY || interval === TimeSeriesInterval.WEEKLY) {
      const year = new Date(`${marketDate}T00:00:00.000Z`).getUTCFullYear();
      const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, year, true);
      const yearRef = db.doc(yearDocPath);
      const yearSnap = await yearRef.get();
      const lastBarTs = yearSnap.get('lastBarTs');
      latestMs = typeof lastBarTs === 'number' ? lastBarTs : null;
    } else {
      const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor, true);
      const allRef = db.doc(allDocPath);
      const allSnap = await allRef.get();
      const lastBarTs = allSnap.get('lastBarTs');
      latestMs = typeof lastBarTs === 'number' ? lastBarTs : null;
    }

    const latestValue = latestMs ?? undefined;
    const hasBar = typeof latestValue === 'number';
    const isPeriodEnd = hasBar && latestValue >= targetTs;
    const periodStatus = isPeriodEnd ? PeriodStatus.PERIOD_END : PeriodStatus.IN_PROGRESS;

    // Derive a data freshness signal that is orthogonal to job status.
    // - UNKNOWN: we do not yet have any bar timestamp recorded.
    // - FRESH: latest bar is at/after the target period end.
    // - STALE: we have a bar, but it is still before the target period end.
    let dataFreshness: TimeSeriesDataFreshness;
    if (!hasBar) {
      dataFreshness = TimeSeriesDataFreshness.UNKNOWN;
    } else if (isPeriodEnd) {
      dataFreshness = TimeSeriesDataFreshness.FRESH;
    } else {
      dataFreshness = TimeSeriesDataFreshness.STALE;
    }

    // For deadline runs, treat persistently stale data as a failure so that
    // it flows through the existing retry/MAX_ATTEMPTS logic and, if it
    // remains stale, is ultimately surfaced as a permanent failure.
    if (deadlineRun && dataFreshness === TimeSeriesDataFreshness.STALE) {
      throw new Error('STALE_AT_DEADLINE');
    }

    // Handler ran without throwing; treat the job itself as SUCCESS.
    // Period completion is tracked separately via periodStatus.
    await jobRef.set({
      status: TimeSeriesJobStatus.Success,
      periodStatus,
      finalizedAtMs: isPeriodEnd ? targetTs : undefined,
      updatedAt: Timestamp.now(),
      // Clear any previous error; remaining IN_PROGRESS vs PERIOD_END state
      // is captured by periodStatus.
      lastError: FieldValue.delete(),
      dataFreshness,
    }, { merge: true });

    // For realtime runs with a runId, maintain per-run retry/stale sets:
    // - If data remains STALE, record the symbol in staleSymbols and
    //   retrySymbols so future C/A passes can selectively target it.
    // - If data is FRESH, ensure the symbol is removed from the retry sets
    //   and recorded in retrySuccessSymbols so that retry PDR messages can
    //   surface an includeSymbols list of symbols that became fresh in
    //   this pass.
    if (runId && jobType !== TimeSeriesJobType.BACKFILL) {
      const runRef = db.doc(`${FirestoreCollection.REALTIME_RUNS}/${runId}`);
      try {
        const runSnap = await runRef.get();
        const runData = runSnap.data() as any | undefined;
        const currentRetry: string[] = Array.isArray(runData?.retrySymbols)
          ? runData.retrySymbols.map((s: any) => String(s).toUpperCase())
          : [];
        const symbolUpper = symbol.toUpperCase();
        const wasInRetry = currentRetry.includes(symbolUpper);

        if (dataFreshness === TimeSeriesDataFreshness.STALE) {
          await runRef.update({
            staleSymbols: FieldValue.arrayUnion(symbolUpper),
            retrySymbols: FieldValue.arrayUnion(symbolUpper),
          });
        } else if (dataFreshness === TimeSeriesDataFreshness.FRESH) {
          const updates: Record<string, unknown> = {
            staleSymbols: FieldValue.arrayRemove(symbolUpper),
            retrySymbols: FieldValue.arrayRemove(symbolUpper),
          };
          if (wasInRetry) {
            updates.retrySuccessSymbols = FieldValue.arrayUnion(symbolUpper);
          }
          await runRef.update(updates);
        }
      } catch {
        // Swallow errors here to avoid failing the job purely due to
        // retry list maintenance issues.
      }
    }

    // Emit a per-symbol, per-interval partner notification for every SUCCESS job so
    // consumers (e.g. RS) can react as soon as data for that symbol/interval is
    // available. Skip for backfill jobs (they're one-time operations).
    if (jobType !== TimeSeriesJobType.BACKFILL) {
      try {
        await publishSymbolsReadyBatch({
          version: 'v1',
          marketDate,
          symbols: [symbol],
          reason: 'scheduled',
          interval,
        });
        try {
          logger.info('ts.jobs.publish_symbol_ready', baseLogPayload);
        } catch {}
      } catch (e: any) {
        try {
          logger.error('ts.jobs.publish_symbol_ready_error', {
            ...baseLogPayload,
            function: 'pSJI',
          });
        } catch {}
      }
    }

    // Notify the appropriate aggregator that this job reached a terminal SUCCESS state.
    // Route based on jobType: backfill jobs update backfill-runs/{runId}, realtime jobs
    // update realtime-runs/{runId}.
    if (jobType === TimeSeriesJobType.BACKFILL) {
      await onBackfillJobTerminal({ runId: runId!, symbol, interval, status: TimeSeriesJobTerminalStatus.SUCCESS });
      logger.info('ts.jobs.backfill.success', { ...baseLogPayload, runId });
    } else {
      // New realtime pipeline: aggregate via realtime-runs/{runId} counters.
      await onRealtimeRunJobTerminal({
        runId,
        symbol,
        status: TimeSeriesJobTerminalStatus.SUCCESS,
      });
    }

    // Per-job pipeline log: worker completed successfully for this symbol
    try {
      logger.timeEnd('worker.symbol', baseLogPayload);
      logger.info('ts.jobs.worker.success', baseLogPayload);
      logger.end('ts.jobs.worker', baseLogPayload);
    } catch {}
  } catch (e: any) {
    const errMsg = String(e?.message || e);

    try {
      logger.timeEnd('worker.symbol', baseLogPayload);
      // Per-job pipeline log: worker error for this symbol
      logger.error('ts.jobs.worker.error', baseLogPayload);
      logger.end('ts.jobs.worker', baseLogPayload);
    } catch {}

    // Record the latest error on the job document for observability.
    await jobRef.set(
      {
        lastError: errMsg,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    // Determine how many attempts have been made so far. We bumped the
    // attempts counter at the start of this run, so the stored value
    // already reflects the latest attempt.
    const snapAfter = await jobRef.get();
    const dataAfter = snapAfter.data() as any;
    const attemptsAfter: number =
      dataAfter && typeof dataAfter.attempts === 'number' ? dataAfter.attempts : 0;

    const MAX_ATTEMPTS = MAX_JOB_ATTEMPTS;

    if (attemptsAfter >= MAX_ATTEMPTS) {
      // After MAX_ATTEMPTS, treat the job as a terminal permanent
      // failure so schedulers do not continue to re-enqueue it. Cloud
      // Tasks will see this invocation as successful (no throw) and
      // stop retrying.
      await jobRef.set(
        {
          status: TimeSeriesJobStatus.PermanentFailure,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );

      // Notify the appropriate aggregator that this job reached a terminal PERMANENT_FAILURE state.
      if (jobType === TimeSeriesJobType.BACKFILL) {
        await onBackfillJobTerminal({ runId: runId!, symbol, interval, status: TimeSeriesJobTerminalStatus.PERMANENT_FAILURE });
        logger.info('ts.jobs.backfill.permanent_failure', { ...baseLogPayload, runId });
      } else {
        await onRealtimeRunJobTerminal({
          runId,
          symbol,
          status: TimeSeriesJobTerminalStatus.PERMANENT_FAILURE,
        });
      }
      return;
    }

    // For sub-max attempts, surface the error to Cloud Tasks so that
    // the task is retried according to the queue's retryConfig
    // (backoff, maxAttempts). This keeps the time-series data from
    // going stale due to one-off timeouts. Mark the job as a
    // non-terminal transient failure so that UIs can distinguish it
    // from permanent failures while Cloud Tasks continues to retry.
    await jobRef.set(
      {
        status: TimeSeriesJobStatus.TransientFailure,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
    throw e;
  }
}
