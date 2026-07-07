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
import { TradingPhase } from '@shared/health-metrics';
import { TimeSeriesJobType } from '../jobs/time-series-jobs.model';

import {
  TS_DAILY_POST_CLOSE_SCHEDULE,
  TS_POST_CLOSE_SCHEDULE,
  TS_DAILY_INTRADAY_HOURLY_SCHEDULE,
  TS_DAILY_POST_EVENING_RETRY_MINUTE_30,
  TS_DAILY_POST_EVENING_RETRY_MINUTE_00,
  TS_DAILY_POST_MORNING_CATCHUP_0630,
  TS_DAILY_POST_MORNING_CATCHUP_0700,
} from '../../common/function-schedules';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { TIME_SERIES_BASELINE_ETFS, TIME_SERIES_MASTER_SYMBOL_ORDER } from '../data/ts-master-order';
import { TS_SCHEDULER_BATCH_SIZE, TS_FULLBACKFILL_BATCH_SIZE } from '../jobs/ts-job-batch-config';
import { CloudTask } from '../../common/constants';
import type { IntradaySnapshotJobPayload } from '../jobs/intraday-snapshot-jobs.worker';
import { TimeSeriesJobStatus, TimeSeriesJobMode, TimeSeriesRunStatus } from '../jobs/time-series-jobs.model';
import { RunIdFactory, type RealtimeRunParams } from '../jobs/runid-factory';
import { clockPtNow } from '../../common/bar-status/bar-status.service';

const tsJobLogger = betterLogger('aVTSRM');

/**
 * Computes the current trading date and day-of-week in Eastern Time.
 *
 * This helper centralizes ET calendar logic so that all time-series
 * schedulers derive a consistent `marketDate` and `dow` for use in
 * runId construction and Firestore document keys.
 *
 * @returns Object containing the ET trading `marketDate` (YYYY-MM-DD)
 *          and corresponding `dow` enum value.
 */
function getEtMarketDateAndDow(): { marketDate: string; dow: DayOfWeek } {
  const tz = 'America/New_York';
  const now = new Date();
  const fmtDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const marketDate = fmtDate.format(now);

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
  const dow: DayOfWeek = DOW_ENUM[dowIdx];

  return { marketDate, dow };
}


/**
 * Builds a canonical realtime POST `runId` for a specific interval.
 *
 * Format: YYYY-MM-DD-DOW-SEQUENCE-INTERVAL-LIVE|MANUAL-PHASE-HHMM
 * Example: 2026-01-29-THU-A-DAILY-LIVE-POST-1635
 *
 * The clockEt is always required for identification purposes.
 */
function buildRealtimeIntervalRunId(params: {
  marketDate: string;
  dow: DayOfWeek;
  interval: TimeSeriesInterval;
  isManual: boolean;
  sequence: string;
  phase: TradingPhase;
  clockEt: string; // Required ET time (HHMM) for identification
}): string {
  const realtimeParams: RealtimeRunParams = {
    marketDate: params.marketDate,
    dow: params.dow,
    interval: params.interval,
    isManual: params.isManual,
    sequence: params.sequence,
    phase: params.phase,
    clockEt: params.clockEt,
  };
  
  return RunIdFactory.createRealtime(realtimeParams);
}

/**
 * Builds a backfill-specific `runId` for `backfill-runs/{runId}`.
 *
 * Uses the RunIdFactory to ensure consistency with the rest of the pipeline.
 *
 * Example: 2026-01-31-SAT-POST-DAILY-FULL_BACKFILL
 */
function buildBackfillRunId(params: {
  marketDate: string;
  dow: DayOfWeek;
  interval: TimeSeriesInterval;
}): string {
  return RunIdFactory.createBackfill(params);
}

/**
 * Orders tracked symbols so that baselines and master-listed symbols are
 * processed first, followed by all remaining symbols in sorted order.
 *
 * This ensures consistent, deterministic symbol ordering across runs,
 * which makes logs and backfill diagnostics easier to reason about.
 *
 * @param allTracked Raw list of tracked symbol tickers.
 * @returns Ordered symbol list with baselines and master symbols first.
 */
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

async function getLatestRetryRunMarketDateForInterval(
  interval: TimeSeriesInterval,
): Promise<string | null> {
  const runsRef = db.collection(FirestoreCollection.REALTIME_RUNS);

  const snap = await runsRef
    .where('interval', '==', interval)
    .where('runType', '==', 'ts-post-all-intervals-retry')
    .orderBy('marketDate', 'desc')
    .limit(1)
    .get();

  if (snap.empty) {
    return null;
  }

  const data = snap.docs[0].data() as any;
  const md = String(data.marketDate || '');
  return md || null;
}

/**
 * Creates or updates a realtime job document under `realtime-runs/{runId}/jobs/{jobId}`
 * and, when enabled, enqueues the corresponding Cloud Task.
 *
 * This is the canonical helper for POST realtime runs. It also increments the
 * `createdJobs` counter on the parent run document when a new job is created.
 */
