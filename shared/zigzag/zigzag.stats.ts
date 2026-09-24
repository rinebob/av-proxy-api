/**
 * SA ZigZag Engine — statistics.
 *
 * Ported from rel-str `st-zigzag.stats.ts`.
 *
 * Computes distribution summaries and histograms for swing magnitude
 * and duration, split by direction. Only confirmed swings are included.
 *
 * Pure functions — no Angular dependencies, no side effects.
 */

import type { Swing, SwingStats, DistributionSummary, Histogram } from './zigzag.types';

/** Default bin sizes: 1% for magnitude, 5 bars for duration. */
const MAGNITUDE_BIN_SIZE = 1;
const DURATION_BIN_SIZE = 5;

/**
 * Compute distribution summary for a set of values.
 * Non-finite values (NaN, Infinity) are filtered before computing.
 */
function computeDistributionSummary(values: number[]): DistributionSummary {
  const finite = values.filter(v => Number.isFinite(v));

  if (finite.length === 0) {
    return {
      mean: 0, median: 0, stdDev: 0, min: 0, max: 0,
      p10: 0, p25: 0, p50: 0, p75: 0, p90: 0,
    };
  }

  const sorted = [...finite].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = finite.reduce((s, v) => s + v, 0) / n;
  const variance = finite.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const percentile = (p: number): number => {
    const idx = (p / 100) * (n - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  };

  return {
    mean,
    median: percentile(50),
    stdDev,
    min: sorted[0],
    max: sorted[n - 1],
    p10: percentile(10),
    p25: percentile(25),
    p50: percentile(50),
    p75: percentile(75),
    p90: percentile(90),
  };
}

/**
 * Compute histogram bins for a set of values using a fixed bin size.
 *
 * Non-finite values are filtered. Bins are aligned to the bin size
 * starting from the minimum value.
 *
 * @param values - Values to bin
 * @param binSize - Fixed size of each bin
 * @returns Histogram with labeled bins and counts
 */
function computeHistogram(values: number[], binSize: number): Histogram {
  const finite = values.filter(v => Number.isFinite(v));

  if (finite.length === 0) {
    return { bins: [] };
  }

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min;
  const binCount = Math.max(1, Math.ceil(range / binSize));

  // Use the fixed binSize for each bin (not equalized)
  const bins: { label: string; count: number; lower: number; upper: number }[] = [];
  for (let i = 0; i < binCount; i++) {
    const lower = min + i * binSize;
    const upper = i === binCount - 1 ? max : min + (i + 1) * binSize;
    bins.push({
      label: `${lower.toFixed(1)}-${upper.toFixed(1)}`,
      count: 0,
      lower,
      upper,
    });
  }

  for (const v of finite) {
    let binIdx = Math.floor((v - min) / binSize);
    if (binIdx >= binCount) binIdx = binCount - 1;
    if (binIdx < 0) binIdx = 0;
    bins[binIdx].count++;
  }

  return { bins };
}

/**
 * Compute swing statistics — distribution summary + histograms, split by direction.
 *
 * Only confirmed swings are included in the statistics. The projected swing
 * (if present) is excluded.
 *
 * @param swings - Array of swings
 * @returns Statistics for up and down swings
 */
export function computeSwingStats(swings: Swing[]): SwingStats {
  const confirmed = swings.filter(s => s.confirmed);
  const upSwings = confirmed.filter(s => s.direction === 'up');
  const downSwings = confirmed.filter(s => s.direction === 'down');

  const upMagPercent = upSwings.map(s => s.magnitudePercent);
  const upMagAbs = upSwings.map(s => s.magnitudeAbsolute);
  const upDuration = upSwings.map(s => s.duration);

  const downMagPercent = downSwings.map(s => s.magnitudePercent);
  const downMagAbs = downSwings.map(s => s.magnitudeAbsolute);
  const downDuration = downSwings.map(s => s.duration);

  return {
    up: {
      count: upSwings.length,
      magnitudePercent: computeDistributionSummary(upMagPercent),
      magnitudeAbsolute: computeDistributionSummary(upMagAbs),
      duration: computeDistributionSummary(upDuration),
      magnitudeHistogram: computeHistogram(upMagPercent, MAGNITUDE_BIN_SIZE),
      durationHistogram: computeHistogram(upDuration, DURATION_BIN_SIZE),
    },
    down: {
      count: downSwings.length,
      magnitudePercent: computeDistributionSummary(downMagPercent),
      magnitudeAbsolute: computeDistributionSummary(downMagAbs),
      duration: computeDistributionSummary(downDuration),
      magnitudeHistogram: computeHistogram(downMagPercent, MAGNITUDE_BIN_SIZE),
      durationHistogram: computeHistogram(downDuration, DURATION_BIN_SIZE),
    },
  };
}
