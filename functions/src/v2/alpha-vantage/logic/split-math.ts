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
      // HEURISTIC: Check for "Hybrid" bars (Weekly/Monthly) where O/H/L are Pre-Split but Close is Post-Split.
      // This happens when a split occurs mid-period. The bar's High is unadjusted (high), causing a chart spike.
      // If we detect O/H/L are consistent with Pre-Split levels (relative to Close * SC), we adjust them "in-place".
      if (bar.sc > 1) { // Forward splits only for now (most common source of spikes)
          const expectedPreSplit = (adjustedBar.c || 0) * bar.sc;
          
          // Dynamic Threshold:
          // For large splits (e.g. 5:1, 20:1), a low threshold (0.5) is fine because PostSplit is small (0.2, 0.05).
          // For small splits (e.g. 2:1), PostSplit is 0.5. A 0.5 threshold is dangerous as it matches PostSplit exactly.
          // We need a threshold that is comfortably above PostSplit levels.
          // PostSplit Level = expectedPreSplit / bar.sc.
          // We want Threshold > PostSplit Level * Buffer (e.g. 1.2x).
          // Threshold = ExpectedPreSplit * ThresholdFactor.
          // ExpectedPreSplit * ThresholdFactor > (ExpectedPreSplit / bar.sc) * 1.2
          // ThresholdFactor > 1.2 / bar.sc.
          // Also keep a floor of 0.5 for large splits.
          const minSafeFactor = 1.3 / bar.sc; 
          const thresholdFactor = Math.max(0.5, minSafeFactor);
          const threshold = expectedPreSplit * thresholdFactor;

          const fixMult = 1 / bar.sc;

          // Adjust O/H/L if they look like Pre-Split values
          if (adjustedBar.o !== undefined && adjustedBar.o > threshold) {
             // console.log(`Fixing Hybrid Open: ${bar.d} ${adjustedBar.o} -> ${adjustedBar.o * fixMult} (Thresh: ${threshold})`);
             adjustedBar.o = Number((adjustedBar.o * fixMult).toFixed(4));
          }
          if (adjustedBar.h !== undefined && adjustedBar.h > threshold) {
             // console.log(`Fixing Hybrid High: ${bar.d} ${adjustedBar.h} -> ${adjustedBar.h * fixMult}`);
             adjustedBar.h = Number((adjustedBar.h * fixMult).toFixed(4));
          }
          if (adjustedBar.l !== undefined && adjustedBar.l > threshold) {
             // console.log(`Fixing Hybrid Low: ${bar.d} ${adjustedBar.l} -> ${adjustedBar.l * fixMult}`);
             adjustedBar.l = Number((adjustedBar.l * fixMult).toFixed(4));
          }
      }

      cumulativeMultiplier = cumulativeMultiplier / bar.sc;
    }
    
    // Heuristic: Detect Anomalous Lows (e.g. GOOGL 2014-04-02 Low is half of High)
    // This happens if Raw Low was already split-adjusted but others weren't.
    if (adjustedBar.h !== undefined && adjustedBar.l !== undefined) {
        if (adjustedBar.l < adjustedBar.h * 0.6) {
            // Low is < 60% of High. Very suspicious for mega-caps.
            // Check if Open/Close are reasonable (closer to High).
            const c = adjustedBar.c || 0;
            if (c > adjustedBar.h * 0.8) { // Close is high
                // Fix Low: Set to min(Open, Close)
                const o = adjustedBar.o || c;
                const newLow = Math.min(o, c);
                // console.log(`Fixed Anomalous Low: ${bar.d} ${adjustedBar.l} -> ${newLow}`);
                adjustedBar.l = newLow;
            }
        }
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
    // cp (Percent Change) remains constant during a split.
    
    // ac (Adjusted Close) is already adjusted by the provider (includes splits + dividends).
    // Do NOT apply the split multiplier again, or it will be double-adjusted.
    ac: bar.ac,
  };
}
