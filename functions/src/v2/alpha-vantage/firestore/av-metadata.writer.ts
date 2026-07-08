import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, AV_TIME_SERIES_ENDPOINT_CONFIGS, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import {
  getSymbolTimeSeriesDocPath,
  getSymbolTimeSeriesAllDocPath,
  getSymbolTimeSeriesYearDocPath,
} from '../../common/firestore/firestore-paths';

/**
 * Bump the top-level time-series metadata for console visibility after a write.
 *
 * Semantics:
 * - Always sets `lastUpdated`, `nextRefreshAt`, `ttlSeconds`, `vendor`, and `endpoint`.
 * - For DAILY/WEEKLY: derives `histStartTs`, `histEndTs`, and `availableYears` from the
 *   underlying `years/{YYYY}` shards when present.
 * - For MONTHLY: derives bounds and `availableYears` from the raw monthly `all` doc bars.
 * - Falls back to `latestDate` when no bars are found (e.g., first write or partial series).
 * - Writes `histStartDate`/`histEndDate` (Timestamp), `histStartTs`/`histEndTs` (ms),
 *   and `availableYears` when derivable, plus `latestBarTimestamp` aligned to `histEndTs`.
 *
 * This function is the canonical way writers keep parent time-series metadata in sync with
 * the actual stored bar arrays, and is used by daily upserts, weekly/monthly merges, and
 * repair tooling.
 *
 * @param options.symbol Stock symbol
 * @param options.endpoint AV endpoint id
 * @param options.interval TimeSeriesInterval
 * @param options.latestDate ISO date used as a fallback for histStartTs/EndTs
 * @param options.vendor Optional provider (defaults AV)
 * @returns Promise that resolves on success
 */
export async function bumpTimeSeriesTopLevelMetadata(options: {
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  interval: TimeSeriesInterval;
  latestDate: string; // YYYY-MM-DD (UTC)
  vendor?: ApiProvider;
}): Promise<void> {
  const { symbol, endpoint, interval, latestDate, vendor = ApiProvider.ALPHA_VANTAGE } = options;
  try {
    const endpointConfig = AV_TIME_SERIES_ENDPOINT_CONFIGS[endpoint];
    if (!endpointConfig || typeof endpointConfig.ttl !== 'number') {
      throw new Error(`bumpTSMeta ttl missing for endpoint=${endpoint}`);
    }
    const ttlSeconds = endpointConfig.ttl;
    // Time-series job pipeline now treats the split-adjusted series as canonical.
    // Use the adjusted series doc as the parent for metadata.
    const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, vendor);
    const docRef = db.doc(docPath);
    const latestTsFromDate = new Date(`${latestDate}T00:00:00.000Z`).getTime();

    // Derive histStartTs, histEndTs, and availableYears from actual shards/all-doc when possible.
    let histStartTs: number | null = null;
    let histEndTs: number | null = null;
    let availableYears: number[] = [];

    if (interval === TimeSeriesInterval.MONTHLY) {
      // Use the adjusted monthly all-doc as the source of truth for date bounds/years.
      const allPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor);
      const allSnap = await db.doc(allPath).get();
      if (allSnap.exists) {
        const data = allSnap.data() as any;
        const bars: Array<{ t?: number }> = Array.isArray(data?.bars) ? data.bars : [];
        if (bars.length) {
          const first = bars[0];
          const last = bars[bars.length - 1];
          const firstTs = typeof first?.t === 'number' ? first.t : NaN;
          const lastTs = typeof last?.t === 'number' ? last.t : NaN;
          if (Number.isFinite(firstTs)) histStartTs = firstTs;
          if (Number.isFinite(lastTs)) histEndTs = lastTs;
          const yearSet = new Set<number>();
          for (const b of bars) {
            const t = typeof b?.t === 'number' ? b.t : NaN;
            if (!Number.isFinite(t)) continue;
            const y = new Date(t).getUTCFullYear();
            if (Number.isFinite(y)) yearSet.add(y);
          }
          availableYears = Array.from(yearSet).sort((a, b) => a - b);
        }
      }
    } else {
      // Daily/Weekly: inspect the adjusted years subcollection and derive bounds from earliest/latest year shards.
      const yearsColPath = `${docPath}/years`;
      const yearsSnap = await db.collection(yearsColPath).get();
      const years = yearsSnap.docs.map(d => Number(d.id)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
      if (years.length) {
        availableYears = years;
        const earliestYear = years[0];
        const latestYear = years[years.length - 1];

        const earliestPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, earliestYear);
        const latestPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, latestYear);
        const [earliestSnap, latestSnap] = await Promise.all([
          db.doc(earliestPath).get(),
          db.doc(latestPath).get(),
        ]);

        if (earliestSnap.exists) {
          const eData = earliestSnap.data() as any;
          const eBars: Array<{ t?: number }> = Array.isArray(eData?.bars) ? eData.bars : [];
          if (eBars.length) {
            const first = eBars[0];
            const firstTs = typeof first?.t === 'number' ? first.t : NaN;
            if (Number.isFinite(firstTs)) histStartTs = firstTs;
          }
        }

        if (latestSnap.exists) {
          const lData = latestSnap.data() as any;
          const lBars: Array<{ t?: number }> = Array.isArray(lData?.bars) ? lData.bars : [];
          if (lBars.length) {
            const last = lBars[lBars.length - 1];
            const lastTs = typeof last?.t === 'number' ? last.t : NaN;
            if (Number.isFinite(lastTs)) histEndTs = lastTs;
          }
        }
      }
    }

    // Fallbacks: if we couldn't derive bounds from shards, fall back to latestDate when valid.
    if (!Number.isFinite(histStartTs as number) && Number.isFinite(latestTsFromDate)) {
      histStartTs = latestTsFromDate;
    }
    if (!Number.isFinite(histEndTs as number) && Number.isFinite(latestTsFromDate)) {
      histEndTs = latestTsFromDate;
    }

    const now = Timestamp.now();
    // Coarse next-run indicator: approx next day. This matches the adjusted
    // writer path and keeps metadata consistent for live compact updates.
    const nextPostRunAt = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

    const payload: any = {
      metadata: {
        symbol,
        interval,
        lastUpdated: now,
        nextRefreshAt: nextPostRunAt,
        ttlSeconds,
        vendor,
        endpoint,
        histEndDate: Number.isFinite(histEndTs as number) ? Timestamp.fromMillis(histEndTs as number) : null,
        histEndTs: Number.isFinite(histEndTs as number) ? histEndTs : null,
      },
      latestBarTimestamp: Number.isFinite(histEndTs as number) ? Timestamp.fromMillis(histEndTs as number) : null,
    };

    if (Number.isFinite(histStartTs as number)) {
      (payload.metadata as any).histStartTs = histStartTs;
      (payload.metadata as any).histStartDate = Timestamp.fromMillis(histStartTs as number);
    }
    if (Array.isArray(availableYears) && availableYears.length) {
      (payload.metadata as any).availableYears = availableYears;
    }

    await docRef.set(payload, { merge: true });

    // Also hydrate symbol-data so live compact updates maintain the same
    // presence/metadata expectations as full writes.
    const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
    await symbolDocRef.set({
      nextRefreshAt: nextPostRunAt,
      nextRefreshBy: '',
      refreshedAt: now,
      refreshedBy: 'time-series-write',
    }, { merge: true });
  } catch (e: any) {
    console.error('bumpTSMeta error', String(e?.message || e));
  }
}
