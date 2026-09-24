/**
 * SA ZigZag Engine — swing derivation.
 *
 * Ported from rel-str `st-zigzag.swings.ts`.
 *
 * Derives swing segments between consecutive pivots, with direction,
 * magnitude, duration, and cumulative volume. If a projection is
 * provided, it's appended as the last swing with `confirmed: false`.
 *
 * Pure functions — no Angular dependencies, no side effects.
 */

import type { PriceBar, Pivot, Swing } from './zigzag.types';
import { calcDev } from './zigzag.utils';

/**
 * Derive swing segments from pivots.
 *
 * Each swing is the segment between two consecutive pivots. If a
 * projection is provided, it's appended as the last swing with
 * `confirmed: false`.
 *
 * Volume is computed from the bars array (cumulative volume across
 * all bars from start.barIndex+1 to end.barIndex inclusive).
 *
 * @param pivots - Confirmed pivots
 * @param bars - Full bar array (for volume computation)
 * @param projection - Optional projected pivot (appended as last swing)
 * @returns Array of swings
 */
export function deriveSwings(pivots: Pivot[], bars?: PriceBar[], projection?: Pivot): Swing[] {
  // Need at least 2 pivots (confirmed + confirmed, or confirmed + projection)
  const allPivots = projection ? [...pivots, projection] : pivots;
  if (allPivots.length < 2) return [];

  const swings: Swing[] = [];

  for (let i = 1; i < allPivots.length; i++) {
    const start = allPivots[i - 1];
    const end = allPivots[i];
    // Equal-price pivots resolve to 'down' with zero magnitude.
    const direction: 'up' | 'down' = end.price > start.price ? 'up' : 'down';
    const magnitudeAbsolute = Math.abs(end.price - start.price);
    const magnitudePercent = calcDev(start.price, end.price);
    const duration = end.barIndex - start.barIndex;
    const confirmed = start.confirmed && end.confirmed;
    const volume = bars ? computeSwingVolume(bars, start.barIndex, end.barIndex) : 0;

    swings.push({
      direction,
      start: { time: start.time, price: start.price, barIndex: start.barIndex },
      end: { time: end.time, price: end.price, barIndex: end.barIndex },
      magnitudePercent,
      magnitudeAbsolute,
      duration,
      volume,
      confirmed,
    });
  }

  return swings;
}

/**
 * Compute cumulative volume across swing bars.
 * Volume is summed from start.barIndex+1 to end.barIndex inclusive.
 */
function computeSwingVolume(bars: PriceBar[], startIndex: number, endIndex: number): number {
  let volume = 0;
  for (let i = startIndex + 1; i <= endIndex && i < bars.length; i++) {
    const v = bars[i].volume;
    if (v !== undefined && Number.isFinite(v)) {
      volume += v;
    }
  }
  return volume;
}
