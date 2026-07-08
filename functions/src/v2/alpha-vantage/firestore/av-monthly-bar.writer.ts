import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import type { CompactBar } from '@shared/alpha-vantage';

import {
  getSymbolTimeSeriesAllDocPath,
} from '../../common/firestore/firestore-paths';
import { nextTradingDay, monthOf } from '../../common/bar-status/bar-status.service';
import { adjustHistoryForBackfill } from '../logic/split-math';
import { computeDowFromDateString, formatEtDateTime, todayEtDate } from './av-firestore-utils';
import { bumpTimeSeriesTopLevelMetadata } from './av-metadata.writer';

/**
 * Upserts a single monthly bar (YYYY-MM-DD) into the MONTHLY single `all` doc.
 * - Merges, sorts ascending, updates aggregates, and bumps parent metadata
 *
 * @deprecated Use `mergeMonthlyCompactWindowIntoAllDocs()` for monthly compact flows instead.
 * This helper is retained for legacy callers that still perform per-bar monthly upserts.
 *
 * @param options.symbol Stock symbol
 * @param options.date ISO date (UTC month anchor)
 * @param options.patch Partial CompactBar numeric fields to merge
 * @param options.endpoint Defaults to TIME_SERIES_MONTHLY_ADJUSTED
 * @returns Promise that resolves on success
 */
