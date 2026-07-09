import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { FirestoreCollection } from '@shared/firestore';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { fetchAndStoreDailyIntradayBar } from '../services/av-intraday-daily.service';
import {
  upsertAvWeeklyIntradaySnapshot,
  upsertAvMonthlyIntradaySnapshot,
} from '../firestore';
import { TimeSeriesJobStatus, TimeSeriesJobTerminalStatus } from './time-series-jobs.model';
import { MAX_JOB_ATTEMPTS, JOB_EXECUTION_DELAY_MS } from './job-config';
import { onIntradayRunJobTerminal } from './intraday-snapshot-jobs.aggregator';

const logger = betterLogger('iS.Wrk');

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
 * Fetches the latest 15-min RTH bars for the given symbol, aggregates them into
 * a single OHLCV bar from 09:30 ET onward, and writes `o/h/l/c/v` into the
 * DAILY_ADJUSTED year-shard. For WEEKLY_ADJUSTED and MONTHLY_ADJUSTED the
 * existing ratcheting intraday overlay logic is preserved: `c`/`ac` are updated
 * to the latest close, `h`/`l` are bumped if the current trading day moved the
 * period range, and `o` is left unchanged except on a period-start placeholder.
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
    endpoint: 'TIME_SERIES_INTRADAY',
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

    // Fetch, aggregate, and store the daily intraday bar in one canonical path.
    const bar = await fetchAndStoreDailyIntradayBar({
      symbol: symbolUpper,
      marketDate,
      clockPt,
    });
    if (!bar) {
      throw new Error(`No intraday bars found for marketDate=${marketDate} symbol=${symbolUpper}`);
    }

    // Preserve W/M ratcheting intraday overlay: close follows the latest bar, h/l
    // ratchet, and o is only touched on a period-start placeholder.
    await Promise.all([
      upsertAvWeeklyIntradaySnapshot({
        symbol: symbolUpper,
        marketDate,
        ip: bar.c,
        io: bar.io,
        clockPt,
      }),
      upsertAvMonthlyIntradaySnapshot({
        symbol: symbolUpper,
        marketDate,
        ip: bar.c,
        io: bar.io,
        clockPt,
      }),
    ]);

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
