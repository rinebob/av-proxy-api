import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import type { CompactBar } from '@shared/alpha-vantage';
import { DayOfWeek } from '@shared/alpha-vantage';

import {
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
  getYearFromEpochMillis,
} from '../../common/firestore/firestore-paths';
import { isoWeek } from '../../common/bar-status/bar-status.service';
import { INTRADAY_FIRST_TICK } from '../jobs/job-config';
import { barDateStr, computeDowFromDateString, formatEtDateTime } from './av-firestore-utils';

/**
 * Upsert intraday snapshot fields for the given DAILY trading date, creating the day bar if needed.
 * - Only sets intraday fields (ip/io/it) and optional delta (ic/ipc); does not compute EOD ch/cp here.
 * - Does not bump parent metadata to avoid churn during trading hours.
 * @param options.symbol Stock symbol
 * @param options.date ISO date for the trading day (ET-derived)
 * @param options.ip Latest intraday price
 * @param options.io Epoch ms of latest intraday bar timestamp
 * @param options.dow Required DayOfWeek label (ET)
 * @returns Promise that resolves on success
 */
export async function upsertAvDailyIntradaySnapshot(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (ET-derived trading date)
  ip: number;   // latest intraday price
  io: number;   // epoch ms of the latest intraday bar timestamp
  dow: DayOfWeek; // required human-readable day-of-week (ET)
  /** PT clock label (HHMM) of the intraday tick, e.g. '0800'. Used to compute barStatus. */
  clockPt?: string;
}): Promise<void> {
  const { symbol, date, ip, io, dow, clockPt } = options;
  const barStatus: -1 | 0 = clockPt === INTRADAY_FIRST_TICK ? -1 : 0;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const t = new Date(`${date}T00:00:00.000Z`).getTime();
  const y = getYearFromEpochMillis(t);
  const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, vendor, y);
  const yearRef = db.doc(yearDocPath);

  console.log(`[upsertAvDailyIntradaySnapshot] Starting transaction for ${symbol} at path: ${yearDocPath}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(yearRef);
    const bars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

    // locate or create the day bar, updating only intraday fields
    let idx = bars.findIndex((b) => b.t === t);

    // Hoist shared intraday field computations — used by both insert and update paths
    const itStr = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(io));
    const prevCandidate = bars.reduce<CompactBar | null>((p, b) => (b.t < t && (!p || b.t > p.t)) ? b : p, null as any);
    const prevClose = prevCandidate && (typeof (prevCandidate as any).ac === 'number' ? (prevCandidate as any).ac : (prevCandidate as any).c);
    const icVal = Number.isFinite(Number(prevClose)) ? Number((Number(ip) - Number(prevClose)).toFixed(2)) : 0;
    const ipcVal = Number.isFinite(Number(prevClose)) && Number(prevClose) !== 0 ? Number((((Number(ip) - Number(prevClose)) / Number(prevClose)) * 100).toFixed(2)) : 0;

    if (idx < 0) {
      const newBar: CompactBar = {
        t,
        d: new Date(t).toISOString().slice(0, 10),
        dow,
        o: 0, h: 0, l: 0, c: 0, v: 0, ac: 0, dv: 0, sc: 1,
        ip: Number(ip),
        io: Number(io),
        it: itStr,
        ic: icVal,
        ipc: ipcVal,
        barStatus,
      };
      bars.push(newBar);
      idx = bars.length - 1;
    } else {
      const existing = bars[idx];
      bars[idx] = { ...existing, ip: Number(ip), io: Number(io), it: itStr, ic: icVal, ipc: ipcVal, barStatus } as CompactBar;
    }

    bars.sort((a, b) => a.t - b.t);

    const latestBar = bars[bars.length - 1] ?? null;
    const latestUtcIso = latestBar?.t != null ? new Date(latestBar.t).toISOString() : null;
    const latestEtDateTime = latestBar?.t != null ? formatEtDateTime(latestBar.t) : null;
    const latestIoUtcIso = latestBar?.io != null ? new Date(Number(latestBar.io)).toISOString() : null;
    const latestIoEtDateTime = latestBar?.io != null ? formatEtDateTime(Number(latestBar.io)) : null;
    const version = `${bars[bars.length - 1]?.t ?? ''}-${bars.length}`;

    const finalVersion = version;
    tx.set(yearRef, {
      bars,
      count: bars.length,
      firstBarTs: bars[0]?.t ?? null,
      lastBarTs: bars[bars.length - 1]?.t ?? null,
      latest: latestBar,
      latestUtcIso,
      latestEtDateTime,
      latestIoUtcIso,
      latestIoEtDateTime,
      version: finalVersion,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    console.log(`[upsertAvDailyIntradaySnapshot] Transaction set for ${symbol}, version: ${finalVersion}`);
  });

  console.log(`[upsertAvDailyIntradaySnapshot] Transaction committed for ${symbol} at path: ${yearDocPath}`);
}

/**
 * Shared core logic for upserting W/M intraday snapshot fields into a Firestore doc.
 *
 * Accepts a pre-resolved doc ref and a bar-finder function so the weekly and monthly
 * public wrappers only differ in how they locate the doc and identify the target bar.
 *
 * - Patches ip/io/it/ic/ipc/barStatus only; does not touch OHLCV.
 * - Creates a zero-OHLCV placeholder if no matching bar is found.
 * - Uses a Firestore transaction for safe concurrent writes.
 * - Does not bump parent metadata (avoids churn during trading hours).
 *
 * @param docRef     Firestore DocumentReference for the shard or all-doc.
 * @param findBar    Returns the index of the target bar within `bars`, or -1 if absent.
 * @param marketDate YYYY-MM-DD ET trading date — used as the placeholder bar's anchor.
 * @param ip         Latest intraday price.
 * @param io         Epoch ms of the latest intraday bar timestamp.
 * @param barStatus  Pre-computed barStatus for this tick (-1 | 0).
 * @param label      Short label for console logs (e.g. "weekly week=28", "monthly month=2026-07").
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
  const itStr = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York',
  }).format(new Date(io));
  const placeholderT = new Date(`${marketDate}T00:00:00.000Z`).getTime();

  console.log(`[upsertWmIntradaySnapshotCore] Starting ${label}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const bars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

    const idx = findBar(bars);

    // Find the bar with the highest t strictly less than the target bar's t.
    // # Reason: Using reduce (same pattern as upsertAvDailyIntradaySnapshot) is safe
    // regardless of whether bars are pre-sorted, unlike a slice-based predecessor lookup.
    const targetT = idx >= 0 ? bars[idx].t : placeholderT;
    const prevCandidate = bars.reduce<CompactBar | null>(
      (p, b) => (b.t < targetT && (!p || b.t > p.t)) ? b : p,
      null,
    );

    const prevClose = prevCandidate != null
      ? (typeof (prevCandidate as any).ac === 'number' ? (prevCandidate as any).ac : (prevCandidate as any).c)
      : null;
    const icVal = Number.isFinite(Number(prevClose))
      ? Number((Number(ip) - Number(prevClose)).toFixed(2))
      : 0;
    const ipcVal = Number.isFinite(Number(prevClose)) && Number(prevClose) !== 0
      ? Number((((Number(ip) - Number(prevClose)) / Number(prevClose)) * 100).toFixed(2))
      : 0;

    if (idx >= 0) {
      const existing = bars[idx];
      bars[idx] = { ...existing, ip: Number(ip), io: Number(io), it: itStr, ic: icVal, ipc: ipcVal, barStatus } as CompactBar;
    } else {
      // Create a placeholder bar so charting consumers see a trailing bar immediately.
      // # Reason: If the first PRE of a new period runs before POST has written the AV bar,
      // we create a zero-OHLCV placeholder that will be overwritten by the next POST.
      bars.push({
        t: placeholderT,
        d: marketDate,
        dow: computeDowFromDateString(marketDate),
        o: 0, h: 0, l: 0, c: 0, v: 0, ac: 0, dv: 0, sc: 1,
        ip: Number(ip),
        io: Number(io),
        it: itStr,
        ic: icVal,
        ipc: ipcVal,
        barStatus,
      });
    }

    bars.sort((a, b) => a.t - b.t);

    const latestBar = bars[bars.length - 1] ?? null;
    tx.set(docRef, {
      bars,
      count: bars.length,
      firstBarTs: bars[0]?.t ?? null,
      lastBarTs: latestBar?.t ?? null,
      latest: latestBar,
      latestUtcIso: latestBar?.t != null ? new Date(latestBar.t).toISOString() : null,
      latestEtDateTime: latestBar?.t != null ? formatEtDateTime(latestBar.t) : null,
      version: `${latestBar?.t ?? ''}-${bars.length}`,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });

  console.log(`[upsertWmIntradaySnapshotCore] Committed ${label}`);
}

/**
 * Upsert intraday snapshot fields for the trailing WEEKLY bar, creating a placeholder bar if needed.
 * - Matches the bar whose ISO week contains `marketDate`.
 * - Only sets intraday fields (ip/io/it/ic/ipc) and barStatus; does not touch OHLCV.
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
 * - Only sets intraday fields (ip/io/it/ic/ipc) and barStatus; does not touch OHLCV.
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
