import { db } from '../../../firebase-admin-init';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, OutputSize, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { TradingPhase } from '@shared/health-metrics';

import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import {
  getTimeSeriesJobDocPath,
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
} from '../../common/firestore/firestore-paths';
import { TimeSeriesJobStatus } from './time-series-jobs.model';
import { onTimeSeriesJobTerminal } from './time-series-jobs.aggregator';
import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { publishSymbolsReadyBatch } from '../../partner/symbols-ready.publisher';
import {
  deleteDailyAdjustedForSymbol,
  deleteWeeklyAdjustedForSymbol,
  deleteMonthlyAdjustedForSymbol,
} from '../firestore/av-backfill-delete-helpers';

/**
 * Indicates whether the time-series for a given job has reached the
 * expected period-end bar (e.g. day/week/month) or is still in-progress.
 */
export enum PeriodStatus {
  InProgress = 'IN_PROGRESS',
  PeriodEnd = 'PERIOD_END',
}

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
}

/**
 * Core worker implementation for a single Alpha Vantage time-series job.
 *
 * NOTE: This function is not yet wired to a Cloud Function export. It is
 * intended to be called by a future HTTPS/Tasks wrapper once the job
 * pipeline is ready to be enabled in non-production environments.
 */

export async function processTimeSeriesJobInternal(payload: ProcessTimeSeriesJobPayload): Promise<void> {
  // Temporary diagnostic: introduce a fixed delay so that individual
  // task executions are clearly visible in the Cloud Tasks UI and logs.
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  // SAFETY BELT: While the job pipeline is under active development,
  // gate execution behind an explicit feature flag in non-emulator
  // environments. This prevents accidental prod activation until
  // TS_TIME_SERIES_TASKS_ENABLED is deliberately set.
  const tasksEnabled = String(process.env.TS_TIME_SERIES_TASKS_ENABLED || '').toLowerCase() === 'true';
  if (!tasksEnabled && process.env.FUNCTIONS_EMULATOR !== 'true') {
    return;
  }

  const { marketDate, symbol, endpoint, phase } = payload;

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

  const jobPath = getTimeSeriesJobDocPath(marketDate, symbol, endpoint, phase);
  const jobRef = db.doc(jobPath);

  // Load and gate on current status.
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    // No job to process; idempotent no-op.
    return;
  }

  const jobData = jobSnap.data() as any;
  const status: TimeSeriesJobStatus | undefined = jobData?.status;

  if (status === TimeSeriesJobStatus.Success || status === TimeSeriesJobStatus.PermanentFailure) {
    // Terminal states: nothing to do.
    return;
  }

  try {
    logger.timeStart('worker.symbol', baseLogPayload);
  } catch {}

  // Mark IN_PROGRESS and bump attempts transactionally.
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
    tx.set(jobRef, {
      status: TimeSeriesJobStatus.InProgress,
      attempts: attempts + 1,
      lastAttemptAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });

  const targetTs = new Date(`${marketDate}T00:00:00.000Z`).getTime();

  try {
    const handler = AlphaVantageHandlerFactory.createHandler(endpoint);

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
      outputsize: OutputSize.COMPACT,
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
    const periodStatus = isPeriodEnd ? PeriodStatus.PeriodEnd : PeriodStatus.InProgress;

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
    }, { merge: true });

    // Optional verbose partner mode: emit a single-symbol partner notification for
    // every SUCCESS job (per symbol+interval) so cross-project message flow can
    // be validated without altering production batching semantics.
    const verboseFlag = String(process.env.TS_PARTNER_VERBOSE_MESSAGES || '').toLowerCase();
    const verboseMode = verboseFlag === 'true' || verboseFlag === 'on';
    if (verboseMode) {
      try {
        await publishSymbolsReadyBatch(
          {
            version: 'v1',
            marketDate,
            symbols: [symbol],
            reason: 'verbose',
            interval,
          },
          { verbose: 'true' },
        );
        try {
          logger.info(
            `symbol=${symbol} event=ts.jobs.publish_verbose interval=${interval} marketDate=${marketDate}`,
            {
              symbol,
              endpoint,
              interval,
              marketDate,
              verbose: true,
            },
          );
        } catch {}
      } catch (e: any) {
        try {
          logger.error(
            `symbol=${symbol} event=ts.jobs.publish_verbose_error interval=${interval} marketDate=${marketDate}`,
            {
              symbol,
              endpoint,
              interval,
              marketDate,
              verbose: true,
              error: String(e?.message || e),
            },
          );
        } catch {}
      }
    }

    // Notify the date-level aggregator that this job reached a terminal SUCCESS state.
    await onTimeSeriesJobTerminal({
      marketDate,
      symbol,
      interval,
      status: 'SUCCESS',
    });

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

    const MAX_ATTEMPTS = 5;

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

      // Notify the date-level aggregator that this job reached a terminal PERMANENT_FAILURE state.
      await onTimeSeriesJobTerminal({
        marketDate,
        symbol,
        interval,
        status: 'PERMANENT_FAILURE',
      });
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
