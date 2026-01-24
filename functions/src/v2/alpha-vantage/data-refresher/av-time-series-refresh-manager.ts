import { db } from '../../../firebase-admin-init';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import {
  TimeSeriesInterval,
  AlphaVantageEndpoint,
  DayOfWeek,
} from '@shared/alpha-vantage';
import { FirestoreCollection, RefreshTrigger } from '@shared/firestore';

import {
  TS_DAILY_PRE_CLOSE_SCHEDULE,
  TS_DAILY_POST_CLOSE_SCHEDULE,
  TS_POST_CLOSE_SCHEDULE,
  TS_DAILY_INTRADAY_HOURLY_SCHEDULE,
  TS_DAILY_POST_EVENING_RETRY_MINUTE_30,
  TS_DAILY_POST_EVENING_RETRY_MINUTE_00,
  TS_DAILY_POST_MORNING_CATCHUP_0630,
  TS_DAILY_POST_MORNING_CATCHUP_0700,
} from '../../common/function-schedules';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { getTimeSeriesJobDocPath } from '../../common/firestore/firestore-paths';
import { TIME_SERIES_BASELINE_ETFS, TIME_SERIES_MASTER_SYMBOL_ORDER } from '../data/ts-master-order';
import { TS_SCHEDULER_BATCH_SIZE, TS_FULLBACKFILL_BATCH_SIZE } from '../jobs/ts-job-batch-config';
import { TradingPhase } from '@shared/health-metrics';
import { TimeSeriesJobStatus, TimeSeriesJobMode } from '../jobs/time-series-jobs.model';
import { CloudTask } from '../../common/constants';

const tsJobLogger = betterLogger('aVTSRM');

export function orderTrackedSymbols(allTracked: string[]): string[] {
  const baselines = TIME_SERIES_BASELINE_ETFS;
  const master = TIME_SERIES_MASTER_SYMBOL_ORDER;
  const baselineSet = new Set(baselines);
  const inMaster = new Set(master);

  const ordered: string[] = [];

  for (const b of baselines) {
    if (allTracked.includes(b)) {
      ordered.push(b);
    }
  }

  for (const sym of master) {
    if (allTracked.includes(sym) && !baselineSet.has(sym)) {
      ordered.push(sym);
    }
  }

  const remaining = allTracked
    .filter((s) => !baselineSet.has(s) && !inMaster.has(s))
    .sort();
  ordered.push(...remaining);

  return ordered;
}

