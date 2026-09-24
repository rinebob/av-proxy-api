/**
 * SA ZigZag Engine — shared types.
 *
 * Ported from rel-str `st-zigzag.types.ts`. Type definitions for ZigZag
 * pivot detection, swing derivation, and stats.
 * Imported by pivots, swings, and stats modules; also exports DEFAULT_CONFIG.
 */

/** Price bar data point. Matches ST's `PriceBar` shape. */
export interface PriceBar {
  date: string;
  x: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Configuration for ZigZag pivot computation. */
export interface ZigZagConfig {
  /** Minimum percentage deviation from the last pivot to reverse direction. Default 5.0. */
  devThreshold: number;
  /** Bars to the left (past) for pivot confirmation. Clamped to minimum 2. Default 5. */
  leftDepth: number;
  /** Bars to the right (future) for pivot confirmation. Clamped to minimum 2. Default 5. */
  rightDepth: number;
  /** Allow a pivot high and pivot low on the same bar. Default true. */
  allowZigZagOnOneBar: boolean;
  /** Calculate a projected (unconfirmed) pivot for the developing swing. Default true. */
  projectionPivots: boolean;
  /** Line color for chart rendering (hex). Default '#1976d2'.
   *  Chart-only field — no backend code reads it. Retained (optional here)
   *  so persisted `config` payloads stay compatible with ST's swing-set
   *  document shape, which includes it. */
  lineColor?: string;
  /** Show reversal-trigger dots on the bars that crossed the deviation
   *  threshold. Chart-only — retained for the same reason as `lineColor`. */
  showTriggerDots?: boolean;
}

/** A single pivot point — a confirmed or projected local extreme. */
export interface Pivot {
  /** Index in the bar array. */
  barIndex: number;
  /** Timestamp in milliseconds. */
  time: number;
  /** Price at the pivot (high for pivot high, low for pivot low). */
  price: number;
  /** True = pivot high, false = pivot low. */
  isHigh: boolean;
  /** True = confirmed by depth, false = projected (unconfirmed). */
  confirmed: boolean;
}

/** Result of computeZigZagPivots. */
export interface ZigZagResult {
  /** All confirmed pivots, in chronological order. */
  pivots: Pivot[];
  /** The current projected (unconfirmed) pivot, if any. */
  projection?: Pivot;
}

/** A swing segment between two consecutive pivots. */
export interface Swing {
  direction: 'up' | 'down';
  start: { time: number; price: number; barIndex: number };
  end: { time: number; price: number; barIndex: number };
  /** Price change as a percentage of the start price. */
  magnitudePercent: number;
  /** Absolute price change (always non-negative). */
  magnitudeAbsolute: number;
  /** Number of bars between start and end pivots. */
  duration: number;
  /** Cumulative volume across the swing bars. */
  volume: number;
  /** True = both pivots confirmed, false = current developing swing. */
  confirmed: boolean;
}

/** Statistical summary of a set of values. */
export interface DistributionSummary {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/** Histogram data for a set of values. */
export interface Histogram {
  /** Bins with label, count, and edges. */
  bins: { label: string; count: number; lower: number; upper: number }[];
}

/** Distribution summary for a single direction. */
export interface DirectionStats {
  count: number;
  magnitudePercent: DistributionSummary;
  magnitudeAbsolute: DistributionSummary;
  duration: DistributionSummary;
}

/** Complete swing statistics. */
export interface SwingStats {
  up: DirectionStats & { magnitudeHistogram: Histogram; durationHistogram: Histogram };
  down: DirectionStats & { magnitudeHistogram: Histogram; durationHistogram: Histogram };
}

/** Default ZigZag configuration. */
export const DEFAULT_CONFIG: ZigZagConfig = {
  devThreshold: 5.0,
  leftDepth: 5,
  rightDepth: 5,
  allowZigZagOnOneBar: true,
  projectionPivots: true,
  lineColor: '#1976d2',
};
