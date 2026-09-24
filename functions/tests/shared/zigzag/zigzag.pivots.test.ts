import { computeZigZagPivots } from '@shared/zigzag/zigzag.pivots';
import { calcDev } from '@shared/zigzag/zigzag.utils';
import type { ZigZagConfig } from '@shared/zigzag/zigzag.types';
import { DEFAULT_CONFIG } from '@shared/zigzag/zigzag.types';
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

function makeSinglePeakBars(): PriceBar[] {
  const highs = [11, 12, 13, 14, 15, 16, 17, 18, 17, 16, 15, 14, 13, 12, 11];
  const lows  = [ 9, 10, 11, 12, 13, 14, 15, 16, 15, 14, 13, 12, 11, 10,  9];
  return makeBars(highs.map((h, i) => ({ o: h - 1, h, l: lows[i], c: h - 1, v: 1000 })));
}

function makeSingleTroughBars(): PriceBar[] {
  const highs = [18, 17, 16, 15, 14, 13, 12, 11, 12, 13, 14, 15, 16, 17, 18];
  const lows  = [16, 15, 14, 13, 12, 11, 10,  9, 10, 11, 12, 13, 14, 15, 16];
  return makeBars(highs.map((h, i) => ({ o: h - 1, h, l: lows[i], c: h - 1, v: 1000 })));
}

const TEST_CONFIG: ZigZagConfig = {
  devThreshold: 5.0,
  leftDepth: 2,
  rightDepth: 2,
  allowZigZagOnOneBar: true,
  projectionPivots: false,
  lineColor: '#1976d2',
};

// =============================================================================
// calcDev
// =============================================================================

describe('calcDev', () => {
  it('computes percentage deviation correctly', () => {
    expect(calcDev(100, 110)).toBeCloseTo(10, 5);
    expect(calcDev(100, 90)).toBeCloseTo(-10, 5);
  });

  it('returns NaN for zero start price', () => {
    expect(Number.isNaN(calcDev(0, 100))).toBe(true);
  });

  it('returns NaN for NaN inputs', () => {
    expect(Number.isNaN(calcDev(NaN, 100))).toBe(true);
    expect(Number.isNaN(calcDev(100, NaN))).toBe(true);
  });
});

// =============================================================================
// computeZigZagPivots — basic pivot detection
// =============================================================================