async function createOrUpdateTimeSeriesJobAndMaybeEnqueueTask(params: {
  marketDate: string;
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  phase: TradingPhase;
  runId: string;
  intervalForEndpoint: TimeSeriesInterval;
  endpointName: string;
  mode?: TimeSeriesJobMode;
}): Promise<void> {
  const { marketDate, symbol, endpoint, phase, runId, intervalForEndpoint, endpointName, mode } = params;

  const fnString = 'cOUTSJAMET'

  let shouldEnqueueTask = false;
  let createdNewJob = false;
  let updatedJob = false;

  try {
    const jobPath = getTimeSeriesJobDocPath(marketDate, symbol, endpoint, phase);
    const jobRef = db.doc(jobPath);
    const dateRef = db.doc(`${FirestoreCollection.TIME_SERIES_JOBS}/${marketDate}`);

    tsJobLogger.timeStart('job.tx', {
      function: fnString,
      symbol,
      marketDate,
      interval: intervalForEndpoint,
      endpoint: endpointName,
    } as BetterLogPayload);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      const dateSnap = await tx.get(dateRef);

      const isFullBackfill = mode === TimeSeriesJobMode.FullBackfill;

      if (!snap.exists) {
        // Fresh job doc for this symbol/endpoint/phase.
        // For both realtime and full-backfill, initialize as Pending with 0 attempts.
        tx.set(jobRef, {
          symbol,
          endpoint,
          interval: intervalForEndpoint,
          phase,
          status: TimeSeriesJobStatus.Pending,
          attempts: 0,
          mode,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });

        const existingDate = dateSnap.exists ? (dateSnap.data() as any) : {};
        const phaseStr = String(phase).toLowerCase();

        tx.set(
          dateRef,
          {
            marketDate,
            phase: existingDate.phase || phaseStr,
            runId: existingDate.runId || runId || null,
            // High-level run status for this marketDate. When any job is created,
            // mark the date doc as IN_PROGRESS; the aggregator will later flip
            // this to COMPLETE when all jobs finish.
            status: existingDate.status || 'IN_PROGRESS',
          },
          { merge: true },
        );

        shouldEnqueueTask = true;
        createdNewJob = true;
        return;
      }

      const data = snap.data() as any;
      const status: TimeSeriesJobStatus | undefined = data?.status;

      if (!isFullBackfill && (status === TimeSeriesJobStatus.Success || status === TimeSeriesJobStatus.PermanentFailure)) {
        // Realtime / non-full-backfill runs skip already completed jobs to avoid
        // re-hitting AV for symbols that are known-good for this marketDate.
        return;
      }

      // For full-backfill, we always reset the job to a fresh Pending state so that
      // the worker will reprocess the symbol from scratch, regardless of any
      // prior success. For realtime runs, we preserve existing status/attempts
      // for in-flight jobs that are not yet terminal.
      tx.set(
        jobRef,
        {
          symbol,
          endpoint,
          interval: intervalForEndpoint,
          phase,
          status: isFullBackfill ? TimeSeriesJobStatus.Pending : status ?? TimeSeriesJobStatus.Pending,
          attempts: isFullBackfill
            ? 0
            : typeof data?.attempts === 'number'
              ? data.attempts
              : 0,
          mode: mode ?? data?.mode,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
      shouldEnqueueTask = true;
      updatedJob = true;

      tsJobLogger.info('job.doc_write', {
          function: fnString,
          symbol,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
          message: `Wrote job doc for ${marketDate} ${intervalForEndpoint} ${symbol}`
        } as BetterLogPayload);
    });

    tsJobLogger.timeEnd('job.tx', {
      function: fnString,
      symbol,
      marketDate,
      interval: intervalForEndpoint,
      endpoint: endpointName,
    } as BetterLogPayload);

    // For newly created jobs, bump the aggregate totalJobs counter outside of the
    // per-job transaction using an atomic increment. This reduces read/modify
    // contention on the date doc while preserving correct totals over time.
    if (createdNewJob) {
      try {
        await dateRef.set(
          {
            totalJobs: FieldValue.increment(1),
          },
          { merge: true },
        );
      } catch (e: any) {
        // Treat failure to bump totalJobs as a hard error so that run-level
        // completeness checks based on this aggregate are not silently skewed.
        tsJobLogger.error('ts.jobs.totalJobs_increment_failed', {
          function: fnString,
          symbol,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
          error: String(e?.message || e),
        } as BetterLogPayload);
        throw e;
      }
    }

    const tasksEnabled = String(process.env.TS_TIME_SERIES_TASKS_ENABLED || '').toLowerCase() === 'true';
    if (shouldEnqueueTask && tasksEnabled) {
      tsJobLogger.timeStart('job.enqueue', {
        function: fnString,
        symbol,
        marketDate,
        interval: intervalForEndpoint,
        endpoint: endpointName,
      } as BetterLogPayload);
      try {
        const queue = getFunctions().taskQueue(CloudTask.TIME_SERIES_JOB);
        await queue.enqueue({
          marketDate,
          symbol,
          endpoint,
          phase,
        });
        tsJobLogger.timeEnd('job.enqueue', {
          function: fnString,
          symbol,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);
        tsJobLogger.info('job.enqueue_success', {
          function: fnString,
          symbol,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
          message: `Queued job for ${marketDate} ${intervalForEndpoint} ${symbol}`
        } as BetterLogPayload);
      } catch (e: any) {
        tsJobLogger.timeEnd('job.enqueue', {
          function: fnString,
          symbol,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);
        tsJobLogger.warn('job.enqueue_failed', {
          function: fnString,
          symbol,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
          error: String(e?.message || e),
          message: `Queue job FAILED for ${marketDate} ${intervalForEndpoint} ${symbol}`
        } as BetterLogPayload);
      }
    }

    if (shouldEnqueueTask) {
      if (createdNewJob) {
        tsJobLogger.info('ts.jobs.write_new', {
          function: fnString,
          symbol,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);
      } else if (updatedJob) {
        tsJobLogger.info('ts.jobs.write_update', {
          function: fnString,
          symbol,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);
      }
    }
  } catch (e: any) {
    tsJobLogger.warn('job.shadow_create_failed', {
      function: fnString,
      symbol,
      marketDate,
      interval: intervalForEndpoint,
      endpoint: endpointName,
      error: String(e?.message || e),
    } as BetterLogPayload);
  }
}

export async function runTimeSeriesJobsForEndpoint(options: {
  endpoint: AlphaVantageEndpoint;
  phase: TradingPhase;
  trigger: RefreshTrigger;
  marketDate?: string;
  symbols?: string[];
}): Promise<void> {
  const { endpoint, phase, trigger, marketDate: marketDateOverride, symbols: symbolsOverride } = options;

  const fnString = 'rTSJFE';

  const phaseFinal: TradingPhase = phase ?? TradingPhase.POST;
  if (phaseFinal !== TradingPhase.POST) {
    tsJobLogger.info('ts.jobs.runner_skip_phase', {
      function: fnString,
      marketDate: marketDateOverride ?? 'auto',
      endpoint: AlphaVantageEndpoint[endpoint],
      message: 'Skipping non-POST phase',
    } as BetterLogPayload);
    return;
  }

  const tz = 'America/New_York';
  const now = new Date();
  let marketDate = '';
  if (typeof marketDateOverride === 'string' && /\d{4}-\d{2}-\d{2}/.test(marketDateOverride)) {
    marketDate = marketDateOverride;
  } else {
    const fmtDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    marketDate = fmtDate.format(now);
  }

  const dowIdx = Number(new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay());
  const DOW_ENUM: DayOfWeek[] = [
    DayOfWeek.Sun,
    DayOfWeek.Mon,
    DayOfWeek.Tue,
    DayOfWeek.Wed,
    DayOfWeek.Thu,
    DayOfWeek.Fri,
    DayOfWeek.Sat,
  ];
  const dowEnum: DayOfWeek = DOW_ENUM[dowIdx];
  const dowStr = String(dowEnum).toUpperCase();
  const phaseStrUpper = String(phaseFinal).toUpperCase();

  const endpointName = AlphaVantageEndpoint[endpoint];
  const intervalForEndpoint: TimeSeriesInterval =
    endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED
      ? TimeSeriesInterval.DAILY
      : endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED
        ? TimeSeriesInterval.WEEKLY
        : TimeSeriesInterval.MONTHLY;

  const isJobPipelineEnabled = String(process.env.TS_JOB_PIPELINE_ENABLED_DAILY_POST || '').toLowerCase() === 'true';
  if (!isJobPipelineEnabled) {
    tsJobLogger.info('ts.jobs.pipeline_disabled', {
      function: fnString,
      symbol: 'MULTI',
      marketDate,
      interval: intervalForEndpoint,
      endpoint: endpointName,
      message: 'Jobs pipeline DISABLED. Terminating process'
    } as BetterLogPayload);
    return;
  }

  const isManualRun = trigger === RefreshTrigger.MANUAL || process.env.FUNCTIONS_EMULATOR === 'true';
  const liveManualSuffix = isManualRun ? 'MANUAL' : 'LIVE';
  const runId = `${marketDate}-${dowStr}-${phaseStrUpper}-${endpoint}-${liveManualSuffix}`;

  let symbols: string[];
  if (Array.isArray(symbolsOverride) && symbolsOverride.length > 0) {
    symbols = orderTrackedSymbols(symbolsOverride.map((s) => s.toUpperCase()));
  } else {
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    symbols = orderTrackedSymbols(symbolsSnap.docs.map((d) => d.id));

    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    if (isEmulator) {
      const baselinesInTracked = TIME_SERIES_BASELINE_ETFS.filter((s) => symbols.includes(s));
      const rawExtra = process.env.TS_JOB_EMULATOR_SYMBOLS;
      const extraTargets: string[] = [];
      if (rawExtra && rawExtra.length > 0) {
        for (const token of rawExtra.split(',')) {
          const sym = token.trim().toUpperCase();
          if (!sym) continue;
          if (baselinesInTracked.includes(sym)) continue;
          if (!extraTargets.includes(sym)) extraTargets.push(sym);
        }
      }
      symbols = [...baselinesInTracked, ...extraTargets];
    }
  }

  const createdSymbolsThisEndpoint = new Set<string>();

  console.log('==========================================================');
  tsJobLogger.startMaj('ts.jobs.scheduler', {
    function: fnString,
    marketDate,
    interval: intervalForEndpoint,
    endpoint: endpointName,
    message: 'BEGIN Symbol Loop '
  } as BetterLogPayload);

  tsJobLogger.timeStart('scheduler.endpoint', {
    function: fnString,
    marketDate,
    interval: intervalForEndpoint,
    endpoint: endpointName,
  } as BetterLogPayload);

  // Batch scheduler-driven job creation to improve throughput while keeping
  // Firestore load and Cloud Tasks enqueue behavior predictable.
  for (let i = 0; i < symbols.length; i += TS_SCHEDULER_BATCH_SIZE) {
    const chunk = symbols.slice(i, i + TS_SCHEDULER_BATCH_SIZE);

    await Promise.all(
      chunk.map(async (symbol) => {
        const symbolUpper = symbol.toUpperCase();

        tsJobLogger.startMaj('ts.jobs.processing', {
          function: fnString,
          symbol: symbolUpper,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);

        tsJobLogger.timeStart('scheduler.symbol', {
          function: fnString,
          symbol: symbolUpper,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);

        await createOrUpdateTimeSeriesJobAndMaybeEnqueueTask({
          marketDate,
          symbol: symbolUpper,
          endpoint,
          phase: phaseFinal,
          runId,
          intervalForEndpoint,
          endpointName,
        });

        createdSymbolsThisEndpoint.add(symbolUpper);

        tsJobLogger.timeEnd('scheduler.symbol', {
          function: fnString,
          symbol: symbolUpper,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);

        try {
          tsJobLogger.endMaj('ts.jobs.processing', {
            function: fnString,
            symbol: symbolUpper,
            marketDate,
            interval: intervalForEndpoint,
            endpoint: endpointName,
            message: `END run for symbol ${symbolUpper}`,
          } as BetterLogPayload);
        } catch {}
      }),
    );
  }

  tsJobLogger.timeEnd('scheduler.endpoint', {
    function: fnString,
    marketDate,
    interval: intervalForEndpoint,
    endpoint: endpointName,
  } as BetterLogPayload);

  tsJobLogger.endMaj('ts.jobs.scheduler', {
      function: fnString,
      marketDate,
      interval: intervalForEndpoint,
      endpoint: endpointName,
      message: 'END Symbol Loop '
    } as BetterLogPayload);
  console.log('==========================================================');
  
  console.log('==========================================================');
  tsJobLogger.startMaj('ts.jobs.run_summary', {
    function: fnString,
    marketDate,
    interval: intervalForEndpoint,
    endpoint: endpointName,
    message: `Created ${createdSymbolsThisEndpoint.size} symbols for ${endpointName}`
  } as BetterLogPayload);
  tsJobLogger.endMaj('ts.jobs.run_summary', {})
  console.log('==========================================================');
}

/**
 * Enqueue FULL_BACKFILL jobs for a given endpoint and symbol set.
 * This reuses the same marketDate/runId/ordering logic as the standard
 * scheduler but stamps jobs with TimeSeriesJobMode.FullBackfill so that
 * the worker performs a destructive full-history rebuild for each
 * symbol+endpoint.
 */
export async function enqueueFullBackfillJobsForEndpoint(options: {
  endpoint: AlphaVantageEndpoint;
  marketDate?: string;
  symbols?: string[];
}): Promise<{ marketDate: string; runId: string; symbolCount: number; interval: TimeSeriesInterval; }> {
  const { endpoint, marketDate: marketDateOverride, symbols: symbolsOverride } = options;

  const fnString = 'eFBJFE';

  const tz = 'America/New_York';
  const now = new Date();
  let marketDate = '';
  if (typeof marketDateOverride === 'string' && /\d{4}-\d{2}-\d{2}/.test(marketDateOverride)) {
    marketDate = marketDateOverride;
  } else {
    const fmtDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    marketDate = fmtDate.format(now);
  }

  const dowIdx = Number(new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay());
  const DOW_ENUM: DayOfWeek[] = [
    DayOfWeek.Sun,
    DayOfWeek.Mon,
    DayOfWeek.Tue,
    DayOfWeek.Wed,
    DayOfWeek.Thu,
    DayOfWeek.Fri,
    DayOfWeek.Sat,
  ];
  const dowEnum: DayOfWeek = DOW_ENUM[dowIdx];
  const dowStr = String(dowEnum).toUpperCase();

  const endpointName = AlphaVantageEndpoint[endpoint];
  const intervalForEndpoint: TimeSeriesInterval =
    endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED
      ? TimeSeriesInterval.DAILY
      : endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED
        ? TimeSeriesInterval.WEEKLY
        : TimeSeriesInterval.MONTHLY;

  const runId = `${marketDate}-${dowStr}-POST-${endpoint}-FULL_BACKFILL`;

  let symbols: string[];
  if (Array.isArray(symbolsOverride) && symbolsOverride.length > 0) {
    symbols = orderTrackedSymbols(symbolsOverride.map((s) => s.toUpperCase()));
  } else {
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    symbols = orderTrackedSymbols(symbolsSnap.docs.map((d) => d.id));
  }

  const createdSymbolsThisEndpoint = new Set<string>();

  // Batch full-backfill job creation separately from the normal scheduler so
  // that heavy, operator-driven runs can be tuned independently if needed.
  tsJobLogger.timeStart('fullbackfill.endpoint', {
    function: fnString,
    marketDate,
    interval: intervalForEndpoint,
    endpoint: endpointName,
  } as BetterLogPayload);

  for (let i = 0; i < symbols.length; i += TS_FULLBACKFILL_BATCH_SIZE) {
    const chunk = symbols.slice(i, i + TS_FULLBACKFILL_BATCH_SIZE);

    await Promise.all(
      chunk.map(async (symbol) => {
        const symbolUpper = symbol.toUpperCase();

        tsJobLogger.startMaj('ts.jobs.full_backfill.enqueue', {
          function: fnString,
          symbol: symbolUpper,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);

        tsJobLogger.timeStart('fullbackfill.symbol', {
          function: fnString,
          symbol: symbolUpper,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);

        await createOrUpdateTimeSeriesJobAndMaybeEnqueueTask({
          marketDate,
          symbol: symbolUpper,
          endpoint,
          phase: TradingPhase.POST,
          runId,
          intervalForEndpoint,
          endpointName,
          mode: TimeSeriesJobMode.FullBackfill,
        });

        createdSymbolsThisEndpoint.add(symbolUpper);

        tsJobLogger.timeEnd('fullbackfill.symbol', {
          function: fnString,
          symbol: symbolUpper,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);

        try {
          tsJobLogger.endMaj('ts.jobs.full_backfill.enqueue', {
            function: fnString,
            symbol: symbolUpper,
            marketDate,
            interval: intervalForEndpoint,
            endpoint: endpointName,
            message: `ENQUEUED full-backfill job for symbol ${symbolUpper}`,
          } as BetterLogPayload);
        } catch {}
      }),
    );
  }

  tsJobLogger.timeEnd('fullbackfill.endpoint', {
    function: fnString,
    marketDate,
    interval: intervalForEndpoint,
    endpoint: endpointName,
  } as BetterLogPayload);

  // Record lightweight run metadata for this endpoint-specific full-backfill
  // run. This gives us a clear expectedJobs count that is independent of how
  // many job docs were "new" for this marketDate.
  const runDocRef = db.doc(`${FirestoreCollection.BACKFILL_RUNS}/${runId}`);
  await runDocRef.set(
    {
      runId,
      type: 'full_backfill',
      marketDate,
      endpoint: endpointName,
      interval: intervalForEndpoint,
      symbolCount: createdSymbolsThisEndpoint.size,
      expectedJobs: createdSymbolsThisEndpoint.size,
      status: 'IN_PROGRESS',
      runStartedAt: Timestamp.now(),
    },
    { merge: true },
  );

  return {
    marketDate,
    runId,
    symbolCount: createdSymbolsThisEndpoint.size,
    interval: intervalForEndpoint,
  };
}

/**
 * runAllTimeSeriesIntervalsPost
 *
 * Convenience orchestrator that runs the time-series job pipeline for
 * DAILY, WEEKLY, and MONTHLY adjusted endpoints in a single invocation
 * for a given marketDate and POST phase. This is the primary entry
 * point for the all-intervals POST run that ultimately drives the
 * ts-post-all-intervals partner-data-ready message.
 */
export async function runAllTimeSeriesIntervalsPost(options: {
  trigger: RefreshTrigger;
  marketDate?: string;
  symbols?: string[];
}): Promise<void> {
  const { trigger, marketDate, symbols } = options;

  // DAILY
  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    phase: TradingPhase.POST,
    trigger,
    marketDate,
    symbols,
  });

  // WEEKLY
  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
    phase: TradingPhase.POST,
    trigger,
    marketDate,
    symbols,
  });

  // MONTHLY
  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
    phase: TradingPhase.POST,
    trigger,
    marketDate,
    symbols,
  });
}

// =============================
// Time-series schedulers (TS)
// =============================

// Daily time series: intraday hourly PRE (daily only)
export const refreshAvDailyTimeSeriesIntradayHourly = onSchedule({
  schedule: TS_DAILY_INTRADAY_HOURLY_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  // Wire through the TS job pipeline; the runner will handle phase gating.
  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    phase: TradingPhase.PRE,
    trigger: RefreshTrigger.SCHEDULER,
  });
});

// Daily time series: pre-close (daily only)
export const refreshAvDailyTimeSeriesPreClose = onSchedule({
  schedule: TS_DAILY_PRE_CLOSE_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  // Use the TS job pipeline even for PRE scheduler; the runner will
  // safely no-op for non-POST phases while keeping behavior consistent
  // with the new architecture.
  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    phase: TradingPhase.PRE,
    trigger: RefreshTrigger.SCHEDULER,
  });
});