async function createRealtimeRunJobAndEnqueueTask(options: {
  marketDate: string;
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  phase: TradingPhase;
  runId: string;
  intervalForEndpoint: TimeSeriesInterval;
  endpointName: string;
  // When true, marks the resulting job as part of a deadline run (e.g. C run)
  // so the worker can treat persistently stale data as a terminal failure
  // after exhausting retries.
  deadlineRun?: boolean;
}): Promise<void> {
  const { marketDate, symbol, endpoint, phase, runId, intervalForEndpoint, endpointName, deadlineRun } = options;

  const fnString = 'cRRJAET';

  const jobId = `${symbol}-${endpoint}-${phase}`;
  const runPath = `${FirestoreCollection.REALTIME_RUNS}/${runId}`;
  const runRef = db.doc(runPath);
  const jobPath = `${runPath}/${FirestoreCollection.JOBS}/${jobId}`;
  const jobRef = db.doc(jobPath);

  let createdNewJob = false;
  let skippedForRun = false;

  tsJobLogger.timeStart('realtime_job.tx', {
    function: fnString,
    symbol,
    marketDate,
    interval: intervalForEndpoint,
    endpoint: endpointName,
  } as BetterLogPayload);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    const nowTs = Timestamp.now();

    if (!snap.exists) {
      // Fresh realtime job doc for this symbol/endpoint/phase.
      tx.set(jobRef, {
        symbol,
        endpoint,
        interval: intervalForEndpoint,
        phase,
        status: TimeSeriesJobStatus.Pending,
        attempts: 0,
        createdAt: nowTs,
        updatedAt: nowTs,
      });
      createdNewJob = true;
      return;
    }

    const data = snap.data() as any;
    const status: TimeSeriesJobStatus | undefined = data?.status;

    // For realtime runs, we skip already terminal jobs to avoid re-enqueueing
    // work that has reached SUCCESS or PERMANENT_FAILURE. Track these as
    // "skipped" so the parent run doc has an explicit count of symbols that
    // required no new work for this invocation.
    if (status === TimeSeriesJobStatus.Success || status === TimeSeriesJobStatus.PermanentFailure) {
      skippedForRun = true;
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
        attempts:
          typeof data?.attempts === 'number'
            ? data.attempts
            : 0,
        updatedAt: nowTs,
      },
      { merge: true },
    );
  });

  tsJobLogger.timeEnd('realtime_job.tx', {
    function: fnString,
    symbol,
    marketDate,
    interval: intervalForEndpoint,
    endpoint: endpointName,
  } as BetterLogPayload);

  if (createdNewJob) {
    await runRef.set(
      {
        createdJobs: FieldValue.increment(1),
      },
      { merge: true },
    );
  }
  if (skippedForRun) {
    await runRef.set(
      {
        skippedSymbolsCount: FieldValue.increment(1),
      },
      { merge: true },
    );
  }

  tsJobLogger.timeStart('realtime_job.enqueue', {
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
      jobType: TimeSeriesJobType.REALTIME,
      runId,
      // Mark whether this job belongs to a deadline run; the worker
      // will interpret this to potentially treat stale data as a
      // terminal failure after MAX_ATTEMPTS.
      deadlineRun: !!deadlineRun,
    });
    tsJobLogger.timeEnd('realtime_job.enqueue', {
      function: fnString,
      symbol,
      marketDate,
      interval: intervalForEndpoint,
      endpoint: endpointName,
    } as BetterLogPayload);
  } catch (e: any) {
    tsJobLogger.timeEnd('realtime_job.enqueue', {
      function: fnString,
      symbol,
      marketDate,
      interval: intervalForEndpoint,
      endpoint: endpointName,
    } as BetterLogPayload);
    tsJobLogger.warn('realtime_job.enqueue_failed', {
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
  // Canonical run identifier for this invocation. All realtime jobs
  // must have a runId in the new pipeline.
  runId: string;
  // When true, marks all jobs created by this invocation as part of a
  // deadline run (e.g. the C run), allowing the worker to treat
  // persistently stale data as a terminal failure after retries.
  deadlineRun?: boolean;
}): Promise<void> {
  const { endpoint, phase, marketDate: marketDateOverride, symbols: symbolsOverride, runId, deadlineRun } = options;

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

  const endpointName = AlphaVantageEndpoint[endpoint];
  const intervalForEndpoint: TimeSeriesInterval =
    endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED
      ? TimeSeriesInterval.DAILY
      : endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED
        ? TimeSeriesInterval.WEEKLY
        : TimeSeriesInterval.MONTHLY;

  let symbols: string[];
  if (Array.isArray(symbolsOverride) && symbolsOverride.length > 0) {
    symbols = orderTrackedSymbols(symbolsOverride.map((s) => s.toUpperCase()));
  } else {
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    symbols = orderTrackedSymbols(symbolsSnap.docs.map((d) => d.id));
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

        await createRealtimeRunJobAndEnqueueTask({
          marketDate,
          symbol: symbolUpper,
          endpoint,
          phase: phaseFinal,
          runId,
          intervalForEndpoint,
          endpointName,
          deadlineRun,
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
    message: `Created ${createdSymbolsThisEndpoint.size} symbols for ${endpointName}`,
  } as BetterLogPayload);
  tsJobLogger.endMaj('ts.jobs.run_summary', {} as BetterLogPayload);
  console.log('==========================================================');
}

/**
 * Enqueue FULL_BACKFILL jobs for a given endpoint and symbol set.
 *
 * Backfill orchestration is fully separated from realtime. This helper
 * shares the symbol ordering and marketDate derivation logic with the
 * realtime scheduler, but uses a dedicated backfill runId format and
 * the `backfill-runs/{runId}` hierarchy.
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

  const endpointName = AlphaVantageEndpoint[endpoint];
  const intervalForEndpoint: TimeSeriesInterval =
    endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED
      ? TimeSeriesInterval.DAILY
      : endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED
        ? TimeSeriesInterval.WEEKLY
        : TimeSeriesInterval.MONTHLY;

  // Backfill runs use a dedicated runId format that is distinct from
  // realtime runs and encodes the target interval directly.
  const runId = buildBackfillRunId({
    marketDate,
    dow: dowEnum,
    interval: intervalForEndpoint,
  });

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

        // Create job doc in backfill-runs/{runId}/jobs/{symbol-endpoint-phase} subcollection
        const jobId = `${symbolUpper}-${endpoint}-${TradingPhase.POST}`;
        const jobPath = `${FirestoreCollection.BACKFILL_RUNS}/${runId}/${FirestoreCollection.JOBS}/${jobId}`;
        const jobRef = db.doc(jobPath);
        
        await jobRef.set({
          symbol: symbolUpper,
          endpoint,
          phase: TradingPhase.POST,
          mode: TimeSeriesJobMode.FullBackfill,
          status: TimeSeriesJobStatus.Pending,
          attempts: 0,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });

        // Enqueue Cloud Task with backfill jobType
        const queue = getFunctions().taskQueue(CloudTask.TIME_SERIES_JOB);
        await queue.enqueue({
          marketDate,
          symbol: symbolUpper,
          endpoint,
          phase: TradingPhase.POST,
          mode: TimeSeriesJobMode.FullBackfill,
          jobType: TimeSeriesJobType.BACKFILL,
          runId,
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
  
  // Delete existing run doc to reset counters (in case of re-run)
  await runDocRef.delete().catch(() => {
    // Ignore if doc doesn't exist
  });
  
  await runDocRef.set({
    runId,
    type: 'full_backfill',
    marketDate,
    endpoint: endpointName,
    interval: intervalForEndpoint,
    symbolCount: createdSymbolsThisEndpoint.size,
    expectedJobs: createdSymbolsThisEndpoint.size,
    successJobs: 0,
    permanentFailureJobs: 0,
    status: 'IN_PROGRESS',
    runStartedAt: Timestamp.now(),
  });

  return {
    marketDate,
    runId,
    symbolCount: createdSymbolsThisEndpoint.size,
    interval: intervalForEndpoint,
  };
}

/**
 * Orchestrates the POST time-series pipeline for all AV intervals
 * (DAILY/WEEKLY/MONTHLY) for a single trading date.
 *
 * This is the primary entry point for the all-intervals POST run that
 * ultimately drives the `ts-post-all-intervals` partner data-ready
 * message emitted from the aggregator.
 *
 * The scheduler supplies a sequence and optional clock label so that
 * multiple POST passes for the same trading date (A/B/C) can be
 * distinguished at the runId level while still letting this helper
 * construct interval-specific runIds.
 *
 * @param options.trigger Logical trigger for the run (scheduler/manual).
 * @param options.marketDate Optional explicit trading date override.
 * @param options.symbols Optional subset of symbols to target.
 * @param options.isManualRun Whether this run should be labeled MANUAL.
 * @param options.sequence Single-character sequence identifier (e.g. A/B/C).
 * @param options.clockEt Optional ET clock label (HHMM) to embed in runIds.
 */
export async function runAllTimeSeriesIntervalsPost(options: {
  trigger: RefreshTrigger;
  marketDate?: string;
  symbols?: string[];
  isManualRun: boolean;
  sequence: string;
  clockEt: string; // Required ET time (HHMM) - must be provided by caller
}): Promise<void> {
  const { trigger, marketDate, symbols, isManualRun, sequence, clockEt } = options;

  // Derive an effective marketDate (ET) for this run so we can stamp the
  // corresponding realtime-runs/{runId} document with stable context.
  const tz = 'America/New_York';
  let effectiveMarketDate = marketDate;
  if (!effectiveMarketDate) {
    const now = new Date();
    const fmtDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    effectiveMarketDate = fmtDate.format(now);
  }

  // Compute day-of-week based on the effective marketDate rather than the
  // current clock time. This keeps the runId stable for manual/backfill
  // callers that override marketDate.
  let dow: DayOfWeek;
  try {
    const [yStr, mStr, dStr] = effectiveMarketDate!.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    const dateUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    const dowIdx = dateUtc.getUTCDay();
    const DOW_ENUM: DayOfWeek[] = [
      DayOfWeek.Sun,
      DayOfWeek.Mon,
      DayOfWeek.Tue,
      DayOfWeek.Wed,
      DayOfWeek.Thu,
      DayOfWeek.Fri,
      DayOfWeek.Sat,
    ];
    dow = DOW_ENUM[dowIdx];
  } catch {
    // Fallback: if parsing fails for any reason, derive from current ET
    // clock so we still produce a valid runId.
    const { dow: fallbackDow } = getEtMarketDateAndDow();
    dow = fallbackDow;
  }

  const nowTs = Timestamp.now();

  // Distinguish initial full-universe runs from retry-only passes so that
  // partner consumers (RS) can interpret retrySymbols correctly:
  // - ts-post-all-intervals-initial: primary close run (sequence A, full universe).
  // - ts-post-all-intervals-retry: retry-only passes (B / C).
  const runTypeValue = sequence === 'A'
    ? 'ts-post-all-intervals-initial'
    : 'ts-post-all-intervals-retry';

  // Treat the C run in the A/B/C sequence as the logical deadline run for
  // data freshness. Jobs created under this runId will be marked with
  // deadlineRun so the worker can convert persistently stale data into
  // permanent failures after exhausting retries.
  const isDeadlineRun = sequence === 'C';

  // Build interval-specific runIds so that each interval has its own
  // realtime-runs/{runId} document and counters, mirroring the backfill
  // per-interval pattern.
  const monthlyRunId = buildRealtimeIntervalRunId({
    marketDate: effectiveMarketDate,
    dow,
    interval: TimeSeriesInterval.MONTHLY,
    isManual: isManualRun,
    sequence,
    phase: TradingPhase.POST,
    clockEt,
  });

  const weeklyRunId = buildRealtimeIntervalRunId({
    marketDate: effectiveMarketDate,
    dow,
    interval: TimeSeriesInterval.WEEKLY,
    isManual: isManualRun,
    sequence,
    phase: TradingPhase.POST,
    clockEt,
  });

  const dailyRunId = buildRealtimeIntervalRunId({
    marketDate: effectiveMarketDate,
    dow,
    interval: TimeSeriesInterval.DAILY,
    isManual: isManualRun,
    sequence,
    phase: TradingPhase.POST,
    clockEt,
  });

  const monthlyRunRef = db.doc(`${FirestoreCollection.REALTIME_RUNS}/${monthlyRunId}`);
  const weeklyRunRef = db.doc(`${FirestoreCollection.REALTIME_RUNS}/${weeklyRunId}`);
  const dailyRunRef = db.doc(`${FirestoreCollection.REALTIME_RUNS}/${dailyRunId}`);

  // Emit a canonical run-start log for all-intervals POST runs so external
  // alerting (e.g. SMS via Cloud Monitoring) can reliably detect when a new
  // sequence begins for a given trading date. Include PT clock context so
  // SMS/text alerts can reference local time.
  const ptTz = 'America/Los_Angeles';
  const nowPt = new Date();
  const actualDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: ptTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(nowPt);
  const startTimePt = new Intl.DateTimeFormat('en-US', {
    timeZone: ptTz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(nowPt);
  const isScheduledRun = trigger === RefreshTrigger.SCHEDULER && !isManualRun;

  tsJobLogger.info('ts.post_all_intervals.run_start', {
    function: 'rATSRP',
    marketDate: effectiveMarketDate,
    message: `POST all-intervals run START seq=${sequence} scheduled=${isScheduledRun} mktDate=${effectiveMarketDate} actualDate=${actualDate} startTimePt=${startTimePt}`,
  } as BetterLogPayload);

  // Initialize or update the canonical realtime run documents. These mirror the
  // backfill-runs layout but are used for realtime POST runs only, one per
  // interval.
  await Promise.all([
    monthlyRunRef.set(
      {
        runId: monthlyRunId,
        runType: runTypeValue,
        sequence,
        marketDate: effectiveMarketDate,
        phase: TradingPhase.POST,
        interval: TimeSeriesInterval.MONTHLY,
        trigger,
        status: 'IN_PROGRESS',
        runCreatedAt: nowTs,
        runStartedAt: nowTs,
        createdJobs: 0,
        finishedJobs: 0,
        successJobs: 0,
        permanentFailureJobs: 0,
        retrySuccessSymbols: [],
        partnerDataReady: {
          messageSent: false,
          // Epoch start as a sentinel for "not yet sent".
          sendTime: Timestamp.fromMillis(0),
          messagePayload: undefined,
        },
      },
      { merge: true },
    ),
    weeklyRunRef.set(
      {
        runId: weeklyRunId,
        runType: runTypeValue,
        sequence,
        marketDate: effectiveMarketDate,
        phase: TradingPhase.POST,
        interval: TimeSeriesInterval.WEEKLY,
        trigger,
        status: 'IN_PROGRESS',
        runCreatedAt: nowTs,
        runStartedAt: nowTs,
        createdJobs: 0,
        finishedJobs: 0,
        successJobs: 0,
        permanentFailureJobs: 0,
        partnerDataReady: {
          messageSent: false,
          sendTime: Timestamp.fromMillis(0),
          messagePayload: undefined,
        },
      },
      { merge: true },
    ),
    dailyRunRef.set(
      {
        runId: dailyRunId,
        runType: runTypeValue,
        sequence,
        marketDate: effectiveMarketDate,
        phase: TradingPhase.POST,
        interval: TimeSeriesInterval.DAILY,
        trigger,
        status: 'IN_PROGRESS',
        runCreatedAt: nowTs,
        runStartedAt: nowTs,
        createdJobs: 0,
        finishedJobs: 0,
        successJobs: 0,
        permanentFailureJobs: 0,
        partnerDataReady: {
          messageSent: false,
          sendTime: Timestamp.fromMillis(0),
          messagePayload: undefined,
        },
      },
      { merge: true },
    ),
  ]);
  // For A runs or when an explicit symbol override is provided, schedule
  // jobs for the standard universe (tracked-symbols or the supplied list).
  // For B/C retry runs without an explicit symbol list, restrict job
  // creation per-interval to the retrySymbols from the prior run:
  //   - B runs read retrySymbols from the corresponding A run.
  //   - C runs read retrySymbols from the corresponding B run.

  const hasExplicitSymbols = Array.isArray(symbols) && symbols.length > 0;

  // Helper to resolve the per-interval retrySymbols for B/C runs.
  async function getRetrySymbolsForInterval(interval: TimeSeriesInterval): Promise<string[]> {
    // Only used for non-A sequences without explicit symbol overrides.
    if (sequence === 'A' || hasExplicitSymbols) {
      return [];
    }

    const sourceSequence = sequence === 'B' ? 'A' : 'B';

    // Prototype: use only the new DOW-inclusive interval runId format for
    // retry lookups. This keeps B/C completely independent of any clockEt
    // label embedded in prior runs.
    const sourceClockEt = sourceSequence === 'A' ? '1635' : sourceSequence === 'B' ? '2100' : '0000';
    const sourceRunId = buildRealtimeIntervalRunId({
      marketDate: effectiveMarketDate!,
      dow,
      interval,
      isManual: isManualRun,
      sequence: sourceSequence,
      phase: TradingPhase.POST,
      clockEt: sourceClockEt,
    });

    const sourceRef = db.doc(`${FirestoreCollection.REALTIME_RUNS}/${sourceRunId}`);
    const sourceSnap = await sourceRef.get();
    const sourceData = sourceSnap.data() as any | undefined;
    const arr: string[] = Array.isArray(sourceData?.retrySymbols) ? sourceData.retrySymbols : [];
    return arr.map((s) => String(s).toUpperCase());
  }

  // MONTHLY first
  // A-sequence runs (initial) and any explicit symbol overrides use the
  // full tracked-symbol universe. B/C runs without explicit symbols use the
  // retrySymbols from the prior run.
  if (sequence === 'A' || hasExplicitSymbols) {
    await monthlyRunRef.set(
      {
        jobsCreationStartedAt: Timestamp.now(),
      },
      { merge: true },
    );
    await runTimeSeriesJobsForEndpoint({
      endpoint: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
      phase: TradingPhase.POST,
      trigger,
      marketDate,
      symbols,
      runId: monthlyRunId,
      deadlineRun: isDeadlineRun,
    });
    await monthlyRunRef.set(
      {
        jobsCreationCompletedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } else {
    const monthlyRetrySymbols = await getRetrySymbolsForInterval(TimeSeriesInterval.MONTHLY);
    if (monthlyRetrySymbols.length > 0) {
      await monthlyRunRef.set(
        {
          retrySymbols: monthlyRetrySymbols,
          jobsCreationStartedAt: Timestamp.now(),
        },
        { merge: true },
      );
      await runTimeSeriesJobsForEndpoint({
        endpoint: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
        phase: TradingPhase.POST,
        trigger,
        marketDate,
        symbols: monthlyRetrySymbols,
        runId: monthlyRunId,
        deadlineRun: isDeadlineRun,
      });
      await monthlyRunRef.set(
        {
          jobsCreationCompletedAt: Timestamp.now(),
        },
        { merge: true },
      );
    } else {
      // No retry symbols for this interval: trivially complete run with zero jobs
      const completedAt = Timestamp.now();
      await monthlyRunRef.set(
        {
          jobsCreationStartedAt: completedAt,
          jobsCreationCompletedAt: completedAt,
          createdJobs: 0,
          finishedJobs: 0,
          successJobs: 0,
          permanentFailureJobs: 0,
          status: TimeSeriesRunStatus.COMPLETE,
          runFinishedAt: completedAt,
          totalDuration: 0,
          totalDurationFormatted: '00:00',
        },
        { merge: true },
      );
    }
  }

  // WEEKLY next
  if (sequence === 'A' || hasExplicitSymbols) {
    await weeklyRunRef.set(
      {
        jobsCreationStartedAt: Timestamp.now(),
      },
      { merge: true },
    );
    await runTimeSeriesJobsForEndpoint({
      endpoint: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
      phase: TradingPhase.POST,
      trigger,
      marketDate,
      symbols,
      runId: weeklyRunId,
      deadlineRun: isDeadlineRun,
    });
    await weeklyRunRef.set(
      {
        jobsCreationCompletedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } else {
    const weeklyRetrySymbols = await getRetrySymbolsForInterval(TimeSeriesInterval.WEEKLY);
    if (weeklyRetrySymbols.length > 0) {
      await weeklyRunRef.set(
        {
          retrySymbols: weeklyRetrySymbols,
          jobsCreationStartedAt: Timestamp.now(),
        },
        { merge: true },
      );
      await runTimeSeriesJobsForEndpoint({
        endpoint: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
        phase: TradingPhase.POST,
        trigger,
        marketDate,
        symbols: weeklyRetrySymbols,
        runId: weeklyRunId,
        deadlineRun: isDeadlineRun,
      });
      await weeklyRunRef.set(
        {
          jobsCreationCompletedAt: Timestamp.now(),
        },
        { merge: true },
      );
    } else {
      const completedAt = Timestamp.now();
      await weeklyRunRef.set(
        {
          jobsCreationStartedAt: completedAt,
          jobsCreationCompletedAt: completedAt,
          createdJobs: 0,
          finishedJobs: 0,
          successJobs: 0,
          permanentFailureJobs: 0,
          status: TimeSeriesRunStatus.COMPLETE,
          runFinishedAt: completedAt,
          totalDuration: 0,
          totalDurationFormatted: '00:00',
        },
        { merge: true },
      );
    }
  }

  // DAILY last
  if (sequence === 'A' || hasExplicitSymbols) {
    await dailyRunRef.set(
      {
        jobsCreationStartedAt: Timestamp.now(),
      },
      { merge: true },
    );
    await runTimeSeriesJobsForEndpoint({
      endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
      phase: TradingPhase.POST,
      trigger,
      marketDate,
      symbols,
      runId: dailyRunId,
      deadlineRun: isDeadlineRun,
    });
    await dailyRunRef.set(
      {
        jobsCreationCompletedAt: Timestamp.now(),
      },
      { merge: true },
    );
  } else {
    const dailyRetrySymbols = await getRetrySymbolsForInterval(TimeSeriesInterval.DAILY);
    if (dailyRetrySymbols.length > 0) {
      await dailyRunRef.set(
        {
          retrySymbols: dailyRetrySymbols,
          jobsCreationStartedAt: Timestamp.now(),
        },
        { merge: true },
      );
      await runTimeSeriesJobsForEndpoint({
        endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
        phase: TradingPhase.POST,
        trigger,
        marketDate,
        symbols: dailyRetrySymbols,
        runId: dailyRunId,
        deadlineRun: isDeadlineRun,
      });
      await dailyRunRef.set(
        {
          jobsCreationCompletedAt: Timestamp.now(),
        },
        { merge: true },
      );
    } else {
      const completedAt = Timestamp.now();
      await dailyRunRef.set(
        {
          jobsCreationStartedAt: completedAt,
          jobsCreationCompletedAt: completedAt,
          createdJobs: 0,
          finishedJobs: 0,
          successJobs: 0,
          permanentFailureJobs: 0,
          status: TimeSeriesRunStatus.COMPLETE,
          runFinishedAt: completedAt,
          totalDuration: 0,
          totalDurationFormatted: '00:00',
        },
        { merge: true },
      );
    }
  }
}

/**
 * Time-series schedulers (TS)
 *
 * These scheduler exports are the public, time-based entry points for
 * the Alpha Vantage time-series pipeline. Each one is responsible for
 * constructing a canonical runId and delegating into the shared job
 * runner/orchestrator functions.
 */

/**
 * Creates intraday snapshot job docs and enqueues Cloud Tasks for every tracked symbol.
 *
 * Mirrors the structure of createRealtimeRunJobAndEnqueueTask for POST runs but targets
 * the `intraday-runs/{runId}` collection and the INTRADAY_SNAPSHOT_JOB task queue.
 *
 * @param options.marketDate ET trading date (YYYY-MM-DD).
 * @param options.clockPt HHMM PT clock label for the triggering tick.
 * @param options.symbols Optional symbol override; reads tracked-symbols if omitted.
 */
export async function runIntradaySnapshotJobsForSymbols(options: {
  marketDate: string;
  clockPt: string;
  symbols?: string[];
}): Promise<void> {
  const { marketDate, clockPt, symbols: symbolsOverride } = options;
  const fnString = 'rISJFS';

  // Weekend guard: skip entirely on Sat/Sun.
  const dowIdx = Number(
    new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    ).getDay(),
  );
  if (dowIdx === 0 || dowIdx === 6) {
    tsJobLogger.info('intraday.scheduler.skip_weekend', {
      function: fnString,
      marketDate,
      clockPt,
    } as BetterLogPayload);
    return;
  }

  const DOW_ENUM: DayOfWeek[] = [
    DayOfWeek.Sun, DayOfWeek.Mon, DayOfWeek.Tue, DayOfWeek.Wed,
    DayOfWeek.Thu, DayOfWeek.Fri, DayOfWeek.Sat,
  ];
  const dow: DayOfWeek = DOW_ENUM[dowIdx];

  const runId = `${marketDate}-${dow.toUpperCase()}-LIVE-${clockPt}`;

  let symbols: string[];
  if (Array.isArray(symbolsOverride) && symbolsOverride.length > 0) {
    symbols = orderTrackedSymbols(symbolsOverride.map((s) => s.toUpperCase()));
  } else {
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    symbols = orderTrackedSymbols(symbolsSnap.docs.map((d) => d.id));
  }

  const nowTs = Timestamp.now();
  const runRef = db.doc(`${FirestoreCollection.INTRADAY_RUNS}/${runId}`);

  // Initialise the run document.
  await runRef.set(
    {
      runId,
      marketDate,
      phase: 'pre',
      interval: TimeSeriesInterval.INTRADAY,
      trigger: RefreshTrigger.SCHEDULER,
      status: 'IN_PROGRESS',
      runCreatedAt: nowTs,
      jobsCreationStartedAt: nowTs,
      clockPt,
      createdJobs: 0,
      finishedJobs: 0,
      successJobs: 0,
      permanentFailureJobs: 0,
    },
    { merge: true },
  );

  tsJobLogger.info('intraday.scheduler.start', {
    function: fnString,
    marketDate,
    interval: TimeSeriesInterval.INTRADAY,
    endpoint: 'TIME_SERIES_INTRADAY',
    message: `BEGIN intraday snapshot run ${runId} (${symbols.length} symbols)`,
  } as BetterLogPayload);

  for (let i = 0; i < symbols.length; i += TS_SCHEDULER_BATCH_SIZE) {
    const chunk = symbols.slice(i, i + TS_SCHEDULER_BATCH_SIZE);

    await Promise.all(
      chunk.map(async (symbol) => {
        const symbolUpper = symbol.toUpperCase();
        const jobPath = `${FirestoreCollection.INTRADAY_RUNS}/${runId}/${FirestoreCollection.JOBS}/${symbolUpper}`;
        const jobRef = db.doc(jobPath);

        await jobRef.set({
          symbol: symbolUpper,
          marketDate,
          status: 'PENDING',
          attempts: 0,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });

        await runRef.set({ createdJobs: FieldValue.increment(1) }, { merge: true });

        try {
          const queue = getFunctions().taskQueue(CloudTask.INTRADAY_SNAPSHOT_JOB);
          const taskPayload: IntradaySnapshotJobPayload = {
            marketDate,
            symbol: symbolUpper,
            runId,
            clockPt,
          };
          await queue.enqueue(taskPayload);
        } catch (e: any) {
          tsJobLogger.warn('intraday.scheduler.enqueue_failed', {
            function: fnString,
            symbol: symbolUpper,
            marketDate,
            error: String(e?.message ?? e),
          } as BetterLogPayload);
        }
      }),
    );
  }

  // Stamp jobsCreationCompletedAt once all jobs are enqueued.
  await runRef.set({ jobsCreationCompletedAt: Timestamp.now() }, { merge: true });

  tsJobLogger.info('intraday.scheduler.end', {
    function: fnString,
    marketDate,
    interval: TimeSeriesInterval.INTRADAY,
    endpoint: 'TIME_SERIES_INTRADAY',
    message: `END intraday snapshot run ${runId} (${symbols.length} symbols enqueued)`,
  } as BetterLogPayload);
}

/**
 * Daily time series: intraday hourly PRE snapshot (daily only).
 *
 * Runs at 8am, 10am, and 12pm PT on weekdays, enqueuing one
 * Cloud Task per tracked symbol via the INTRADAY_SNAPSHOT_JOB queue.
 * Each task fetches the latest 1-min AV bar and upserts the snapshot fields
 * (ip/io/it/ic/ipc) into the DAILY_ADJUSTED year-shard document for the symbol.
 *
 * Replaces the previous no-op that called runTimeSeriesJobsForEndpoint with
 * TradingPhase.PRE (which immediately returned without doing any work).
 */
export const refreshAvDailyTimeSeriesIntradayHourly = onSchedule({
  schedule: TS_DAILY_INTRADAY_HOURLY_SCHEDULE,
  timeZone: 'America/Los_Angeles',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  const now = new Date();
  const marketDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const clockPt = clockPtNow();

  await runIntradaySnapshotJobsForSymbols({ marketDate, clockPt });
});

/**
 * Daily time series: post-close (legacy daily-only entrypoint).
 *
 * In the new design, the all-intervals POST run is driven by
 * {@link refreshAvTimeSeriesPostAllIntervals}, which calls
 * {@link runAllTimeSeriesIntervalsPost}. To avoid double runs and keep
 * the contract clear, this legacy daily-only scheduler is now a no-op
 * that only logs when invoked.
 */
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

/**
 * All-intervals time series: post-close orchestrator
 * (DAILY/WEEKLY/MONTHLY).
 *
 * Runs the unified POST pipeline for all time-series intervals in a
 * single pass for the given trading date. This is the canonical
 * orchestrator behind the `ts-post-all-intervals` partner run type.
 *
 * All schedulers that create POST jobs for DAILY/WEEKLY/MONTHLY MUST go
 * through this orchestrator (or a future equivalent) so that all jobs are
 * created under `realtime-runs/{runId}/jobs/...`. The legacy
 * `time-series-jobs/{marketDate}` collection is no longer part of the
 * supported critical path and should not be written to by new code.
 */
export const refreshAvTimeSeriesPostAllIntervals = onSchedule({
  schedule: TS_DAILY_POST_CLOSE_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async (event) => {
  const { marketDate } = getEtMarketDateAndDow();

  // Optional runMode flag allows manual callers (e.g. gcloud functions call)
  // to force MANUAL runIds in production without relying on env vars.
  const rawRunMode = (event && (event as any).data && (event as any).data.runMode) as string | undefined;
  const normalizedRunMode = rawRunMode ? String(rawRunMode).toLowerCase() : undefined;
  const isManualOverride = normalizedRunMode === 'manual';

  const isManualRun = process.env.FUNCTIONS_EMULATOR === 'true' || isManualOverride;
  const trigger = isManualOverride ? RefreshTrigger.MANUAL : RefreshTrigger.SCHEDULER;

  await runAllTimeSeriesIntervalsPost({
    trigger,
    marketDate,
    isManualRun,
    sequence: 'A',
    clockEt: '1635',
  });
});

/**
 * Weekly time series: post-close every trading day.
 *
 * Left as a logging-only no-op in the new pipeline because all-intervals
 * POST is handled by the DAILY orchestrator.
 */
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

/**
 * Monthly time series: post-close every trading day.
 *
 * Left as a logging-only no-op in the new pipeline because all-intervals
 * POST is handled by the DAILY orchestrator.
 */
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

/**
 * Daily time series: post-close evening retries (every 30 mins).
 *
 * Uses the TS job pipeline to schedule additional POST runs focused on
 * the DAILY interval only. These retries are intended to pick up
 * symbols that failed during the primary close run.
 */
export const refreshAvDailyTimeSeriesPostEveningRetry30 = onSchedule({
  schedule: TS_DAILY_POST_EVENING_RETRY_MINUTE_30,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  const { marketDate, dow } = getEtMarketDateAndDow();

  const isManualRun = process.env.FUNCTIONS_EMULATOR === 'true';
  const runId = buildRealtimeIntervalRunId({
    marketDate,
    dow,
    interval: TimeSeriesInterval.DAILY,
    isManual: isManualRun,
    sequence: 'X',
    phase: TradingPhase.POST,
    clockEt: '0000', // Default for evening retry runs
  });

  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    phase: TradingPhase.POST,
    trigger: RefreshTrigger.SCHEDULER,
    marketDate,
    runId,
  });
});

export const refreshAvDailyTimeSeriesPostEveningRetry00 = onSchedule({
  schedule: TS_DAILY_POST_EVENING_RETRY_MINUTE_00,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  const { marketDate } = getEtMarketDateAndDow();

  const isManualRun = process.env.FUNCTIONS_EMULATOR === 'true';

  await runAllTimeSeriesIntervalsPost({
    trigger: RefreshTrigger.SCHEDULER,
    marketDate,
    isManualRun,
    sequence: 'B',
    clockEt: '2100',
  });
});

/**
 * Daily time series: next-morning catch-ups (06:30 ET).
 *
 * Schedules a POST run targeting DAILY only to reconcile any gaps that
 * remain after the close and evening retries, prior to market open.
 *
 * NOTE: This scheduler is currently paused. If we decide to keep a
 * DAILY-only catch-up pass in the future, it should be reworked to use the
 * same per-interval realtime-runs model as the A/B/C POST runs (one
 * `realtime-runs/{runId}` doc for DAILY) rather than introducing a
 * divergent code path.
 */
export const refreshAvDailyTimeSeriesPostMorning0630 = onSchedule({
  schedule: TS_DAILY_POST_MORNING_CATCHUP_0630,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  const { marketDate, dow } = getEtMarketDateAndDow();

  const isManualRun = process.env.FUNCTIONS_EMULATOR === 'true';
  const runId = buildRealtimeIntervalRunId({
    marketDate,
    dow,
    interval: TimeSeriesInterval.DAILY,
    isManual: isManualRun,
    sequence: 'X',
    phase: TradingPhase.POST,
    clockEt: '0000', // Default for morning catch-up runs
  });

  await runTimeSeriesJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    phase: TradingPhase.POST,
    trigger: RefreshTrigger.SCHEDULER,
    marketDate,
    runId,
  });
});

/**
 * Daily time series: next-morning catch-ups (07:00 ET, all intervals).
 *
 * Runs the full all-intervals POST orchestrator using a distinct
 * sequence and clock so that partner consumers can distinguish this
 * final pre-open reconciliation pass from the previous A/B runs.
 */
export const refreshAvDailyTimeSeriesPostMorning0700 = onSchedule({
  schedule: TS_DAILY_POST_MORNING_CATCHUP_0700,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  const isManualRun = process.env.FUNCTIONS_EMULATOR === 'true';
  const targetMarketDate = await getLatestRetryRunMarketDateForInterval(TimeSeriesInterval.DAILY);

  if (!targetMarketDate) {
    tsJobLogger.info('ts.jobs.a_run.skip_no_retry', {
      function: 'rTSDPM0700',
      reason: 'no_retry_runs_found',
    } as BetterLogPayload);
    return;
  }

  await runAllTimeSeriesIntervalsPost({
    trigger: RefreshTrigger.SCHEDULER,
    marketDate: targetMarketDate,
    isManualRun,
    sequence: 'C',
    clockEt: '0700',
  });
});
