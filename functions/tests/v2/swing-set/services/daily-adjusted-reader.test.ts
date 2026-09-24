/**
 * Unit tests for DailyAdjustedReader — reads year-sharded CompactBar docs from
 * symbol-data/{SYMBOL}/sa-time-series/av-daily-adjusted/years/{YYYY} and maps
 * them to DailyAdjustedBar[] / PriceBar[] for the zigzag engine (Task #124).
 *
 * Verifies:
 * - bars are mapped to DailyAdjustedBar with all adjusted-series fields
 * - bars are returned in ascending date order across year shards
 * - bars missing h/l/c are skipped rather than defaulted
 * - toPriceBar maps adjustedClose → close (per IMPL doc)
 */
import type { CompactBar } from '@shared/alpha-vantage';
import { DayOfWeek } from '@shared/alpha-vantage';
import type { FirestoreLike } from '../../../../src/v2/common/firestore/firestore-like';

function makeCompactBar(date: string, overrides: Partial<CompactBar> = {}): CompactBar {
  const t = new Date(`${date}T00:00:00.000Z`).getTime();
  return {
    t,
    d: date,
    dow: DayOfWeek.Wed,
    o: 100,
    h: 105,
    l: 98,
    c: 102,
    v: 1_000_000,
    ac: 101.5,
    dv: 0,
    sc: 1,
    barStatus: 1,
    ...overrides,
  };
}

/**
 * Minimal Firestore fake: collection().get() returns one doc per entry in
 * `years` (key = year doc id, value = that doc's `bars` array). The reader
 * calls a single collection path, so no path filtering is needed.
 * Satisfies FirestoreLike structurally — doc()/where() are unused stubs.
 */
function createFakeFirestore(years: Record<string, CompactBar[]>): FirestoreLike {
  return {
    collection(_path: string) {
      const snapshot = async () => {
        const docs = Object.entries(years).map(([year, bars]) => ({
          exists: true,
          id: year,
          data: () => ({ bars }),
        }));
        return { docs, empty: docs.length === 0, size: docs.length };
      };
      return {
        get: snapshot,
        doc: (_id: string) => ({
          get: async () => ({ exists: false, id: _id, data: () => undefined }),
          set: async () => undefined,
          delete: async () => undefined,
        }),
        where: (_f: string, _o: string, _v: unknown) => ({ get: snapshot }),
      };
    },
  };
}

describe('DailyAdjustedReader', () => {
  function makeReader(years: Record<string, CompactBar[]>) {
    const { DailyAdjustedReader } = require('../../../../src/v2/swing-set/services/daily-adjusted-reader.service');
    return new DailyAdjustedReader(createFakeFirestore(years));
  }

  it('maps CompactBar fields to DailyAdjustedBar', async () => {
    const reader = makeReader({ '2026': [makeCompactBar('2026-01-05')] });
    const bars = await reader.read('AAPL');
    expect(bars).toHaveLength(1);
    const bar = bars[0];
    expect(bar.date).toBe('2026-01-05');
    expect(bar.open).toBe(100);
    expect(bar.high).toBe(105);
    expect(bar.low).toBe(98);
    expect(bar.close).toBe(102);
    expect(bar.adjustedClose).toBe(101.5);
    expect(bar.volume).toBe(1_000_000);
    expect(bar.dividendAmount).toBe(0);
    expect(bar.splitCoefficient).toBe(1);
  });

  it('returns bars in ascending date order across year shards', async () => {
    const reader = makeReader({
      '2025': [makeCompactBar('2025-12-31'), makeCompactBar('2025-01-02')],
      '2026': [makeCompactBar('2026-01-03')],
    });
    const bars = await reader.read('AAPL');
    expect(bars.map((b: { date: string }) => b.date)).toEqual(['2025-01-02', '2025-12-31', '2026-01-03']);
  });

  it('skips bars missing h/l/c instead of defaulting', async () => {
    const reader = makeReader({
      '2026': [
        makeCompactBar('2026-01-05'),
        makeCompactBar('2026-01-06', { h: undefined, l: undefined, c: undefined }), // interim PRE bar
      ],
    });
    const bars = await reader.read('AAPL');
    expect(bars).toHaveLength(1);
    expect(bars[0].date).toBe('2026-01-05');
  });

  it('skips interim bars (barStatus != 1) even when OHLC is populated', async () => {
    const reader = makeReader({
      '2026': [
        makeCompactBar('2026-01-05'),
        // In-progress bar with partial intraday OHLC — must not reach the engine
        makeCompactBar('2026-01-06', { barStatus: 0 }),
      ],
    });
    const bars = await reader.read('AAPL');
    expect(bars).toHaveLength(1);
    expect(bars[0].date).toBe('2026-01-05');
  });

  it('derives the date from t when d is absent', async () => {
    const reader = makeReader({ '2026': [makeCompactBar('2026-03-15', { d: undefined })] });
    const bars = await reader.read('AAPL');
    expect(bars[0].date).toBe('2026-03-15');
  });

  it('defaults adjusted fields when absent', async () => {
    const reader = makeReader({ '2026': [makeCompactBar('2026-01-05', { ac: undefined, dv: undefined, sc: undefined })] });
    const bars = await reader.read('AAPL');
    expect(bars[0].adjustedClose).toBe(102); // falls back to close
    expect(bars[0].dividendAmount).toBe(0);
    expect(bars[0].splitCoefficient).toBe(1);
  });

  it('toPriceBar maps adjustedClose to close and date to x', async () => {
    const { DailyAdjustedReader } = require('../../../../src/v2/swing-set/services/daily-adjusted-reader.service');
    const reader = makeReader({ '2026': [makeCompactBar('2026-01-05')] });
    const bars = await reader.read('AAPL');
    const priceBar = DailyAdjustedReader.toPriceBar(bars[0]);
    expect(priceBar.close).toBe(101.5); // adjustedClose, not close
    expect(priceBar.date).toBe('2026-01-05');
    expect(priceBar.x.toISOString()).toBe('2026-01-05T00:00:00.000Z');
    expect(priceBar.high).toBe(105);
    expect(priceBar.low).toBe(98);
    expect(priceBar.volume).toBe(1_000_000);
  });

  it('returns an empty array when no year docs exist', async () => {
    const reader = makeReader({});
    expect(await reader.read('AAPL')).toEqual([]);
  });
});
