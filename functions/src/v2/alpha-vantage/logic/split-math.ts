import type { CompactBar } from '@shared/alpha-vantage';

/**
 * Applies a SINGLE new split event to a historical dataset.
 * Use this when the database is already adjusted up to "Yesterday" and "Today" introduces a new split.
 *
 * @param bars The full history of bars (order does not matter for correctness, but performance is better if sorted)
 * @param splitDate The date (YYYY-MM-DD) when the split became effective (Ex-Date).
 * @param splitFactor The raw split coefficient from the provider (e.g., 2.0 for a 2-for-1 split).
 * @returns A new array of bars with the adjustment applied to all bars BEFORE the splitDate.
 */
export function applyIncrementalSplit(
  bars: CompactBar[],
  splitDate: string,
  splitFactor: number
): CompactBar[] {
  // If 2:1 split (factor 2.0), price drops by half. We must multiply by 0.5.
  // Multiplier = 1 / splitFactor
  // Avoid division by zero just in case
  if (splitFactor === 0) return bars;
  
  const multiplier = 1 / splitFactor;

  return bars.map(bar => {
    // CRITICAL: Only adjust bars BEFORE the split date.
    // The split date itself (and anything after) is already at the new price level.
    if (bar.d && bar.d < splitDate) {
      return adjustBarValues(bar, multiplier);
    }
    return bar;
  });
}

/**
 * Applies ALL splits found within a raw dataset.
 * Use this for BACKFILLS or when re-processing raw data from scratch.
 *
 * Algorithm: "The Backwards Pass"
 * 1. Sort Newest -> Oldest
 * 2. Maintain cumulative multiplier (starts at 1)
 * 3. When a split is seen (sc != 1), update multiplier (multiplier /= sc)
 * 4. Apply current multiplier to the bar
 *
 * @param rawBars Raw bars from the provider (must have 'sc' field populated where applicable)
 * @returns A new array of fully adjusted bars.
 */
export function adjustHistoryForBackfill(rawBars: CompactBar[]): CompactBar[] {
  // 1. Sort Newest to Oldest
  const sorted = [...rawBars].sort((a, b) => b.t - a.t);

  let cumulativeMultiplier = 1;

  const adjusted = sorted.map(bar => {
    // Apply the CURRENT cumulative multiplier to this bar
    // (This applies all splits that happened "in the future" relative to this bar)
    const adjustedBar = adjustBarValues(bar, cumulativeMultiplier);

    // If this bar represents a split event, update the multiplier for the NEXT (older) bars.
    // Example: Today is Split Day (2.0).
    // This bar is already adjusted (it's the new price).
    // But the NEXT bar (yesterday) needs to be divided by 2.0.
    if (bar.sc !== undefined && bar.sc !== 1) {
      cumulativeMultiplier = cumulativeMultiplier / bar.sc;
    }

    return adjustedBar;
  });

  // Return to chronological order (Oldest -> Newest)
  return adjusted.sort((a, b) => a.t - b.t);
}

/**
 * Helper to apply a multiplier to OHLC fields.
 * Volume is NEVER adjusted.
 * Precision is clamped to 4 decimal places to avoid floating point drift.
 */
function adjustBarValues(bar: CompactBar, multiplier: number): CompactBar {
  // If multiplier is 1, return as is (optimization)
  if (multiplier === 1) return bar;

  return {
    ...bar,
    o: bar.o !== undefined ? Number((bar.o * multiplier).toFixed(4)) : undefined,
    h: bar.h !== undefined ? Number((bar.h * multiplier).toFixed(4)) : undefined,
    l: bar.l !== undefined ? Number((bar.l * multiplier).toFixed(4)) : undefined,
    c: bar.c !== undefined ? Number((bar.c * multiplier).toFixed(4)) : undefined,
    // Re-calculate changes if they exist
    ch: bar.ch !== undefined ? Number((bar.ch * multiplier).toFixed(4)) : undefined,
    // cp (Percent Change) remains constant during a split, technically, 
    // but since it's a derived value, it holds true.
    // ac (Adjusted Close) - we ignore this field generally, but if present, scale it too?
    // Policy says: "Ignore AV adjusted close". But if we have it in our DB, we should probably keep it consistent or null it.
    // Let's scale it to be safe so it doesn't look wildly out of place.
    ac: bar.ac !== undefined ? Number((bar.ac * multiplier).toFixed(4)) : undefined,
  };
}
