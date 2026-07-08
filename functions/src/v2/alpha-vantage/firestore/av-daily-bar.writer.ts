import { db } from '../../../firebase-admin-init';
import { getFunctions } from 'firebase-admin/functions';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import type { CompactBar } from '@shared/alpha-vantage';

import type { SplitRemediationPayload } from '../tasks/split-remediator.task';
import {
  getSymbolTimeSeriesDocPath,
  getSymbolTimeSeriesYearDocPath,
  getYearFromEpochMillis,
} from '../../common/firestore/firestore-paths';
import { createLogger } from '../../utils/utils';
import { CloudTask } from '../../common/constants';
import { computeDowFromDateString, formatEtDateTime, computeChCpForTargetIndex } from './av-firestore-utils';
import { bumpTimeSeriesTopLevelMetadata } from './av-metadata.writer';

const log = createLogger('av-daily-bar.writer');

/**
 * Internal helper for upserting daily bars to split-adjusted collection.
 * @param options.symbol Stock symbol
 * @param options.date YYYY-MM-DD (UTC day)
 * @param options.patch Partial CompactBar numeric fields to merge
 * @param options.endpoint Defaults to TIME_SERIES_DAILY_ADJUSTED
 * @param options.skipParentMetaBump When true, skips bumping parent metadata (used for pre-close flows)
 * @param options.finalizedAtMs Epoch ms when the daily bar first finalized (POST)
 */
