import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import type { CompactBar } from '@shared/alpha-vantage';

import {
  getSymbolTimeSeriesYearDocPath,
  getYearFromEpochMillis,
} from '../../common/firestore/firestore-paths';
import { nextTradingDay, isoWeek } from '../../common/bar-status/bar-status.service';
import { adjustHistoryForBackfill } from '../logic/split-math';
import { computeDowFromDateString, formatEtDateTime, todayEtDate } from './av-firestore-utils';
import { bumpTimeSeriesTopLevelMetadata } from './av-metadata.writer';

/**
 * Upserts a single weekly bar (YYYY-MM-DD) into the WEEKLY year-sharded doc.
 * - Merges, sorts ascending, updates aggregates, and bumps parent metadata
 *
 * @deprecated Use `mergeWeeklyCompactWindowIntoShards()` for weekly compact flows instead.
 * This helper is retained for legacy callers that still perform per-bar weekly upserts.
 *
 * @param options.symbol Stock symbol
 * @param options.date ISO date (UTC week anchor)
 * @param options.patch Partial CompactBar numeric fields to merge
 * @param options.endpoint Defaults to TIME_SERIES_WEEKLY_ADJUSTED
 * @returns Promise that resolves on success
 */
export async function upsertAvWeeklyBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (UTC day)
  patch: Partial<CompactBar>;
  endpoint?: AlphaVantageEndpoint; // defaults to WEEKLY_ADJUSTED
}): Promise<void> {
  const { symbol, date, patch, endpoint = AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED } = options;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const t = new Date(`${date}T00:00:00.000Z`).getTime();
  const y = getYearFromEpochMillis(t);
  const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, y);
  const yearRef = db.doc(yearDocPath);
  const snap = await yearRef.get();
  const bars: CompactBar[] = snap.exists ? (snap.get('bars') ?? []) : [];

  const idx = bars.findIndex((b) => b.t === t);
  if (idx >= 0) {
    const existing = bars[idx];
    const patchBar = {
      o: Number(patch.o ?? existing.o ?? 0),
      h: Number(patch.h ?? existing.h ?? patch.o ?? 0),
      l: Number(patch.l ?? existing.l ?? patch.o ?? 0),
      c: Number(patch.c ?? existing.c ?? 0),
      v: Number(patch.v ?? existing.v ?? 0),
      ac: patch.ac != null ? Number(patch.ac) : (existing.ac != null ? Number(existing.ac) : undefined),
      dv: patch.dv != null ? Number(patch.dv) : (existing.dv != null ? Number(existing.dv) : undefined),
      sc: patch.sc != null ? Number(patch.sc) : (existing.sc != null ? Number(existing.sc) : undefined),
      dow: computeDowFromDateString(new Date(t).toISOString().slice(0, 10)),
    } as Partial<CompactBar> & { o: number; h: number; l: number; c: number; v: number; ac: number; dv: number; sc: number };
    bars[idx] = { ...existing, ...patchBar } as CompactBar;
  } else {
    const newBar: CompactBar = {
      t,
      d: new Date(t).toISOString().slice(0, 10),
      dow: computeDowFromDateString(new Date(t).toISOString().slice(0, 10)),
      o: Number(patch.o ?? 0),
      h: Number(patch.h ?? (patch.o ?? 0)),
      l: Number(patch.l ?? (patch.o ?? 0)),
      c: Number(patch.c ?? 0),
      v: Number(patch.v ?? 0),
      ac: patch.ac != null ? Number(patch.ac) : undefined,
      dv: patch.dv != null ? Number(patch.dv) : undefined,
      sc: patch.sc != null ? Number(patch.sc) : undefined,
      ic: null,
      ipc: null,
    };
    bars.push(newBar);
  }

  // Sort ascending for deterministic writes
  const latestBarW = bars[bars.length - 1] ?? null;
  const latestUtcIsoW = latestBarW?.t != null ? new Date(latestBarW.t).toISOString() : null;
  const latestEtDateTimeW = latestBarW?.t != null ? formatEtDateTime(latestBarW.t) : null;
  bars.sort((a, b) => a.t - b.t);
  await yearRef.set({
    bars,
    count: bars.length,
    firstBarTs: bars[0]?.t ?? null,
    lastBarTs: bars[bars.length - 1]?.t ?? null,
    latest: latestBarW,
    latestUtcIso: latestUtcIsoW,
    latestEtDateTime: latestEtDateTimeW,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  await bumpTimeSeriesTopLevelMetadata({
    symbol,
    endpoint,
    interval: TimeSeriesInterval.WEEKLY,
    latestDate: date,
  });
}

/**
 * Canonical merge path for AV TIME_SERIES_WEEKLY_ADJUSTED compact windows.
 *
 * Semantics:
 * - Sorts the incoming weekly bars by date and considers only the latest AV
 *   bar from the compact window.
 * - Loads the year-sharded SA weekly doc for the year of that AV bar.
 * - If the existing latest bar in that shard falls in the same Monday-based
 *   calendar week as the AV bar, overwrites it; otherwise appends a new bar.
 * - When writing the first bar into a new year shard, also checks the last bar
 *   in the prior-year shard and removes it if it belongs to the same week, so
 *   that the week is represented exactly once across all shards.
 *
 * This enforces a strict one-bar-per-calendar-week invariant for the weekly
 * adjusted series while trusting AV for the bar contents.
 */
export async function mergeWeeklyCompactWindowIntoShards(options: {
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  storageBars: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    adjustedClose?: number;
    dividendAmount?: number;
    splitCoefficient?: number;
  }>;
}): Promise<void> {
  const { symbol, endpoint, storageBars } = options;
  if (!Array.isArray(storageBars) || storageBars.length === 0) {
    return;
  }

  const vendor = ApiProvider.ALPHA_VANTAGE;

  const parseDateYear = (dStr: string): number | null => {
    const ts = new Date(`${dStr}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(ts)) return null;
    return getYearFromEpochMillis(ts);
  };

  const weekStart = (dateStr: string): string => {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    const day = d.getUTCDay(); // 0=Sun,1=Mon,..6=Sat
    const diff = day === 0 ? -6 : 1 - day; // move back to Monday
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  };

  const sameWeek = (d1: string, d2: string): boolean => weekStart(d1) === weekStart(d2);

  // Sort incoming AV weekly bars and take the latest one only.
  const sorted = [...storageBars].sort((a, b) => {
    const ta = new Date(`${a.date}T00:00:00.000Z`).getTime();
    const tb = new Date(`${b.date}T00:00:00.000Z`).getTime();
    return ta - tb;
  });
  const lastAv = sorted[sorted.length - 1];
  const lastAvDate = lastAv.date;
  const lastAvYear = parseDateYear(lastAvDate);
  if (lastAvYear == null) {
    return;
  }

  const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, lastAvYear);
  const ref = db.doc(yearDocPath);
  const snap = await ref.get();
  const existingBars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

  if (!existingBars.length) {
    // This is the first bar for this year shard. We may need to drop an in-progress
    // bar that lives at the end of the prior-year shard but belongs to the same
    // calendar week as lastAvDate.
    const priorYear = lastAvYear - 1;
    if (Number.isFinite(priorYear)) {
      const priorYearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, priorYear);
      const priorRef = db.doc(priorYearDocPath);
      const priorSnap = await priorRef.get();
      if (priorSnap.exists) {
        const priorBars: CompactBar[] = (priorSnap.get('bars') ?? []) as CompactBar[];
        if (priorBars.length) {
          const priorLast = priorBars[priorBars.length - 1];
          const priorLastDate = typeof priorLast.d === 'string' && priorLast.d.length >= 10
            ? priorLast.d.slice(0, 10)
            : (typeof priorLast.t === 'number'
              ? new Date(priorLast.t).toISOString().slice(0, 10)
              : null);

          if (priorLastDate && sameWeek(priorLastDate, lastAvDate)) {
            // Drop the last bar in the prior-year shard; its week will now be
            // represented solely by the bar we are about to write in the new
            // year shard.
            priorBars.pop();

            priorBars.sort((a, b) => a.t - b.t);

            const latestNonPlaceholderPrior = [...priorBars].reverse().find((bar) => {
              const o = Number(bar.o || 0), h = Number(bar.h || 0), l = Number(bar.l || 0), c = Number(bar.c || 0), v = Number(bar.v || 0);
              return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
            }) ?? (priorBars[priorBars.length - 1] ?? null);
            const latestUtcIsoPrior = latestNonPlaceholderPrior?.t != null ? new Date(latestNonPlaceholderPrior.t).toISOString() : null;
            const latestEtDateTimePrior = latestNonPlaceholderPrior?.t != null ? formatEtDateTime(latestNonPlaceholderPrior.t) : null;

            await priorRef.set({
              bars: priorBars,
              count: priorBars.length,
              firstBarTs: priorBars[0]?.t ?? null,
              lastBarTs: priorBars[priorBars.length - 1]?.t ?? null,
              latest: latestNonPlaceholderPrior,
              latestUtcIso: latestUtcIsoPrior,
              latestEtDateTime: latestEtDateTimePrior,
              updatedAt: Timestamp.now(),
            }, { merge: true });
          }
        }
      }
    }

    // We expect backfill to have populated history, but guard anyway.
    const t = new Date(`${lastAvDate}T00:00:00.000Z`).getTime();
    const newBar: CompactBar = {
      t,
      d: lastAvDate,
      dow: computeDowFromDateString(lastAvDate),
      o: Number(lastAv.open),
      h: Number(lastAv.high),
      l: Number(lastAv.low),
      c: Number(lastAv.close),
      v: Number(lastAv.volume),
      ac: lastAv.adjustedClose != null ? Number(lastAv.adjustedClose) : undefined,
      dv: lastAv.dividendAmount != null ? Number(lastAv.dividendAmount) : undefined,
      sc: lastAv.splitCoefficient != null ? Number(lastAv.splitCoefficient) : undefined,
      ic: null,
      ipc: null,
    };
    existingBars.push(newBar);
  } else {
    const lastFs = existingBars[existingBars.length - 1];
    const lastFsDate = typeof lastFs.d === 'string' && lastFs.d.length >= 10
      ? lastFs.d.slice(0, 10)
      : new Date(lastFs.t).toISOString().slice(0, 10);

    const t = new Date(`${lastAvDate}T00:00:00.000Z`).getTime();
    const newBar: CompactBar = {
      t,
      d: lastAvDate,
      dow: computeDowFromDateString(lastAvDate),
      o: Number(lastAv.open),
      h: Number(lastAv.high),
      l: Number(lastAv.low),
      c: Number(lastAv.close),
      v: Number(lastAv.volume),
      ac: lastAv.adjustedClose != null ? Number(lastAv.adjustedClose) : undefined,
      dv: lastAv.dividendAmount != null ? Number(lastAv.dividendAmount) : undefined,
      sc: lastAv.splitCoefficient != null ? Number(lastAv.splitCoefficient) : undefined,
      ic: null,
      ipc: null,
    };

    if (sameWeek(lastFsDate, lastAvDate)) {
      // Same calendar week: overwrite the latest bar with the new AV bar.
      existingBars[existingBars.length - 1] = newBar;
    } else {
      // New week: append the new AV bar.
      existingBars.push(newBar);
    }
  }

  existingBars.sort((a, b) => a.t - b.t);

  // --- APPLY SPLIT ADJUSTMENTS (compact weekly cadence) ---
  // Inject sc from splitHistory onto the bar(s) in the compact window, then
  // run adjustHistoryForBackfill so hybrid split-week bars are corrected.
  // Existing bars already carry correct adjusted values from the last backfill.
  // Reason: AV TIME_SERIES_WEEKLY_ADJUSTED does not provide sc; without injection
  // the backwards-pass has nothing to trigger on and leaves raw OHLC intact.
  try {
    const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
    const symbolSnap = await symbolDocRef.get();
    const rawHistory = (symbolSnap.data()?.splitHistory ?? []) as Array<{ date: string; factor: number }>;

    if (Array.isArray(rawHistory) && rawHistory.length > 0) {
      const history = rawHistory
        .filter(e => typeof e?.date === 'string' && typeof e?.factor === 'number')
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date)); // oldest -> newest

      for (const entry of history) {
        const splitDate = entry.date;
        const factor = entry.factor;
        if (!splitDate || !factor || factor === 1) continue;

        // Find the first bar in this year shard whose period-end date is on/after the split date.
        const idx = existingBars.findIndex(b => {
          const d = (b as any).d as string | undefined;
          return typeof d === 'string' && d >= splitDate;
        });
        if (idx >= 0 && existingBars[idx].sc == null) {
          existingBars[idx] = { ...existingBars[idx], sc: factor };
          console.log('aFH mWCWIS injecting_sc_from_splitHistory', {
            symbol, endpoint, splitDate, factor,
            barDate: (existingBars[idx] as any).d,
          });
        }
      }
    }

    const adjusted = adjustHistoryForBackfill(existingBars);
    existingBars.length = 0;
    existingBars.push(...adjusted);
  } catch (e) {
    console.warn('aFH mWCWIS splitHistory_injection_error', {
      symbol, endpoint, error: String((e as any)?.message || e),
    });
  }
  // ------------------------------------------------

  // Stamp barStatus on the trailing weekly bar after all adjustments are final.
  // POST weekly only: nextTradingDay crossing ISO week boundary → 1 (final), else 0.
  if (existingBars.length) {
    const trailing = existingBars[existingBars.length - 1];
    const trailingDate = typeof trailing.d === 'string' ? trailing.d : new Date(trailing.t).toISOString().slice(0, 10);
    const todayEt = todayEtDate();
    if (trailingDate < todayEt) {
      existingBars[existingBars.length - 1] = { ...trailing, barStatus: 1 };
    } else {
      const nextDay = nextTradingDay(trailingDate);
      existingBars[existingBars.length - 1] = { ...trailing, barStatus: isoWeek(nextDay) !== isoWeek(trailingDate) ? 1 : 0 };
    }
  }

  const latestNonPlaceholder = [...existingBars].reverse().find((bar) => {
    const o = Number(bar.o || 0), h = Number(bar.h || 0), l = Number(bar.l || 0), c = Number(bar.c || 0), v = Number(bar.v || 0);
    return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
  }) ?? (existingBars[existingBars.length - 1] ?? null);
  const latestUtcIso = latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString() : null;
  const latestEtDateTime = latestNonPlaceholder?.t != null ? formatEtDateTime(latestNonPlaceholder.t) : null;

  await ref.set({
    bars: existingBars,
    count: existingBars.length,
    firstBarTs: existingBars[0]?.t ?? null,
    lastBarTs: existingBars[existingBars.length - 1]?.t ?? null,
    latest: latestNonPlaceholder,
    latestUtcIso,
    latestEtDateTime,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  const latestDateForMeta = typeof latestNonPlaceholder?.d === 'string' && latestNonPlaceholder.d.length >= 10
    ? latestNonPlaceholder.d
    : (latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString().slice(0, 10) : null);

  if (latestDateForMeta) {
    await bumpTimeSeriesTopLevelMetadata({
      symbol,
      endpoint,
      interval: TimeSeriesInterval.WEEKLY,
      latestDate: latestDateForMeta,
    });
  }
}
