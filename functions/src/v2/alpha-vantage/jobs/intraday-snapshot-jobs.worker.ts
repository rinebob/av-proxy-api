import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, DayOfWeek } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { parseAvEtTimestampMs } from '../utils/date-utils';
import { upsertAvDailyIntradaySnapshot, upsertAvWeeklyIntradaySnapshot, upsertAvMonthlyIntradaySnapshot } from '../firestore/av-intraday-snapshot.writer';
import { TimeSeriesJobStatus, TimeSeriesJobTerminalStatus } from './time-series-jobs.model';
import { MAX_JOB_ATTEMPTS, JOB_EXECUTION_DELAY_MS } from './job-config';
import { onIntradayRunJobTerminal } from './intraday-snapshot-jobs.aggregator';

const logger = betterLogger('iS.Wrk');

const TZ = 'America/New_York';

const DOW_ENUM: DayOfWeek[] = [
  DayOfWeek.Sun,
  DayOfWeek.Mon,
  DayOfWeek.Tue,
  DayOfWeek.Wed,
  DayOfWeek.Thu,
  DayOfWeek.Fri,
  DayOfWeek.Sat,
];

/**
 * Payload for a single intraday snapshot job dispatched via Cloud Tasks.
 */
export interface IntradaySnapshotJobPayload {
  /** ET trading date (YYYY-MM-DD) for which the snapshot is being captured. */
  marketDate: string;
  /** Ticker symbol to fetch. */
  symbol: string;
  /** Run document ID under `intraday-runs/{runId}`. */
  runId: string;
  /** PT clock label (HHMM) of the tick that triggered this run — for observability. */
  clockPt: string;
}

/**
 * Core worker for a single intraday snapshot job.
 *
 * Fetches the latest 1-min bar for the given symbol, extracts the most recent
 * bar matching today's ET trading date, and upserts the intraday snapshot fields
 * (`ip / io / it / ic / ipc`) into the DAILY_ADJUSTED, WEEKLY_ADJUSTED, and
 * MONTHLY_ADJUSTED Firestore documents for the trailing bars of each period.
 *
 * Job state is tracked at `intraday-runs/{runId}/jobs/{symbol}`.
 *
 * @param payload Job parameters dispatched by the Cloud Task queue.
 */
