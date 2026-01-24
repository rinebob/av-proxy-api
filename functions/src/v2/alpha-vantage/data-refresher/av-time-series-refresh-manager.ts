import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
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
import { TradingPhase } from '@shared/health-metrics';
import { TimeSeriesJobStatus } from '../jobs/time-series-jobs.model';
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
}): Promise<void> {
  const { marketDate, symbol, endpoint, phase, runId, intervalForEndpoint, endpointName } = params;

  const fnString = 'cOUTSJAMET'

  let shouldEnqueueTask = false;
  let createdNewJob = false;
  let updatedJob = false;

  try {
    const jobPath = getTimeSeriesJobDocPath(marketDate, symbol, endpoint, phase);
    const jobRef = db.doc(jobPath);
    const dateRef = db.doc(`${FirestoreCollection.TIME_SERIES_JOBS}/${marketDate}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      const dateSnap = await tx.get(dateRef);

      if (!snap.exists) {
        tx.set(jobRef, {
          symbol,
          endpoint,
          interval: intervalForEndpoint,
          phase,
          status: TimeSeriesJobStatus.Pending,
          attempts: 0,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });

        const existingDate = dateSnap.exists ? (dateSnap.data() as any) : {};
        const currentTotalJobs = typeof existingDate.totalJobs === 'number' ? existingDate.totalJobs : 0;
        const nextTotalJobs = currentTotalJobs + 1;
        const phaseStr = String(phase).toLowerCase();

        tx.set(
          dateRef,
          {
            marketDate,
            phase: existingDate.phase || phaseStr,
            totalJobs: nextTotalJobs,
            runId: existingDate.runId || runId || null,
          },
          { merge: true },
        );

        shouldEnqueueTask = true;
        createdNewJob = true;
        return;
      }

      const data = snap.data() as any;
      const status: TimeSeriesJobStatus | undefined = data?.status;

      if (status === TimeSeriesJobStatus.Success || status === TimeSeriesJobStatus.PermanentFailure) {
        return;
      }

      tx.set(
        jobRef,
        {
          symbol,
          endpoint,
          interval: intervalForEndpoint,
          phase,
          status: status ?? TimeSeriesJobStatus.Pending,
          attempts: typeof data?.attempts === 'number' ? data.attempts : 0,
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

    const tasksEnabled = String(process.env.TS_TIME_SERIES_TASKS_ENABLED || '').toLowerCase() === 'true';
    if (shouldEnqueueTask && tasksEnabled) {
      try {
        const queue = getFunctions().taskQueue(CloudTask.TIME_SERIES_JOB);
        await queue.enqueue({
          marketDate,
          symbol,
          endpoint,
          phase,
        });
        tsJobLogger.info('job.enqueue_success', {
          function: fnString,
          symbol,
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
          message: `Queued job for ${marketDate} ${intervalForEndpoint} ${symbol}`
        } as BetterLogPayload);
      } catch (e: any) {
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

  const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  let symbols = orderTrackedSymbols(symbolsSnap.docs.map((d) => d.id));

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

  const testSymbolRaw = String(process.env.TS_JOB_TEST_SYMBOL || '');
  const testSymbols = new Set(
    testSymbolRaw
      .split(',')
      .map((s) => s.toUpperCase().trim())
      .filter((s) => !!s),
  );

  const isPostTimeSeriesEndpoint =
    endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED ||
    endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED ||
    endpoint === AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED;
  const isTestSymbolMode = testSymbols.size > 0;
  const isFilteredMode = isTestSymbolMode && isPostTimeSeriesEndpoint && phaseFinal === TradingPhase.POST;

  if (isFilteredMode) {
    tsJobLogger.info('ts.jobs.test_symbol_mode', {
      function: fnString,
      marketDate,
      interval: intervalForEndpoint,
      endpoint: endpointName,
      message: `Filtered mode enabled. Running job for ${testSymbols.size} symbols`
    } as BetterLogPayload);
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

  for (const symbol of symbols) {
      
      const symbolUpper = symbol.toUpperCase();
    

    if (isFilteredMode && !testSymbols.has(symbolUpper)) {
        // console.log(`aVTSRM ${fnString} bypassing ${symbolUpper}`);
      continue;
    }

    tsJobLogger.startMaj('ts.jobs.processing', {
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

    try {
      tsJobLogger.endMaj('ts.jobs.processing', {
        function: fnString,
        symbol: symbolUpper,
        marketDate,
        interval: intervalForEndpoint,
        endpoint: endpointName,
        message: `END run for symbol ${symbolUpper}`
      } as BetterLogPayload);
    } catch {}
  }

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