describe('computeZigZagPivots', () => {
  it('returns empty pivots for empty bars', () => {
    const result = computeZigZagPivots([], TEST_CONFIG);
    expect(result.pivots).toEqual([]);
    expect(result.projection).toBeUndefined();
  });

  it('returns empty pivots for a single bar', () => {
    const bars = makeBars([{ o: 100, h: 101, l: 99, c: 100, v: 1000 }]);
    const result = computeZigZagPivots(bars, TEST_CONFIG);
    expect(result.pivots).toEqual([]);
  });

  it('returns empty pivots for insufficient bars for confirmation', () => {
    const bars = makeSinglePeakBars().slice(0, 3);
    const result = computeZigZagPivots(bars, TEST_CONFIG);
    expect(result.pivots).toEqual([]);
  });

  it('detects a single pivot high at the peak of an uptrend-downtrend', () => {
    const bars = makeSinglePeakBars();
    const result = computeZigZagPivots(bars, TEST_CONFIG);
    // With leftDepth=2, rightDepth=2: exactly one high pivot at bar 7 (price 18)
    expect(result.pivots).toHaveLength(1);
    expect(result.pivots[0].barIndex).toBe(7);
    expect(result.pivots[0].price).toBe(18);
    expect(result.pivots[0].isHigh).toBe(true);
    expect(result.pivots[0].confirmed).toBe(true);
  });

  it('detects a single pivot low at the trough of a downtrend-uptrend', () => {
    const bars = makeSingleTroughBars();
    const result = computeZigZagPivots(bars, TEST_CONFIG);
    expect(result.pivots).toHaveLength(1);
    expect(result.pivots[0].barIndex).toBe(7);
    expect(result.pivots[0].price).toBe(9);
    expect(result.pivots[0].isHigh).toBe(false);
    expect(result.pivots[0].confirmed).toBe(true);
  });

  it('detects alternating high and low pivots with exact values', () => {
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 5; i++) prices.push({ o: i + 1, h: i + 2, l: i, c: i + 1, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 5 - i, h: 6 - i, l: 4 - i, c: 5 - i, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: i + 1, h: i + 2, l: i, c: i + 1, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 5 - i, h: 6 - i, l: 4 - i, c: 5 - i, v: 1000 });
    const bars = makeBars(prices);
    const config: ZigZagConfig = { ...TEST_CONFIG, devThreshold: 10.0 };
    const result = computeZigZagPivots(bars, config);
    // Exactly 2 pivots: high at bar 4 (price 6), low at bar 9 (price 0)
    expect(result.pivots).toHaveLength(2);
    expect(result.pivots[0].barIndex).toBe(4);
    expect(result.pivots[0].isHigh).toBe(true);
    expect(result.pivots[0].price).toBe(6);
    expect(result.pivots[1].barIndex).toBe(9);
    expect(result.pivots[1].isHigh).toBe(false);
  });

  it('does not create pivots for moves below devThreshold', () => {
    // Flat prices with tiny oscillation — 50% threshold can't be met
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 20; i++) {
      prices.push({ o: 100, h: 101, l: 99, c: 100, v: 1000 });
    }
    const bars = makeBars(prices);
    const config: ZigZagConfig = { ...TEST_CONFIG, devThreshold: 50.0 };
    const result = computeZigZagPivots(bars, config);
    // First pivot may register but no reversal meets 50% threshold
    expect(result.pivots.length).toBe(0);
  });

  it('extends the last pivot when a same-direction extreme is found', () => {
    // Rise to peak at bar 4, slight dip, then rise to higher peak at bar 9,
    // then fall for 2 bars to confirm the higher peak.
    // The first high pivot at bar 4 should be extended to bar 9 (same direction, more extreme).
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 5; i++) prices.push({ o: 100 + i * 10, h: 105 + i * 10, l: 95 + i * 10, c: 100 + i * 10, v: 1000 });
    // Dip at bar 5 (not enough to trigger reversal with 50% threshold)
    prices.push({ o: 135, h: 140, l: 130, c: 132, v: 1000 });
    // Rise to higher high at bar 9
    for (let i = 0; i < 4; i++) prices.push({ o: 132 + i * 10, h: 137 + i * 10, l: 127 + i * 10, c: 132 + i * 10, v: 1000 });
    // Fall for 2 bars to confirm the high at bar 9
    prices.push({ o: 160, h: 165, l: 155, c: 158, v: 1000 });
    prices.push({ o: 155, h: 160, l: 150, c: 153, v: 1000 });
    const bars = makeBars(prices);
    const config: ZigZagConfig = { ...TEST_CONFIG, devThreshold: 50.0 };
    const result = computeZigZagPivots(bars, config);
    // With a 50% threshold, the dip at bar 5 doesn't trigger a reversal.
    // The high pivot should be at the most extreme high (bar 9, high=167).
    const highPivots = result.pivots.filter(p => p.isHigh);
    expect(highPivots).toHaveLength(1);
    expect(highPivots[0].barIndex).toBe(9);
    expect(highPivots[0].price).toBe(167);
  });

  it('respects allowZigZagOnOneBar = false (exactly one pivot on spike bar)', () => {
    const flat = { o: 100, h: 101, l: 99, c: 100, v: 1000 };
    const spike = { o: 100, h: 200, l: 50, c: 100, v: 1000 };
    const prices = [flat, flat, flat, flat, flat, spike, flat, flat, flat, flat, flat];
    const bars = makeBars(prices);
    const config: ZigZagConfig = { ...TEST_CONFIG, allowZigZagOnOneBar: false };
    const result = computeZigZagPivots(bars, config);
    const pivotsOnBar5 = result.pivots.filter(p => p.barIndex === 5);
    expect(pivotsOnBar5).toHaveLength(1);
  });

  it('allows high+low pivots on same bar when allowZigZagOnOneBar = true', () => {
    const flat = { o: 100, h: 101, l: 99, c: 100, v: 1000 };
    const spike = { o: 100, h: 200, l: 50, c: 100, v: 1000 };
    const prices = [flat, flat, flat, flat, flat, spike, flat, flat, flat, flat, flat];
    const bars = makeBars(prices);
    const config: ZigZagConfig = { ...TEST_CONFIG, allowZigZagOnOneBar: true };
    const result = computeZigZagPivots(bars, config);
    const pivotsOnBar5 = result.pivots.filter(p => p.barIndex === 5);
    expect(pivotsOnBar5).toHaveLength(2);
    expect(pivotsOnBar5.some(p => p.isHigh)).toBe(true);
    expect(pivotsOnBar5.some(p => !p.isHigh)).toBe(true);
  });

  it('supports asymmetric leftDepth and rightDepth', () => {
    // Rise for 10 bars then fall for 5 — with leftDepth=3, rightDepth=1
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 10; i++) prices.push({ o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 });
    for (let i = 0; i < 5; i++) prices.push({ o: 109 - i, h: 110 - i, l: 108 - i, c: 109 - i, v: 1000 });
    const bars = makeBars(prices);
    const config: ZigZagConfig = {
      devThreshold: 5.0, leftDepth: 3, rightDepth: 1,
      allowZigZagOnOneBar: true, projectionPivots: false,
      lineColor: '#1976d2',
    };
    const result = computeZigZagPivots(bars, config);
    // Should find exactly 1 high pivot at bar 9 (the peak)
    const highPivots = result.pivots.filter(p => p.isHigh);
    expect(highPivots).toHaveLength(1);
    expect(highPivots[0].barIndex).toBe(9);
  });

  it('clamps leftDepth and rightDepth below 2 to 2', () => {
    const bars = makeSinglePeakBars();
    const config: ZigZagConfig = { ...TEST_CONFIG, leftDepth: 1, rightDepth: 1 };
    const result = computeZigZagPivots(bars, config);
    // With clamped depths, should still find the peak at bar 7
    expect(result.pivots).toHaveLength(1);
    expect(result.pivots[0].barIndex).toBe(7);
  });

  it('all confirmed pivots have confirmed = true', () => {
    const bars = makeSinglePeakBars();
    const result = computeZigZagPivots(bars, TEST_CONFIG);
    for (const p of result.pivots) {
      expect(p.confirmed).toBe(true);
    }
  });

  it('handles all-NaN prices without creating pivots', () => {
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 20; i++) prices.push({ o: NaN, h: NaN, l: NaN, c: NaN, v: 1000 });
    const bars = makeBars(prices);
    const result = computeZigZagPivots(bars, TEST_CONFIG);
    expect(result.pivots).toEqual([]);
  });

  it('handles flat prices without creating multiple pivots', () => {
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 20; i++) prices.push({ o: 100, h: 101, l: 99, c: 100, v: 1000 });
    const bars = makeBars(prices);
    const result = computeZigZagPivots(bars, TEST_CONFIG);
    // Flat prices: no pivot meets the strict left-side confirmation
    expect(result.pivots).toHaveLength(0);
  });
});