export async function processIntradaySnapshotJobInternal(
  payload: IntradaySnapshotJobPayload,
): Promise<void> {
  const { marketDate, symbol, runId, clockPt } = payload;
  const symbolUpper = symbol.toUpperCase();

  const baseLog: BetterLogPayload = {
    function: 'pISJI',
    symbol: symbolUpper,
    marketDate,
    interval: 'intraday',
    endpoint: AlphaVantageEndpoint.TIME_SERIES_INTRADAY,
  };

  const jobPath = `${FirestoreCollection.INTRADAY_RUNS}/${runId}/${FirestoreCollection.JOBS}/${symbolUpper}`;
  const jobRef = db.doc(jobPath);

  // Load job doc; no-op if it does not exist or is already terminal.
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    logger.warn('intraday.worker.job_not_found', { ...baseLog, runId } as BetterLogPayload);
    return;
  }

  const jobData = jobSnap.data() as any;
  const currentStatus: TimeSeriesJobStatus | undefined = jobData?.status;
  if (
    currentStatus === TimeSeriesJobStatus.Success ||
    currentStatus === TimeSeriesJobStatus.PermanentFailure
  ) {
    return;
  }

  // Spread execution to avoid thundering herd on the AV API.
  if (JOB_EXECUTION_DELAY_MS > 0) {
    await new Promise((r) => setTimeout(r, JOB_EXECUTION_DELAY_MS));
  }

  // Mark IN_PROGRESS and stamp attempt metadata transactionally.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) return;
    const d = snap.data() as any;
    const s: TimeSeriesJobStatus | undefined = d?.status;
    if (s === TimeSeriesJobStatus.Success || s === TimeSeriesJobStatus.PermanentFailure) return;

    const attempts = typeof d?.attempts === 'number' ? d.attempts : 0;
    const now = Timestamp.now();
    const updates: Record<string, unknown> = {
      status: TimeSeriesJobStatus.InProgress,
      attempts: attempts + 1,
      lastAttemptAt: now,
      updatedAt: now,
    };
    if (!d?.firstAttemptedAt) {
      updates.firstAttemptedAt = now;
    }
    tx.set(jobRef, updates, { merge: true });
  });

  // Re-read attempts after the transaction to get the current count.
  const snapAfterMark = await jobRef.get();
  const attemptsNow: number =
    snapAfterMark.exists && typeof (snapAfterMark.data() as any)?.attempts === 'number'
      ? (snapAfterMark.data() as any).attempts
      : 1;

  try {
    logger.info('intraday.worker.start', { ...baseLog, runId, clockPt } as BetterLogPayload);

    // Fetch latest 1-min intraday data for the symbol.
    const handler = AlphaVantageHandlerFactory.createHandler(
      AlphaVantageEndpoint.TIME_SERIES_INTRADAY,
    );
    const resp = await handler.fetch({ symbol: symbolUpper, interval: '1min' });
    const raw = resp?.data;

    const series: Record<string, any> | undefined = raw?.['Time Series (1min)'];
    if (!series || typeof series !== 'object') {
      throw new Error('No intraday series (1min) in AV response');
    }

    // Map entries to ET-local date strings and sort descending so the most
    // recent bar is first. Filter to only today's ET date before scanning.
    const entries = Object.entries(series) as Array<[string, any]>;
    const todayBars = entries
      .map(([ts, v]) => {
        const msEt = parseAvEtTimestampMs(ts);
        if (!Number.isFinite(msEt)) return null;
        const dateEt = new Intl.DateTimeFormat('en-CA', {
          timeZone: TZ,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(msEt));
        return { msEt, dateEt, v };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null && b.dateEt === marketDate);

    if (todayBars.length === 0) {
      throw new Error(`No intraday bars found for marketDate=${marketDate} symbol=${symbolUpper}`);
    }

    // Sort descending — pick the most recent bar.
    todayBars.sort((a, b) => b.msEt - a.msEt);
    const latest = todayBars[0];

    const ip = Number(latest.v['4. close'] ?? latest.v['close']);
    if (!Number.isFinite(ip) || ip <= 0) {
      throw new Error(
        `Invalid close price from latest intraday bar for ${symbolUpper}: ${ip}`,
      );
    }

    // Derive day-of-week in ET for the bar.
    const dowIdx = new Date(
      new Date(latest.msEt).toLocaleString('en-US', { timeZone: TZ }),
    ).getDay();
    const dow: DayOfWeek = DOW_ENUM[dowIdx];

    // Persist the intraday snapshot into the DAILY_ADJUSTED year-shard.
    await upsertAvDailyIntradaySnapshot({
      symbol: symbolUpper,
      date: marketDate,
      ip,
      io: latest.msEt,
      dow,
      clockPt,
    });

    // Persist the same intraday snapshot onto the trailing WEEKLY bar.
    await upsertAvWeeklyIntradaySnapshot({
      symbol: symbolUpper,
      marketDate,
      ip,
      io: latest.msEt,
      clockPt,
    });

    // Persist the same intraday snapshot onto the trailing MONTHLY bar.
    await upsertAvMonthlyIntradaySnapshot({
      symbol: symbolUpper,
      marketDate,
      ip,
      io: latest.msEt,
      clockPt,
    });

    // Mark job SUCCESS.
    await jobRef.set(
      {
        status: TimeSeriesJobStatus.Success,
        updatedAt: Timestamp.now(),
        lastError: null,
      },
      { merge: true },
    );

    logger.info('intraday.worker.success', { ...baseLog, runId, clockPt } as BetterLogPayload);

    await onIntradayRunJobTerminal({
      runId,
      symbol: symbolUpper,
      marketDate,
      clockPt,
      status: TimeSeriesJobTerminalStatus.SUCCESS,
    });
  } catch (e: any) {
    const errMsg = String(e?.message ?? e);
    logger.error('intraday.worker.error', {
      ...baseLog,
      runId,
      error: errMsg,
    } as BetterLogPayload);

    await jobRef.set({ lastError: errMsg, updatedAt: Timestamp.now() }, { merge: true });

    if (attemptsNow >= MAX_JOB_ATTEMPTS) {
      await jobRef.set(
        { status: TimeSeriesJobStatus.PermanentFailure, updatedAt: Timestamp.now() },
        { merge: true },
      );
      logger.error('intraday.worker.permanent_failure', {
        ...baseLog,
        runId,
        attempts: attemptsNow,
      } as BetterLogPayload);

      await onIntradayRunJobTerminal({
        runId,
        symbol: symbolUpper,
        marketDate,
        clockPt,
        status: TimeSeriesJobTerminalStatus.PERMANENT_FAILURE,
      });
      return;
    }

    // Transient failure — let Cloud Tasks retry.
    await jobRef.set(
      { status: TimeSeriesJobStatus.TransientFailure, updatedAt: Timestamp.now() },
      { merge: true },
    );
    throw e;
  }
}
