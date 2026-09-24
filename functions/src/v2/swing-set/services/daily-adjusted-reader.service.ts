/**
 * DailyAdjustedReader — reads year-sharded daily-adjusted bars from
 * `symbol-data/{SYMBOL}/sa-time-series/av-daily-adjusted/years/{YYYY}`
 * and maps them to `DailyAdjustedBar[]` (adapter input) and `PriceBar[]`
 * (engine input).
 *
 * Interim bars are skipped: barStatus -1/0 marks a PRE/in-progress bar, and
 * finalized history always carries barStatus 1. Missing h/l/c are also
 * skipped rather than defaulted. Ascending date order across all shards.
 */
import type { CompactBar } from '@shared/alpha-vantage';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import type { DailyAdjustedBar, PriceBar } from '@shared/zigzag';
import { getSymbolTimeSeriesYearsCollectionPath } from '../../common/firestore/firestore-paths';
import type { FirestoreLike } from '../../common/firestore/firestore-like';

export class DailyAdjustedReader {
  constructor(private readonly db: FirestoreLike) {}

  async read(symbol: string): Promise<DailyAdjustedBar[]> {
    const yearsPath = getSymbolTimeSeriesYearsCollectionPath(
      symbol,
      AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
      ApiProvider.ALPHA_VANTAGE,
    );
    const snap = await this.db.collection(yearsPath).get();

    const bars: DailyAdjustedBar[] = [];
    for (const yearDoc of snap.docs) {
      const compact = (yearDoc.data() as { bars?: CompactBar[] }).bars ?? [];
      for (const b of compact) {
        const { h, l, c } = b;
        // Skip interim (PRE/in-progress) bars and finalized bars with
        // missing prices — neither is valid engine input.
        if (b.barStatus !== undefined && b.barStatus !== 1) continue;
        if (h === undefined || l === undefined || c === undefined) continue;
        if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
        bars.push({
          date: b.d ?? new Date(b.t).toISOString().slice(0, 10),
          open: b.o ?? c,
          high: h,
          low: l,
          close: c,
          // ac is dividend-adjusted close; fall back to split-adjusted c
          // (the sa-time-series collection is already split-adjusted).
          adjustedClose: b.ac ?? c,
          volume: b.v ?? 0,
          dividendAmount: b.dv ?? 0,
          splitCoefficient: b.sc ?? 1,
        });
      }
    }
    bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return bars;
  }

  /** Map a DailyAdjustedBar to the engine's PriceBar (adjustedClose → close). */
  static toPriceBar(bar: DailyAdjustedBar): PriceBar {
    return {
      date: bar.date,
      x: new Date(`${bar.date}T00:00:00.000Z`),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.adjustedClose,
      volume: bar.volume,
    };
  }
}