// =============================================================================
// computeZigZagPivots — projection pivots
// =============================================================================

describe('computeZigZagPivots — projection', () => {
  it('returns a projection when projectionPivots is true', () => {
    // Rise to peak at bar 7, then fall for 3 bars (enough to confirm high pivot)
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 8; i++) prices.push({ o: 100 + i * 5, h: 105 + i * 5, l: 95 + i * 5, c: 100 + i * 5, v: 1000 });
    for (let i = 0; i < 3; i++) prices.push({ o: 135 - i * 5, h: 140 - i * 5, l: 130 - i * 5, c: 135 - i * 5, v: 1000 });
    const bars = makeBars(prices);
    const config: ZigZagConfig = {
      devThreshold: 5.0, leftDepth: 2, rightDepth: 2,
      allowZigZagOnOneBar: true, projectionPivots: true,
      lineColor: '#1976d2',
    };
    const result = computeZigZagPivots(bars, config);
    // Should find the confirmed high pivot at bar 7
    expect(result.pivots).toHaveLength(1);
    expect(result.pivots[0].barIndex).toBe(7);
    expect(result.pivots[0].isHigh).toBe(true);
    // Should find a projected low pivot after the high
    expect(result.projection).toBeDefined();
    expect(result.projection!.confirmed).toBe(false);
    expect(result.projection!.isHigh).toBe(false);
  });

  it('does not return a projection when projectionPivots is false', () => {
    const bars = makeSinglePeakBars();
    const config: ZigZagConfig = { ...TEST_CONFIG, projectionPivots: false };
    const result = computeZigZagPivots(bars, config);
    expect(result.projection).toBeUndefined();
  });

  it('projection has full leftDepth confirmation', () => {
    // Rise to peak at bar 7, then fall for 3 bars. Confirmed high at bar 7;
    // the projection must be a low pivot at bar 10 (deepest low after the
    // peak) with the full leftDepth bars behind it.
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    for (let i = 0; i < 8; i++) prices.push({ o: 100 + i * 5, h: 105 + i * 5, l: 95 + i * 5, c: 100 + i * 5, v: 1000 });
    for (let i = 0; i < 3; i++) prices.push({ o: 135 - i * 5, h: 140 - i * 5, l: 130 - i * 5, c: 135 - i * 5, v: 1000 });
    const bars = makeBars(prices);
    const config: ZigZagConfig = {
      devThreshold: 5.0, leftDepth: 3, rightDepth: 2,
      allowZigZagOnOneBar: true, projectionPivots: true,
      lineColor: '#1976d2',
    };
    const result = computeZigZagPivots(bars, config);
    // The projection must exist and have at least leftDepth bars before it
    expect(result.projection).toBeDefined();
    expect(result.projection!.isHigh).toBe(false);
    expect(result.projection!.barIndex).toBe(10);
    expect(result.projection!.barIndex).toBeGreaterThanOrEqual(config.leftDepth);
  });

  it('projection invalidation: newer extreme replaces stale projection', () => {
    // Build bars where the first projection candidate would be at an early
    // bar, but a more extreme price appears later. The projection should
    // anchor on the newest most-extreme bar, not the stale one.
    const prices: { o: number; h: number; l: number; c: number; v?: number }[] = [];
    // Rise to peak at bar 4 (high=150)
    for (let i = 0; i < 5; i++) prices.push({ o: 100 + i * 10, h: 105 + i * 10, l: 95 + i * 10, c: 100 + i * 10, v: 1000 });
    // Bar 5: moderate drop (low=120) — would be a projection candidate
    prices.push({ o: 140, h: 145, l: 120, c: 130, v: 1000 });
    // Bar 6: deeper drop (low=80) — should invalidate bar 5 as projection
    prices.push({ o: 130, h: 135, l: 80, c: 90, v: 1000 });
    // Bars 7-8: continue down
    prices.push({ o: 90, h: 95, l: 70, c: 80, v: 1000 });
    prices.push({ o: 80, h: 85, l: 60, c: 70, v: 1000 });

    const bars = makeBars(prices);
    const config: ZigZagConfig = {
      devThreshold: 5.0, leftDepth: 2, rightDepth: 2,
      allowZigZagOnOneBar: true, projectionPivots: true,
      lineColor: '#1976d2',
    };
    const result = computeZigZagPivots(bars, config);

    // The confirmed high pivot should be at bar 4
    expect(result.pivots.length).toBeGreaterThanOrEqual(1);
    expect(result.pivots[0].isHigh).toBe(true);

    // The projection should be a low pivot at the most extreme low (bar 8, low=60)
    // not at the stale bar 5 (low=120) or bar 6 (low=80)
    expect(result.projection).toBeDefined();
    expect(result.projection!.isHigh).toBe(false);
    expect(result.projection!.confirmed).toBe(false);
    // The projection price should be the most extreme (lowest) low
    expect(result.projection!.price).toBe(60);
    expect(result.projection!.barIndex).toBe(8);
  });
});

// =============================================================================
// DEFAULT_CONFIG
// =============================================================================

describe('DEFAULT_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_CONFIG.devThreshold).toBe(5.0);
    expect(DEFAULT_CONFIG.leftDepth).toBe(5);
    expect(DEFAULT_CONFIG.rightDepth).toBe(5);
    expect(DEFAULT_CONFIG.allowZigZagOnOneBar).toBe(true);
    expect(DEFAULT_CONFIG.projectionPivots).toBe(true);
  });
});
