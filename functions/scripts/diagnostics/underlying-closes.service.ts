/**
 * Shared service for fetching and looking up underlying daily close prices
 * from Firestore. Used by scan-data-quality.ts and classify-zero-drops.ts.
 */

import { admin } from '../../src/firebase-admin-init';
import { ApiProvider } from '@shared/core';
import { AlphaVantageEndpoint, type CompactBar } from '@shared/alpha-vantage';
import { getSymbolTimeSeriesYearDocPath } from '../../src/v2/common/firestore/firestore-paths';

/** Map of symbol → (ISO date → underlying close price). */
export type UnderlyingCloses = Map<string, Map<string, number>>;

/** Minimal shape of a year-sharded daily adjusted Firestore document. */
interface TimeSeriesYearDoc {
  bars?: CompactBar[];
}

/**
 * Loads daily adjusted close prices from Firestore for a symbol.
 * Returns a map of ISO date → close price.
 */
export async function fetchUnderlyingCloses(
  symbol: string,
  years: number[],
): Promise<Map<string, number>> {
  const db = admin.firestore();
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED;
  const closeMap = new Map<string, number>();

  const yearDocs = await Promise.all(
    years.map((y) =>
      db.doc(getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, y)).get(),
    ),
  );

  for (const snap of yearDocs) {
    if (!snap.exists) continue;
    const data = snap.data() as TimeSeriesYearDoc | undefined;
    const bars: CompactBar[] = Array.isArray(data?.bars) ? data.bars : [];
    for (const bar of bars) {
      if (bar.t && bar.c != null) {
        const iso = new Date(bar.t).toISOString().slice(0, 10);
        closeMap.set(iso, Number(bar.c));
      }
    }
  }

  return closeMap;
}

/**
 * Looks up the close price for a date, falling back to the nearest
 * preceding trading day (up to 5 calendar days back).
 */
export function lookupUnderlyingClose(
  closeMap: Map<string, number>,
  date: string,
): number | null {
  const exact = closeMap.get(date);
  if (exact != null) return exact;

  // # Reason: Options data may reference a date where the underlying
  // has no bar (e.g., early data gap). Walk backwards up to 5 calendar
  // days to find the nearest preceding close.
  const ts = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(ts)) return null;

  for (let offset = 1; offset <= 5; offset++) {
    const prev = new Date(ts - offset * 86_400_000).toISOString().slice(0, 10);
    const close = closeMap.get(prev);
    if (close != null) return close;
  }

  return null;
}