// Daily time series: post-close (legacy daily-only entrypoint)
//
// In the new design, the all-intervals POST run is driven by
// refreshAvTimeSeriesPostAllIntervals, which calls
// runAllTimeSeriesIntervalsPost. To avoid double runs and keep the
// contract clear, this legacy daily-only scheduler is now a no-op
// that logs when invoked.
export const refreshAvDailyTimeSeriesPostClose = onSchedule({
  schedule: TS_DAILY_POST_CLOSE_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  tsJobLogger.info('ts.jobs.daily_post_legacy_noop', {
    function: 'rTSDPC',
    marketDate: 'auto',
    endpoint: AlphaVantageEndpoint[AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED],
    message: 'Legacy DAILY_POST scheduler no-op; all-intervals POST handled by refreshAvTimeSeriesPostAllIntervals',
  } as BetterLogPayload);
});

// All-intervals time series: post-close orchestrator (DAILY/WEEKLY/MONTHLY)
export const refreshAvTimeSeriesPostAllIntervals = onSchedule({
  schedule: TS_DAILY_POST_CLOSE_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await runAllTimeSeriesIntervalsPost({
    trigger: RefreshTrigger.SCHEDULER,
  });
});

// Weekly time series: post-close every trading day
export const refreshAvWeeklyTimeSeriesPostClose = onSchedule({
  schedule: TS_POST_CLOSE_SCHEDULE,
  timeZone: 'America/New_York',
  timeoutSeconds: 600,
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  // All-intervals POST is now driven by refreshAvDailyTimeSeriesPostClose
  // via runAllTimeSeriesIntervalsPost. To avoid duplicate runs, this
  // scheduler is left as a no-op (logging only) in the new pipeline.
  tsJobLogger.info('ts.jobs.weekly_post_noop', {
    function: 'rTSWPC',
    marketDate: 'auto',
    endpoint: AlphaVantageEndpoint[AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED],
    message: 'Weekly POST scheduler no-op; all-intervals POST is handled by DAILY orchestrator',
  } as BetterLogPayload);
});

