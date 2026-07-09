import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import type { CompactBar } from '@shared/alpha-vantage';

import {
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
  getYearFromEpochMillis,
} from '../../common/firestore/firestore-paths';
import { isoWeek } from '../../common/bar-status/bar-status.service';
import { INTRADAY_FIRST_TICK } from '../jobs/job-config';
import { betterLogger } from '../../utils/utils';
import {
  barDateStr,
  buildLatestMetadataFromBars,
  computeChangeMetrics,
  computeDowFromDateString,
  findImmediatePredecessorBar,
  INTRADAY_TIME_FORMATTER,
} from './av-firestore-utils';

const logger = betterLogger('av-intraday-snapshot.writer');

/**
 * Shared core logic for upserting W/M intraday snapshot fields into a Firestore doc.
 *
 * Accepts a pre-resolved doc ref and a bar-finder function so the weekly and monthly
 * public wrappers only differ in how they locate the doc and identify the target bar.
 *
 * - Updates o/h/l/c/ac on each tick: h ratchets up, l ratchets down, c/ac always set to ip.
 * - o is only seeded from ip when the existing bar has o===0 (new-period placeholder).
 * - Creates a placeholder bar seeded from ip (all OHLCV = ip) if no matching bar is found.
 * - Uses a Firestore transaction for safe concurrent writes.
 * - Bumps top-level doc metadata via the shared helper.
 *
 * @param docRef     Firestore DocumentReference for the shard or all-doc.
 * @param findBar    Returns the index of the target bar within `bars`, or -1 if absent.
 * @param marketDate YYYY-MM-DD ET trading date — used as the placeholder bar's anchor.
 * @param ip         Latest intraday price.
 * @param io         Epoch ms of the latest intraday bar timestamp.
 * @param barStatus  Pre-computed barStatus for this tick (-1 | 0).
 * @param label      Short label for observability logs (e.g. "weekly week=28", "monthly month=2026-07").
 */
async function _upsertWmIntradaySnapshotCore(
  docRef: FirebaseFirestore.DocumentReference,
  findBar: (bars: CompactBar[]) => number,
  marketDate: string,
  ip: number,
  io: number,
  barStatus: -1 | 0,
  label: string,
): Promise<void> {
  const itStr = INTRADAY_TIME_FORMATTER.format(new Date(io));
  const placeholderT = new Date(`${marketDate}T00:00:00.000Z`).getTime();

  logger.info('wm.intraday.snapshot.start', { message: label });

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const bars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

    const idx = findBar(bars);

    // The predecessor is the bar with the highest t strictly less than the
    // target period's t, i.e. the close of the *prior* W/M period bar. We use
    // that close (preferring adjusted close) to compute the period-over-period
    // change metrics, not yesterday's daily close.
    const targetT = idx >= 0 ? bars[idx].t : placeholderT;
    const prevCandidate = findImmediatePredecessorBar(bars, targetT);

    const prevClose = prevCandidate != null
      ? (typeof prevCandidate.ac === 'number' ? prevCandidate.ac : prevCandidate.c)
      : null;
    const { change, changePercent } = computeChangeMetrics(prevClose, ip);
    const icVal = change ?? 0;
    const ipcVal = changePercent ?? 0;

    if (idx >= 0) {
      const existing = bars[idx];
      // # Reason: Ratchet h/l so the bar reflects the period's intraday range across hourly ticks.
      // c/ac always move to the latest price. o is only seeded when the existing bar is a
      // zero-OHLCV placeholder (new period — first intraday tick before POST has written AV data).
      bars[idx] = {
        ...existing,
        o: existing.o || ip,
        h: existing.h ? Math.max(existing.h, ip) : ip,
        l: existing.l ? Math.min(existing.l, ip) : ip,
        c: ip,
        ac: ip,
        ip,
        io,
        it: itStr,
        ic: icVal,
        ipc: ipcVal,
        barStatus,
      };
    } else {
      // Create a placeholder bar so charting consumers see a trailing bar immediately.
      // # Reason: If the first PRE of a new period runs before POST has written the AV bar,
      // we create a placeholder seeded from ip so o/h/l/c/ac are meaningful from tick one.
      // POST will overwrite with AV's finalized values.
      bars.push({
        t: placeholderT,
        d: marketDate,
        dow: computeDowFromDateString(marketDate),
        o: ip, h: ip, l: ip, c: ip, v: 0, ac: ip, dv: 0, sc: 1,
        ip,
        io,
        it: itStr,
        ic: icVal,
        ipc: ipcVal,
        barStatus,
      });
    }

    bars.sort((a, b) => a.t - b.t);

    tx.set(docRef, {
      bars,
      ...buildLatestMetadataFromBars(bars),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });

  logger.info('wm.intraday.snapshot.committed', { message: label });
}