async function _internalUpsertDailyBar(
  options: {
    symbol: string;
    date: string; // YYYY-MM-DD (UTC day)
    patch: Partial<CompactBar>;
    endpoint?: AlphaVantageEndpoint; // defaults to DAILY_ADJUSTED
    skipParentMetaBump?: boolean;
    finalizedAtMs?: number;
  },
): Promise<void> {
  const { symbol, date, patch, endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, skipParentMetaBump, finalizedAtMs } = options;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const t = new Date(`${date}T00:00:00.000Z`).getTime();
  const y = getYearFromEpochMillis(t);
  const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, y);
  const yearRef = db.doc(yearDocPath);
  const metaDocPath = getSymbolTimeSeriesDocPath(symbol, endpoint, vendor);
  const metaRef = db.doc(metaDocPath);

  let pendingRemediation: SplitRemediationPayload | null = null;

  // Transactional upsert to avoid races
  await db.runTransaction(async (tx) => {
    // 1. Load both year shard and top-level metadata (for split idempotency)
    const [snap, metaSnap] = await Promise.all([
      tx.get(yearRef),
      tx.get(metaRef)
    ]);

    const bars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

    const idx = bars.findIndex((b) => b.t === t);
    if (idx >= 0) {
      const existing = bars[idx];
      const io = patch.io != null ? patch.io : existing.io;
      const it = io != null && Number.isFinite(io)
        ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(io))
        : existing.it;
      const patchBar = {
        o: Number(patch.o ?? existing.o ?? 0),
        h: Number(patch.h ?? existing.h ?? patch.o ?? 0),
        l: Number(patch.l ?? existing.l ?? patch.o ?? 0),
        c: Number(patch.c ?? existing.c ?? 0),
        v: Number(patch.v ?? existing.v ?? 0),
        // Persist adjusted series fields only when explicitly provided; do not fallback to close/0/1
        ac: patch.ac != null ? Number(patch.ac) : (existing.ac != null ? Number(existing.ac) : undefined),
        dv: patch.dv != null ? Number(patch.dv) : (existing.dv != null ? Number(existing.dv) : undefined),
        sc: patch.sc != null ? Number(patch.sc) : (existing.sc != null ? Number(existing.sc) : undefined),
        ip: patch.ip != null ? Number(patch.ip) : existing.ip,
        io,
        it,
        ic: patch.ic != null ? Number(patch.ic) : ((existing as any).ic ?? null),
        ipc: patch.ipc != null ? Number(patch.ipc) : ((existing as any).ipc ?? null),
        dow: computeDowFromDateString(new Date(t).toISOString().slice(0, 10)),
      } as Partial<CompactBar> & { o: number; h: number; l: number; c: number; v: number; ac: number; dv: number; sc: number };
      const merged = { ...existing, ...patchBar } as CompactBar;

      // --- Split Remediation Logic ---
      // Only triggered for the split-adjusted collection
      const isSplitEvent = patch.sc !== undefined && patch.sc !== 1;
      if (isSplitEvent) {
        const metaData = metaSnap.data()?.metadata || {};
        const lastProcessed = metaData.latestSplitDateProcessed;

        // If we haven't processed this split date yet
        if (lastProcessed !== date) {
          console.log(`aFH sATSD Split Detected! ${symbol} ${date} factor=${patch.sc}`);
          // Update metadata to claim this split immediately prevents double-enqueuing
          tx.set(metaRef, {
            metadata: { latestSplitDateProcessed: date }
          }, { merge: true });

          // Record the event globally for audit/analytics (Dr. Reed's Recommendation)
          const splitDocId = `${date}-${symbol}-${patch.sc}`;
          const splitDocRef = db.collection(FirestoreCollection.SPLIT_EVENTS).doc(splitDocId);
          tx.set(splitDocRef, {
            symbol,
            date,
            factor: Number(patch.sc),
            detectedAt: Timestamp.now(),
            status: 'ENQUEUED'
          }, { merge: true });

          // Also persist to symbol-data/{symbol} (Local History)
          const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
          tx.set(symbolDocRef, {
            splitHistory: FieldValue.arrayUnion({
              date,
              factor: Number(patch.sc),
              detectedAt: Timestamp.now()
            })
          }, { merge: true });

          // Prepare payload for post-transaction dispatch
          pendingRemediation = {
            symbol,
            splitDate: date,
            splitFactor: Number(patch.sc)
          };
        }
      }
      // -------------------------------

      // Stamp fz if provided and not yet set, and bar is non-placeholder
      if (finalizedAtMs != null && (merged as any).fz == null) {
        const oo = Number(merged.o || 0), hh = Number(merged.h || 0), ll = Number(merged.l || 0), cc = Number(merged.c || 0);
        const nonPlaceholder = (oo !== 0) || (hh !== 0) || (ll !== 0) || (cc !== 0);
        if (nonPlaceholder) (merged as any).fz = Number(finalizedAtMs);
      }
      // POST daily bar is always final
      if (finalizedAtMs != null) merged.barStatus = 1;
      bars[idx] = merged;
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
        pc: patch.pc != null ? Number(patch.pc) : undefined,
        ch: patch.ch != null ? Number(patch.ch) : undefined,
        cp: patch.cp != null ? Number(patch.cp) : undefined,
        ip: patch.ip != null ? Number(patch.ip) : undefined,
        io: patch.io,
        it: patch.io != null && Number.isFinite(patch.io)
          ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(patch.io))
          : undefined,
        ic: patch.ic != null ? Number(patch.ic) : null,
        ipc: patch.ipc != null ? Number(patch.ipc) : null,
        barStatus: finalizedAtMs != null ? 1 : undefined,
      };
      if (finalizedAtMs != null) {
        const oo = Number(newBar.o || 0), hh = Number(newBar.h || 0), ll = Number(newBar.l || 0), cc = Number(newBar.c || 0);
        const nonPlaceholder = (oo !== 0) || (hh !== 0) || (ll !== 0) || (cc !== 0);
        if (nonPlaceholder) (newBar as any).fz = Number(finalizedAtMs);
      }
      bars.push(newBar);

      // --- Split Remediation Logic (New Bar) ---
      const isSplitEvent = patch.sc !== undefined && patch.sc !== 1;
      if (isSplitEvent) {
        const metaData = metaSnap.data()?.metadata || {};
        const lastProcessed = metaData.latestSplitDateProcessed;

        if (lastProcessed !== date) {
          console.log(`aFH sATSD Split Detected (New)! ${symbol} ${date} factor=${patch.sc}`);
          tx.set(metaRef, {
            metadata: { latestSplitDateProcessed: date }
          }, { merge: true });

          const splitDocId = `${date}-${symbol}-${patch.sc}`;
          const splitDocRef = db.collection(FirestoreCollection.SPLIT_EVENTS).doc(splitDocId);
          tx.set(splitDocRef, {
            symbol,
            date,
            factor: Number(patch.sc),
            detectedAt: Timestamp.now(),
            status: 'ENQUEUED'
          }, { merge: true });

          // Also persist to symbol-data/{symbol} (Local History)
          const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
          tx.set(symbolDocRef, {
            splitHistory: FieldValue.arrayUnion({
              date,
              factor: Number(patch.sc),
              detectedAt: Timestamp.now()
            })
          }, { merge: true });

          pendingRemediation = {
            symbol,
            splitDate: date,
            splitFactor: Number(patch.sc)
          };
        }
      }
      // -----------------------------------------
    }

    bars.sort((a, b) => a.t - b.t);

    const targetIdx = bars.findIndex((b) => b.t === t);
    if (targetIdx >= 0) {
      // Re-hydrate baseline using current snapshot to ensure latest persisted refs
      computeChCpForTargetIndex(bars, targetIdx);
    }

    const latestNonPlaceholder = [...bars].reverse().find(b => {
      const o = Number(b.o || 0), h = Number(b.h || 0), l = Number(b.l || 0), c = Number(b.c || 0), v = Number(b.v || 0);
      return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
    }) ?? (bars[bars.length - 1] ?? null);
    const latestUtcIso = latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString() : null;
    const latestEtDateTime = latestNonPlaceholder?.t != null ? formatEtDateTime(latestNonPlaceholder.t) : null;
    const latestIoMs = bars.reduce<number | null>((max, b) => {
      const io = b?.io != null ? Number(b.io) : NaN;
      return Number.isFinite(io) ? (max == null ? io : Math.max(max, io)) : max;
    }, null as any);
    const latestIoUtcIso = latestIoMs != null ? new Date(Number(latestIoMs)).toISOString() : null;
    const latestIoEtDateTime = latestIoMs != null ? formatEtDateTime(Number(latestIoMs)) : null;
    const version = `${bars[bars.length - 1]?.t ?? ''}-${bars.length}`;

    tx.set(yearRef, {
      bars,
      count: bars.length,
      firstBarTs: bars[0]?.t ?? null,
      // Persist lastBarTs as the epoch millis (t) of the last bar, not the full bar object
      lastBarTs: bars[bars.length - 1]?.t ?? null,
      latest: latestNonPlaceholder,
      latestUtcIso,
      latestEtDateTime,
      latestIoUtcIso,
      latestIoEtDateTime,
      version,
      updatedAt: Timestamp.now(),
    }, { merge: true });

  });

  // Dispatch task if needed (outside transaction)
  if (pendingRemediation) {
    try {
      const queue = getFunctions().taskQueue(CloudTask.REMEDIATE_SPLIT_HISTORY);
      await queue.enqueue(pendingRemediation);
      log.info('daily.upsert.remediation_enqueued', pendingRemediation);
    } catch (err) {
      log.error('daily.upsert.remediation_failed', { error: String(err), ...(pendingRemediation as SplitRemediationPayload) });
      // Non-fatal for the daily upsert, but critical for history consistency.
      // TODO: Consider alerting here.
    }
  }

  if (!skipParentMetaBump) {
    await bumpTimeSeriesTopLevelMetadata({
      symbol,
      endpoint,
      interval: TimeSeriesInterval.DAILY,
      latestDate: date,
    });
  }
}

