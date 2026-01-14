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
import { publishSymbolsReadyBatch } from '../../partner/symbols-ready.publisher';
import { TIME_SERIES_BASELINE_ETFS } from '../data/ts-master-order';
import { createLogger } from '../../utils/utils';

/**
 * Indicates whether the time-series for a given job has reached the
 * expected period-end bar (e.g. day/week/month) or is still in-progress.
 */
export enum PeriodStatus {
  InProgress = 'IN_PROGRESS',
  PeriodEnd = 'PERIOD_END',
}

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
const BASELINE_SET = new Set(TIME_SERIES_BASELINE_ETFS);
const BASELINE_TARGET_COUNT = TIME_SERIES_BASELINE_ETFS.length;
const SYMBOL_BATCH_SIZE = 10;
let firstBaselineBatchSent = false;
let pendingSymbolsBatch: string[] = [];
let readyBaselineSymbols = new Set<string>();

// Dedicated logger for the time-series job worker so pipeline logs are easy to filter
const logger = createLogger('av.ts.jobs.worker');

async function handleNewlyReadySymbols(marketDate: string, newlyReadySymbols: string[]): Promise<void> {
  if (!newlyReadySymbols.length) {
    return;
  }

  // Per-symbol pipeline log: symbol has just transitioned to newly ready for this marketDate
  for (const s of newlyReadySymbols) {
    try {
      logger.info(`ts.jobs.symbol_newly_ready symbol=${s} marketDate=${marketDate}`, {
        symbol: s,
        marketDate,
      });
    } catch {}
  }

  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

  // Split baselines vs non-baselines for this invocation.
  const baselines = newlyReadySymbols.filter((s) => BASELINE_SET.has(s));
  const others = newlyReadySymbols.filter((s) => !BASELINE_SET.has(s));

  // Always accumulate non-baseline symbols into the general pending batch.
  if (others.length) {
    pendingSymbolsBatch.push(...others);
  }

  if (!firstBaselineBatchSent && baselines.length) {
    // Track which baselines have become ready so far.
    for (const s of baselines) {
      readyBaselineSymbols.add(s);
    }

    // Only when all baselines are ready do we emit the first baseline-only batch.
    // In the emulator, relax this guard so we emit a baseline batch as soon
    // as the baselines participating in this run are ready. This allows
    // symbol-ready testing with a small subset of symbols without requiring
    // all 13 global baselines to be present.
    if (readyBaselineSymbols.size === BASELINE_TARGET_COUNT || isEmulator) {
      const baselineBatch = TIME_SERIES_BASELINE_ETFS.filter((s) => readyBaselineSymbols.has(s));
      if (baselineBatch.length) {
        await publishSymbolsReadyBatch({
          version: 'v1',
          marketDate,
          symbols: baselineBatch,
          reason: 'scheduled',
        });
        try {
          logger.info(
            `ts.jobs.publish_baseline_batch marketDate=${marketDate} symbols=[${baselineBatch.join(',')}]`,
            {
              marketDate,
              symbols: baselineBatch,
              batchType: 'baseline',
            },
          );
        } catch {}
      }
      firstBaselineBatchSent = true;
      // After emitting the baseline batch we no longer need to track this set.
      readyBaselineSymbols = new Set<string>();
    }
  }

  // After the baseline batch has been sent, apply the normal 10-symbol batching
  // policy for all subsequent (non-baseline) symbols.
  if (firstBaselineBatchSent && pendingSymbolsBatch.length >= SYMBOL_BATCH_SIZE) {
    const toSend = pendingSymbolsBatch.splice(0);
    await publishSymbolsReadyBatch({
      version: 'v1',
      marketDate,
      symbols: toSend,
      reason: 'scheduled',
    });
    try {
      logger.info(
        `ts.jobs.publish_batch marketDate=${marketDate} symbols=[${toSend.join(',')}]`,
        {
          marketDate,
          symbols: toSend,
          batchType: 'normal',
        },
      );
    } catch {}
  }
}

async function flushPendingSymbols(marketDate: string): Promise<void> {
  if (!pendingSymbolsBatch.length) {
    return;
  }
  const toSend = pendingSymbolsBatch.splice(0);
  await publishSymbolsReadyBatch({
    version: 'v1',
    marketDate,
    symbols: toSend,
    reason: 'scheduled',
  });
  try {
    logger.info(
      `ts.jobs.publish_flush marketDate=${marketDate} symbols=[${toSend.join(',')}]`,
      {
        marketDate,
        symbols: toSend,
        batchType: 'flush',
      },
    );
  } catch {}
}

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

  // Per-job pipeline log: worker invocation start for this symbol/endpoint/phase
  try {
    logger.info(
      `ts.jobs.worker.start symbol=${symbol} endpoint=${endpoint} phase=${phase} marketDate=${marketDate}`,
      {
        symbol,
        endpoint,
        phase,
        marketDate,
      },
    );
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
  const interval: TimeSeriesInterval =
    endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED
      ? TimeSeriesInterval.DAILY
      : endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED
        ? TimeSeriesInterval.WEEKLY
        : TimeSeriesInterval.MONTHLY;

  try {
    const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
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
    const { newlyReadySymbols, runJustCompleted } = await onTimeSeriesJobTerminal({
      marketDate,
      symbol,
      interval,
      status: 'SUCCESS',
    });

    await handleNewlyReadySymbols(marketDate, newlyReadySymbols);

    if (runJustCompleted) {
      await flushPendingSymbols(marketDate);
    }

    // Per-job pipeline log: worker completed successfully for this symbol
    try {
      logger.info(
        `ts.jobs.worker.success symbol=${symbol} endpoint=${endpoint} phase=${phase} marketDate=${marketDate}`,
        {
          symbol,
          endpoint,
          phase,
          marketDate,
          periodStatus,
        },
      );
    } catch {}
  } catch (e: any) {
    const errMsg = String(e?.message || e);

    // Per-job pipeline log: worker error for this symbol
    try {
      logger.error(
        `ts.jobs.worker.error symbol=${symbol} endpoint=${endpoint} phase=${phase} marketDate=${marketDate}`,
        {
          symbol,
          endpoint,
          phase,
          marketDate,
          error: errMsg,
        },
      );
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
      const { newlyReadySymbols, runJustCompleted } = await onTimeSeriesJobTerminal({
        marketDate,
        symbol,
        interval,
        status: 'PERMANENT_FAILURE',
      });

      // Safety: in principle PERMANENT_FAILURE should not produce ready symbols,
      // but handle any returned symbols for completeness.
      await handleNewlyReadySymbols(marketDate, newlyReadySymbols);

      if (runJustCompleted) {
        await flushPendingSymbols(marketDate);
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