/**
 * Upsert intraday snapshot fields for the trailing WEEKLY bar, creating a placeholder bar if needed.
 * - Matches the bar whose ISO week contains `marketDate`.
 * - Updates o/h/l/c/ac: h ratchets up, l ratchets down, c/ac always set to ip, o preserved unless zero.
 * - Does not bump parent metadata to avoid churn during trading hours.
 * @param options.symbol Stock symbol
 * @param options.marketDate ET trading date (YYYY-MM-DD) — identifies which week's bar to patch
 * @param options.ip Latest intraday price
 * @param options.io Epoch ms of latest intraday bar timestamp
 * @param options.clockPt PT clock label (HHMM) of the intraday tick — used to compute barStatus
 */
export async function upsertAvWeeklyIntradaySnapshot(options: {
  symbol: string;
  marketDate: string;
  ip: number;
  io: number;
  clockPt?: string;
}): Promise<void> {
  const { symbol, marketDate, ip, io, clockPt } = options;
  const barStatus: -1 | 0 = clockPt === INTRADAY_FIRST_TICK ? -1 : 0;
  const marketDateTs = new Date(`${marketDate}T00:00:00.000Z`).getTime();
  const y = getYearFromEpochMillis(marketDateTs);
  const docRef = db.doc(getSymbolTimeSeriesYearDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED, ApiProvider.ALPHA_VANTAGE, y));

  // Match bars by ISO week + calendar year to handle year-boundary ISO week edge cases.
  const targetWeek = isoWeek(marketDate);
  const marketDateYear = new Date(`${marketDate}T00:00:00.000Z`).getUTCFullYear();
  const findBar = (bars: CompactBar[]): number =>
    bars.findIndex((b) => {
      const d = barDateStr(b);
      if (!d) return false;
      return isoWeek(d) === targetWeek && new Date(`${d}T00:00:00.000Z`).getUTCFullYear() === marketDateYear;
    });

  await _upsertWmIntradaySnapshotCore(docRef, findBar, marketDate, ip, io, barStatus, `weekly symbol=${symbol} week=${targetWeek}`);
}

/**
 * Upsert intraday snapshot fields for the trailing MONTHLY bar, creating a placeholder bar if needed.
 * - Monthly bars live in a single `all` doc (not year-sharded).
 * - Matches the bar whose YYYY-MM matches `marketDate.slice(0, 7)`.
 * - Updates o/h/l/c/ac: h ratchets up, l ratchets down, c/ac always set to ip, o preserved unless zero.
 * - Does not bump parent metadata to avoid churn during trading hours.
 * @param options.symbol Stock symbol
 * @param options.marketDate ET trading date (YYYY-MM-DD) — identifies which month's bar to patch
 * @param options.ip Latest intraday price
 * @param options.io Epoch ms of latest intraday bar timestamp
 * @param options.clockPt PT clock label (HHMM) of the intraday tick — used to compute barStatus
 */
export async function upsertAvMonthlyIntradaySnapshot(options: {
  symbol: string;
  marketDate: string;
  ip: number;
  io: number;
  clockPt?: string;
}): Promise<void> {
  const { symbol, marketDate, ip, io, clockPt } = options;
  const barStatus: -1 | 0 = clockPt === INTRADAY_FIRST_TICK ? -1 : 0;
  const docRef = db.doc(getSymbolTimeSeriesAllDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED, ApiProvider.ALPHA_VANTAGE));

  const targetMonth = marketDate.slice(0, 7);
  const findBar = (bars: CompactBar[]): number =>
    bars.findIndex((b) => { const d = barDateStr(b); return d != null && d.slice(0, 7) === targetMonth; });

  await _upsertWmIntradaySnapshotCore(docRef, findBar, marketDate, ip, io, barStatus, `monthly symbol=${symbol} month=${targetMonth}`);
}
