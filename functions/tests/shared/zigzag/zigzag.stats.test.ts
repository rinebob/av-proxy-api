import { computeSwingStats } from '@shared/zigzag/zigzag.stats';
import type { Swing } from '@shared/zigzag/zigzag.types';

// =============================================================================
// computeSwingStats
// =============================================================================

describe('computeSwingStats', () => {
  it('returns empty stats for empty swings', () => {
    const stats = computeSwingStats([]);
    expect(stats.up.count).toBe(0);
    expect(stats.down.count).toBe(0);
  });

  it('computes mean magnitude and duration for up swings', () => {
    const swings: Swing[] = [
      {
        direction: 'up', start: { time: 0, price: 100, barIndex: 0 },
        end: { time: 5000, price: 110, barIndex: 5 },
        magnitudePercent: 10, magnitudeAbsolute: 10, duration: 5, volume: 5000, confirmed: true,
      },
      {
        direction: 'up', start: { time: 10000, price: 90, barIndex: 10 },
        end: { time: 15000, price: 108, barIndex: 15 },
        magnitudePercent: 20, magnitudeAbsolute: 18, duration: 5, volume: 6000, confirmed: true,
      },
    ];
    const stats = computeSwingStats(swings);
    expect(stats.up.count).toBe(2);
    expect(stats.up.magnitudePercent.mean).toBeCloseTo(15, 1);
    expect(stats.up.duration.mean).toBe(5);
  });

  it('excludes unconfirmed swings from stats', () => {
    const swings: Swing[] = [
      {
        direction: 'up', start: { time: 0, price: 100, barIndex: 0 },
        end: { time: 5000, price: 110, barIndex: 5 },
        magnitudePercent: 10, magnitudeAbsolute: 10, duration: 5, volume: 5000, confirmed: true,
      },
      {
        direction: 'down', start: { time: 5000, price: 110, barIndex: 5 },
        end: { time: 10000, price: 95, barIndex: 10 },
        magnitudePercent: -13.6, magnitudeAbsolute: 15, duration: 5, volume: 5000, confirmed: false,
      },
    ];
    const stats = computeSwingStats(swings);
    expect(stats.up.count).toBe(1);
    expect(stats.down.count).toBe(0);
  });

  it('computes percentiles for magnitude', () => {
    const swings: Swing[] = Array.from({ length: 10 }, (_, i) => ({
      direction: 'up' as const,
      start: { time: i * 10000, price: 100, barIndex: i * 10 },
      end: { time: i * 10000 + 5000, price: 100 + i + 1, barIndex: i * 10 + 5 },
      magnitudePercent: i + 1,
      magnitudeAbsolute: i + 1,
      duration: 5,
      volume: 5000,
      confirmed: true,
    }));
    const stats = computeSwingStats(swings);
    expect(stats.up.count).toBe(10);
    expect(stats.up.magnitudePercent.min).toBe(1);
    expect(stats.up.magnitudePercent.max).toBe(10);
    expect(stats.up.magnitudePercent.median).toBeCloseTo(5.5, 1);
  });

  it('computes histogram bins with fixed 1% bin size for magnitude', () => {
    const swings: Swing[] = [
      {
        direction: 'up', start: { time: 0, price: 100, barIndex: 0 },
        end: { time: 5000, price: 105, barIndex: 5 },
        magnitudePercent: 5, magnitudeAbsolute: 5, duration: 5, volume: 5000, confirmed: true,
      },
      {
        direction: 'up', start: { time: 10000, price: 100, barIndex: 10 },
        end: { time: 15000, price: 108, barIndex: 15 },
        magnitudePercent: 8, magnitudeAbsolute: 8, duration: 5, volume: 5000, confirmed: true,
      },
    ];
    const stats = computeSwingStats(swings);
    // Values 5 and 8 → range 3 → 3 bins of 1% each
    expect(stats.up.magnitudeHistogram.bins).toHaveLength(3);
    // Each bin spans exactly 1%
    for (const bin of stats.up.magnitudeHistogram.bins) {
      expect(bin.upper - bin.lower).toBeCloseTo(1, 1);
    }
    // Bin 0: [5,6) → count 1 (value 5)
    expect(stats.up.magnitudeHistogram.bins[0].count).toBe(1);
    // Bin 1: [6,7) → count 0
    expect(stats.up.magnitudeHistogram.bins[1].count).toBe(0);
    // Bin 2: [7,8] → count 1 (value 8)
    expect(stats.up.magnitudeHistogram.bins[2].count).toBe(1);
    const totalCount = stats.up.magnitudeHistogram.bins.reduce((sum, b) => sum + b.count, 0);
    expect(totalCount).toBe(2);
  });

  it('computes duration histogram with fixed 5-bar bin size', () => {
    const swings: Swing[] = [
      {
        direction: 'up', start: { time: 0, price: 100, barIndex: 0 },
        end: { time: 5000, price: 110, barIndex: 5 },
        magnitudePercent: 10, magnitudeAbsolute: 10, duration: 5, volume: 5000, confirmed: true,
      },
      {
        direction: 'up', start: { time: 10000, price: 100, barIndex: 10 },
        end: { time: 20000, price: 120, barIndex: 20 },
        magnitudePercent: 20, magnitudeAbsolute: 20, duration: 10, volume: 5000, confirmed: true,
      },
    ];
    const stats = computeSwingStats(swings);
    // Values 5 and 10 → range 5 → 1 bin of 5 bars
    expect(stats.up.durationHistogram.bins).toHaveLength(1);
    expect(stats.up.durationHistogram.bins[0].count).toBe(2);
    expect(stats.up.durationHistogram.bins[0].upper - stats.up.durationHistogram.bins[0].lower).toBeCloseTo(5, 1);
  });

  it('handles NaN in swing values without poisoning stats', () => {
    const swings: Swing[] = [
      {
        direction: 'up', start: { time: 0, price: 100, barIndex: 0 },
        end: { time: 5000, price: 110, barIndex: 5 },
        magnitudePercent: 10, magnitudeAbsolute: 10, duration: 5, volume: 5000, confirmed: true,
      },
      {
        direction: 'up', start: { time: 10000, price: 100, barIndex: 10 },
        end: { time: 15000, price: NaN, barIndex: 15 },
        magnitudePercent: NaN, magnitudeAbsolute: NaN, duration: 5, volume: 5000, confirmed: true,
      },
    ];
    const stats = computeSwingStats(swings);
    expect(stats.up.count).toBe(2);
    expect(stats.up.magnitudePercent.mean).toBe(10);
  });
});