// Monthly time series: post-close every trading day
export const refreshAvMonthlyTimeSeriesPostClose = onSchedule({
  schedule: TS_POST_CLOSE_SCHEDULE,
  timeZone: 'America/New_York',
  timeoutSeconds: 600,
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  // All-intervals POST is now driven by refreshAvDailyTimeSeriesPostClose
  // via runAllTimeSeriesIntervalsPost. To avoid duplicate runs, this
  // scheduler is left as a no-op (logging only) in the new pipeline.
  tsJobLogger.info('ts.jobs.monthly_post_noop', {
    function: 'rTSMPC',
    marketDate: 'auto',
    endpoint: AlphaVantageEndpoint[AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED],
    message: 'Monthly POST scheduler no-op; all-intervals POST is handled by DAILY orchestrator',
  } as BetterLogPayload);
});

// Daily time series: post-close evening retries (every 30 mins)
export const refreshAvDailyTimeSeriesPostEveningRetry30 = onSchedule({
  schedule: TS_DAILY_POST_EVENING_RETRY_MINUTE_30,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    phase: TradingPhase.POST,
    trigger: RefreshTrigger.SCHEDULER,
  });
});

export const refreshAvDailyTimeSeriesPostEveningRetry00 = onSchedule({
  schedule: TS_DAILY_POST_EVENING_RETRY_MINUTE_00,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    phase: TradingPhase.POST,
    trigger: RefreshTrigger.SCHEDULER,
  });
});

// Daily time series: next-morning catch-ups
export const refreshAvDailyTimeSeriesPostMorning0630 = onSchedule({
  schedule: TS_DAILY_POST_MORNING_CATCHUP_0630,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    phase: TradingPhase.POST,
    trigger: RefreshTrigger.SCHEDULER,
  });
});

export const refreshAvDailyTimeSeriesPostMorning0700 = onSchedule({
  schedule: TS_DAILY_POST_MORNING_CATCHUP_0700,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    phase: TradingPhase.POST,
    trigger: RefreshTrigger.SCHEDULER,
  });
});
