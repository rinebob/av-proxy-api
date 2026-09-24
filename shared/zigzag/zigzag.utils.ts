/**
 * SA ZigZag Engine — shared math utilities.
 *
 * Ported from rel-str `st-zigzag.utils.ts`.
 * Pure helper functions used across pivot, swing, and stats modules.
 * No Angular dependencies, no side effects.
 */

/** Returns true if value is a finite number. */
export function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Calculate the percentage deviation between two prices.
 * Matches Pine's `calcDev`: 100 * (end - start) / abs(start)
 * Returns NaN if start is 0 or either input is non-finite.
 */
export function calcDev(start: number, end: number): number {
  if (!isFiniteNum(start) || !isFiniteNum(end) || start === 0) return NaN;
  return (100 * (end - start)) / Math.abs(start);
}
