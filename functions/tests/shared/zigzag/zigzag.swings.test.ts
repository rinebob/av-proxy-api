import { deriveSwings } from '@shared/zigzag/zigzag.swings';
import type { Pivot } from '@shared/zigzag/zigzag.types';
import type { PriceBar } from '@shared/zigzag/zigzag.types';

// =============================================================================
// Test helpers
// =============================================================================

function makeBars(prices: { o: number; h: number; l: number; c: number; v?: number }[]): PriceBar[] {
  return prices.map((p, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    x: new Date(2026, 0, i + 1),
    open: p.o,
    high: p.h,
    low: p.l,
    close: p.c,
    volume: p.v,
  }));
}

// =============================================================================
// deriveSwings
// =============================================================================

describe('deriveSwings', () => {
  it('returns empty swings for empty pivots', () => {
    const swings = deriveSwings([]);
    expect(swings).toEqual([]);
  });

  it('returns empty swings for a single pivot without projection', () => {
    const pivots: Pivot[] = [
      { barIndex: 5, time: 1000, price: 100, isHigh: true, confirmed: true },
    ];
    const swings = deriveSwings(pivots);
    expect(swings).toEqual([]);
  });

  it('derives a single swing from one confirmed pivot + projection', () => {
    const pivots: Pivot[] = [
      { barIndex: 0, time: 1000, price: 100, isHigh: false, confirmed: true },
    ];
    const projection: Pivot = { barIndex: 5, time: 5000, price: 110, isHigh: true, confirmed: false };
    const swings = deriveSwings(pivots, undefined, projection);
    expect(swings).toHaveLength(1);
    expect(swings[0].direction).toBe('up');
    expect(swings[0].start.price).toBe(100);
    expect(swings[0].end.price).toBe(110);
    expect(swings[0].duration).toBe(5);
    expect(swings[0].magnitudePercent).toBeCloseTo(10, 1);
    expect(swings[0].magnitudeAbsolute).toBe(10);
    expect(swings[0].confirmed).toBe(false);
  });

  it('derives a single swing between two confirmed pivots', () => {
    const pivots: Pivot[] = [
      { barIndex: 0, time: 1000, price: 100, isHigh: false, confirmed: true },
      { barIndex: 5, time: 5000, price: 110, isHigh: true, confirmed: true },
    ];
    const swings = deriveSwings(pivots);
    expect(swings).toHaveLength(1);
    expect(swings[0].direction).toBe('up');
    expect(swings[0].start.price).toBe(100);
    expect(swings[0].end.price).toBe(110);
    expect(swings[0].duration).toBe(5);
    expect(swings[0].magnitudePercent).toBeCloseTo(10, 1);
    expect(swings[0].magnitudeAbsolute).toBe(10);
    expect(swings[0].confirmed).toBe(true);
  });

  it('alternates swing directions', () => {
    const pivots: Pivot[] = [
      { barIndex: 0, time: 1000, price: 100, isHigh: false, confirmed: true },
      { barIndex: 5, time: 5000, price: 110, isHigh: true, confirmed: true },
      { barIndex: 10, time: 10000, price: 90, isHigh: false, confirmed: true },
    ];
    const swings = deriveSwings(pivots);
    expect(swings).toHaveLength(2);
    expect(swings[0].direction).toBe('up');
    expect(swings[1].direction).toBe('down');
  });

  it('includes the projected swing as last entry with confirmed = false', () => {
    const pivots: Pivot[] = [
      { barIndex: 0, time: 1000, price: 100, isHigh: false, confirmed: true },
      { barIndex: 5, time: 5000, price: 110, isHigh: true, confirmed: true },
    ];
    const projection: Pivot = { barIndex: 10, time: 10000, price: 95, isHigh: false, confirmed: false };
    const swings = deriveSwings(pivots, undefined, projection);
    expect(swings).toHaveLength(2);
    expect(swings[1].confirmed).toBe(false);
    expect(swings[1].direction).toBe('down');
  });

  it('computes cumulative volume from bars', () => {
    const bars = makeBars([
      { o: 100, h: 105, l: 95, c: 100, v: 1000 },
      { o: 100, h: 105, l: 95, c: 100, v: 2000 },
      { o: 100, h: 105, l: 95, c: 100, v: 3000 },
      { o: 100, h: 105, l: 95, c: 100, v: 4000 },
      { o: 100, h: 105, l: 95, c: 100, v: 5000 },
    ]);
    const pivots: Pivot[] = [
      { barIndex: 0, time: 1000, price: 95, isHigh: false, confirmed: true },
      { barIndex: 4, time: 5000, price: 105, isHigh: true, confirmed: true },
    ];
    const swings = deriveSwings(pivots, bars);
    expect(swings[0].volume).toBe(14000);
  });

  it('magnitudeAbsolute is always non-negative', () => {
    const pivots: Pivot[] = [
      { barIndex: 0, time: 1000, price: 110, isHigh: true, confirmed: true },
      { barIndex: 5, time: 5000, price: 90, isHigh: false, confirmed: true },
    ];
    const swings = deriveSwings(pivots);
    expect(swings[0].direction).toBe('down');
    expect(swings[0].magnitudeAbsolute).toBe(20);
  });
});