export async function upsertAvMonthlyBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (UTC day)
  patch: Partial<CompactBar>;
  endpoint?: AlphaVantageEndpoint; // defaults to MONTHLY_ADJUSTED
}): Promise<void> {
  const { symbol, date, patch, endpoint = AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED } = options;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor);
  const allRef = db.doc(allDocPath);
  const snap = await allRef.get();
  const bars: CompactBar[] = snap.exists ? (snap.get('bars') ?? []) : [];
  const t = new Date(`${date}T00:00:00.000Z`).getTime();

  const idx = bars.findIndex((b) => b.t === t);
  if (idx >= 0) {
    const existing = bars[idx];
    const patchBar = {
      o: Number(patch.o ?? existing.o ?? 0),
      h: Number(patch.h ?? existing.h ?? patch.o ?? 0),
      l: Number(patch.l ?? existing.l ?? patch.o ?? 0),
      c: Number(patch.c ?? existing.c ?? 0),
      v: Number(patch.v ?? existing.v ?? 0),
      ac: Number(patch.ac ?? existing.ac ?? patch.c ?? existing.c ?? 0),
      dv: Number(patch.dv ?? existing.dv ?? 0),
      sc: Number(patch.sc ?? existing.sc ?? 1),
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
      ac: Number(patch.ac ?? patch.c ?? 0),
      dv: Number(patch.dv ?? 0),
      sc: Number(patch.sc ?? 1),
      ic: null,
      ipc: null,
    };
    bars.push(newBar);
  }

  // Sort ascending for deterministic writes
  const latestBarM = bars[bars.length - 1] ?? null;
  const latestUtcIsoM = latestBarM?.t != null ? new Date(latestBarM.t).toISOString() : null;
  const latestEtDateTimeM = latestBarM?.t != null ? formatEtDateTime(latestBarM.t) : null;
  bars.sort((a, b) => a.t - b.t);
  await allRef.set({
    bars,
    count: bars.length,
    firstBarTs: bars[0]?.t ?? null,
    lastBarTs: bars[bars.length - 1]?.t ?? null,
    latest: latestBarM,
    latestUtcIso: latestUtcIsoM,
    latestEtDateTime: latestEtDateTimeM,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  await bumpTimeSeriesTopLevelMetadata({
    symbol,
    endpoint,
    interval: TimeSeriesInterval.MONTHLY,
    latestDate: date,
  });
}

/**
 * Merge a compact MONTHLY window into the single monthly `all` doc.
 *
 * Semantics:
 * - Uses a date key (YYYY-MM-DD) per bar and merges incoming bars into an in-memory map
 *   keyed by trading date.
 * - For each date in the compact window, replaces or inserts that month in the `all` doc.
 * - Preserves existing months outside the compact window.
 * - Runs only for the split-adjusted series (`sa-time-series`).
 * - Keeps `bars` sorted ascending by `t` and refreshes count/first/last/`latest*` fields.
 * - After writes, bumps the top-level MONTHLY metadata via `bumpTimeSeriesTopLevelMetadata`.
 */
export async function mergeMonthlyCompactWindowIntoAllDocs(options: {
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

  const ensureDate = (bar: CompactBar): string => {
    if (typeof bar.d === 'string' && bar.d.length >= 10) {
      return bar.d.slice(0, 10);
    }
    if (typeof bar.t === 'number') {
      return new Date(bar.t).toISOString().slice(0, 10);
    }
    return '';
  };

  let latestDateForMeta: string | null = null;

  // Adjusted-only: write exclusively to sa-time-series.
  const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor);
  const ref = db.doc(allDocPath);
  const snap = await ref.get();
  const existingBars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

  const map = new Map<string, CompactBar>();
  for (const bar of existingBars) {
    const dStr = ensureDate(bar);
    if (!dStr) continue;
    map.set(dStr, bar);
  }

  // Limit writes to a small tip window to avoid rewriting the full compact
  // history on every run. For MONTHLY we overwrite only the last 2 bars using
  // AV as the source of truth, preserving all older history when present.
  const WINDOW_SIZE = 2;
  const sortedStorageBars = [...storageBars].sort((a, b) => {
    const ta = new Date(`${a.date}T00:00:00.000Z`).getTime();
    const tb = new Date(`${b.date}T00:00:00.000Z`).getTime();
    return ta - tb;
  });
  const windowBars = sortedStorageBars.slice(-WINDOW_SIZE);

  for (const b of windowBars) {
    const t = new Date(`${b.date}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(t)) continue;
    const dStr = new Date(t).toISOString().slice(0, 10);

    // Enforce a single bar per calendar month: before inserting this bar
    // for YYYY-MM, remove any existing entries in the same month so only
    // the latest monthly bar (from AV) is retained.
    const monthKey = dStr.slice(0, 7); // YYYY-MM
    for (const [k] of map) {
      if (k.slice(0, 7) === monthKey) {
        map.delete(k);
      }
    }

    const existing = map.get(dStr);
    const dow = computeDowFromDateString(dStr);

    const merged: CompactBar = {
      ...(existing ?? {} as CompactBar),
      t,
      d: dStr,
      dow,
      o: Number(b.open),
      h: Number(b.high),
      l: Number(b.low),
      c: Number(b.close),
      v: Number(b.volume),
      ac: b.adjustedClose != null ? Number(b.adjustedClose) : (existing?.ac),
      dv: b.dividendAmount != null ? Number(b.dividendAmount) : (existing?.dv),
      sc: b.splitCoefficient != null ? Number(b.splitCoefficient) : (existing?.sc),
      ic: existing?.ic ?? null,
      ipc: existing?.ipc ?? null,
    } as CompactBar;

    map.set(dStr, merged);
  }

  const mergedBars = Array.from(map.values());
  if (mergedBars.length === 0) {
    return;
  }

  mergedBars.sort((a, b) => a.t - b.t);

  // --- APPLY SPLIT ADJUSTMENTS (compact monthly cadence) ---
  // Inject sc from splitHistory onto the bar(s) in the compact window, then
  // run adjustHistoryForBackfill so hybrid split-month bars are corrected.
  // Existing bars already carry correct adjusted values from the last backfill.
  // Reason: AV TIME_SERIES_MONTHLY_ADJUSTED does not provide sc; without injection
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

        // Find the first bar in the all-doc whose period-end date is on/after the split date.
        const idx = mergedBars.findIndex(b => {
          const d = (b as any).d as string | undefined;
          return typeof d === 'string' && d >= splitDate;
        });
        if (idx >= 0 && mergedBars[idx].sc == null) {
          mergedBars[idx] = { ...mergedBars[idx], sc: factor };
          console.log('aFH mMCWIAD injecting_sc_from_splitHistory', {
            symbol, endpoint, splitDate, factor,
            barDate: (mergedBars[idx] as any).d,
          });
        }
      }
    }

    const adjusted = adjustHistoryForBackfill(mergedBars);
    mergedBars.length = 0;
    mergedBars.push(...adjusted);
  } catch (e) {
    console.warn('aFH mMCWIAD splitHistory_injection_error', {
      symbol, endpoint, error: String((e as any)?.message || e),
    });
  }
  // ------------------------------------------------

  // Stamp barStatus on the trailing monthly bar after all adjustments are final.
  // POST monthly only: nextTradingDay crossing a month boundary → 1 (final), else 0.
  if (mergedBars.length) {
    const trailing = mergedBars[mergedBars.length - 1];
    const trailingDate = typeof trailing.d === 'string' ? trailing.d : new Date(trailing.t).toISOString().slice(0, 10);
    const todayEt = todayEtDate();
    if (trailingDate < todayEt) {
      mergedBars[mergedBars.length - 1] = { ...trailing, barStatus: 1 };
    } else {
      const nextDay = nextTradingDay(trailingDate);
      mergedBars[mergedBars.length - 1] = { ...trailing, barStatus: monthOf(nextDay) !== monthOf(trailingDate) ? 1 : 0 };
    }
  }

  const latestNonPlaceholder = [...mergedBars].reverse().find((bar) => {
    const o = Number(bar.o || 0), h = Number(bar.h || 0), l = Number(bar.l || 0), c = Number(bar.c || 0), v = Number(bar.v || 0);
    return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
  }) ?? (mergedBars[mergedBars.length - 1] ?? null);
  const latestUtcIso = latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString() : null;
  const latestEtDateTime = latestNonPlaceholder?.t != null ? formatEtDateTime(latestNonPlaceholder.t).toString() : null;

  await ref.set({
    bars: mergedBars,
    count: mergedBars.length,
    firstBarTs: mergedBars[0]?.t ?? null,
    lastBarTs: mergedBars[mergedBars.length - 1]?.t ?? null,
    latest: latestNonPlaceholder,
    latestUtcIso,
    latestEtDateTime,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  // Use latest date from mergedBars for top-level metadata.
  const last = mergedBars[mergedBars.length - 1];
  const dLast = typeof last.d === 'string' && last.d.length >= 10
    ? last.d
    : new Date(last.t).toISOString().slice(0, 10);
  latestDateForMeta = dLast;

  if (latestDateForMeta) {
    await bumpTimeSeriesTopLevelMetadata({
      symbol,
      endpoint,
      interval: TimeSeriesInterval.MONTHLY,
      latestDate: latestDateForMeta,
    });
  }
}