/**
 * Upserts a single daily bar (YYYY-MM-DD) into the DAILY year-sharded doc.
 * - Merges required numeric fields, preserves intraday fields, sorts ascending and updates aggregates
 * - Recomputes ch/cp for the target bar using the previous day's adjusted close (fallback close)
 * - Optionally skips bumping the parent top-level series metadata (for intraday pre-close flows)
 * @param options.symbol Stock symbol
 * @param options.date ISO date (UTC day)
 * @param options.patch Partial CompactBar numeric fields to merge
 * @param options.endpoint Defaults to TIME_SERIES_DAILY_ADJUSTED
 * @param options.skipParentMetaBump When true, do not bump the top-level time-series metadata
 * @returns Promise that resolves on success
 */
export async function upsertAvDailyBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (UTC day)
  patch: Partial<CompactBar>;
  endpoint?: AlphaVantageEndpoint; // defaults to DAILY_ADJUSTED
  skipParentMetaBump?: boolean;
  finalizedAtMs?: number;
}): Promise<void> {
  // Adjusted-only: write exclusively to sa-time-series.
  await _internalUpsertDailyBar(options);
}

/**
 * Fetch the previous trading day's adjusted close for a symbol/endpoint by reading the year docs.
 * - Searches current and previous year docs for the latest bar with t < current day
 * - Returns ac if present, else c; null if not found
 * @param options.symbol Stock symbol
 * @param options.date Current trading day (YYYY-MM-DD UTC)
 * @param options.endpoint Defaults to TIME_SERIES_DAILY_ADJUSTED
 * @returns Previous adjusted close number or null
 */
export async function getPreviousAdjustedClose(options: {
  symbol: string;
  date: string; // YYYY-MM-DD UTC current trading day
  endpoint?: AlphaVantageEndpoint; // defaults to DAILY_ADJUSTED
}): Promise<number | null> {
  const { symbol, date, endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED } = options;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  // Current day midnight UTC and year docs to check
  const currTs = new Date(`${date}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(currTs)) return null;
  const currYear = getYearFromEpochMillis(currTs);
  const prevYear = currYear - 1;
  const paths = [
    getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, currYear),
    getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, prevYear),
  ];
  let candidate: CompactBar | null = null;
  for (const path of paths) {
    const ref = db.doc(path);
    const snap = await ref.get();
    const bars: CompactBar[] = snap.exists ? (snap.get('bars') ?? []) : [];
    if (!Array.isArray(bars) || bars.length === 0) continue;
    // Bars are persisted sorted ascending by t.
    // We want the most recent prior trading day: last bar with t < currTs.
    for (let i = bars.length - 1; i >= 0; i--) {
      const bt = bars[i]?.t;
      if (typeof bt !== 'number') continue;
      if (bt < currTs) {
        candidate = bars[i];
        break;
      }
    }
    if (candidate) break; // found in current year; no need to check prior year
  }
  if (!candidate) return null;
  if (typeof candidate.ac === 'number' && Number.isFinite(candidate.ac)) return candidate.ac;
  if (typeof candidate.c === 'number' && Number.isFinite(candidate.c)) return candidate.c;
  return null;
}
