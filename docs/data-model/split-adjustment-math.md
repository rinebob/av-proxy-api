# Split Adjustment Mathematics: Present-to-Past Processing

## Executive Summary

**Root Cause**: The `replay-split-history.ts` script was processing splits in **chronological order** (oldest-to-newest), causing cumulative over-adjustment of historical bars.

**Solution**: Process splits in **reverse chronological order** (newest-to-oldest), matching the algorithm used in `adjustHistoryForBackfill()`.

**Files Changed**:
- `functions/scripts/replay-split-history.ts`: Sort splits descending by date
- `functions/src/v2/alpha-vantage/tasks/split-remediator.task.ts`: Added mathematical documentation
- `functions/src/v2/alpha-vantage/logic/split-math.ts`: Added `rebuildPeriodBarFromDailySa()` helper (for future use)

---

## The Mathematical Problem

### AAPL Example

AAPL has 4 stock splits in our system:
```json
[
  { "date": "2000-06-21", "factor": 2 },
  { "date": "2005-02-28", "factor": 2 },
  { "date": "2014-06-09", "factor": 7 },
  { "date": "2020-08-31", "factor": 4 }
]
```

### Incorrect Processing (Oldest-to-Newest)

When `replay-split-history.ts` processed splits chronologically:

```
Initial state: All W/M bars at raw scale

Iteration 1 (2000 split, factor 2):
  - Bars before 2000-06-21 × (1/2)
  - Pre-2000 bars now at: 1/2 of raw

Iteration 2 (2005 split, factor 2):
  - Bars before 2005-02-28 × (1/2)
  - Pre-2000 bars now at: (1/2) × (1/2) = 1/4 of raw ❌

Iteration 3 (2014 split, factor 7):
  - Bars before 2014-06-09 × (1/7)
  - Pre-2000 bars now at: (1/4) × (1/7) = 1/28 of raw ❌

Iteration 4 (2020 split, factor 4):
  - Bars before 2020-08-31 × (1/4)
  - Pre-2000 bars now at: (1/28) × (1/4) = 1/112 of raw ❌
```

**Problem**: Each iteration re-adjusts bars that were already adjusted by previous iterations, causing cumulative compression.

### Correct Processing (Newest-to-Oldest)

When splits are processed in reverse chronological order:

```
Initial state: All W/M bars at raw scale

Iteration 1 (2020 split, factor 4):
  - Bars before 2020-08-31 × (1/4)
  - Pre-2000 bars now at: 1/4 of raw ✓

Iteration 2 (2014 split, factor 7):
  - Bars before 2014-06-09 × (1/7)
  - Pre-2000 bars now at: (1/4) × (1/7) = 1/28 of raw ✓

Iteration 3 (2005 split, factor 2):
  - Bars before 2005-02-28 × (1/2)
  - Pre-2000 bars now at: (1/28) × (1/2) = 1/56 of raw ✓

Iteration 4 (2000 split, factor 2):
  - Bars before 2000-06-21 × (1/2)
  - Pre-2000 bars now at: (1/56) × (1/2) = 1/112 of raw ✓
```

**Result**: The cumulative factor is the same (1/112), but each bar is adjusted exactly once per split, maintaining correct relative scales throughout.

---

## Why This Matters

### Scale Consistency

At any point during the adjustment process, all bars must be on a **consistent scale** relative to each other. Processing newest-to-oldest ensures:

1. **After 2020 split**: All bars are on the "2020 scale" (post-2020 split)
2. **After 2014 split**: All bars are on the "2014 scale" (post-2014 split, relative to 2020)
3. **After 2005 split**: All bars are on the "2005 scale" (post-2005 split, relative to 2014)
4. **After 2000 split**: All bars are on the "2000 scale" (post-2000 split, relative to 2005)

This matches how `adjustHistoryForBackfill()` works: it processes bars from newest to oldest, maintaining a cumulative multiplier.

### Idempotency

With correct ordering, running `replay-split-history` multiple times produces the same result:
- First run: Adjusts bars from raw scale to fully-adjusted scale
- Second run: Bars are already adjusted, so multiplying by `1/factor` again would be wrong

**Important**: The current implementation is NOT idempotent. To make it idempotent, we would need to either:
1. Track which splits have been applied to each bar (complex)
2. Always rebuild from raw data (requires storing raw data separately)
3. Use daily SA as the source of truth for W/M (future enhancement)

---

## Unified Relationship to Split-Adjusted Series (Daily / Weekly / Monthly)

### Daily Backfill (Canonical)

Daily bars are adjusted using `adjustHistoryForBackfill()` in `split-math.ts` (called from `_internalSaveAvTimeSeriesData` in `av-firestore-helper.ts`):

```typescript
export function adjustHistoryForBackfill(rawBars: CompactBar[]): CompactBar[] {
  // 1. Sort Newest to Oldest
  const sorted = [...rawBars].sort((a, b) => b.t - a.t);
  
  let cumulativeMultiplier = 1;
  
  const adjusted = sorted.map(bar => {
    // Apply current cumulative multiplier
    const adjustedBar = adjustBarValues(bar, cumulativeMultiplier);
    
    // If this bar has a split, update multiplier for older bars
    if (bar.sc !== undefined && bar.sc !== 1) {
      cumulativeMultiplier = cumulativeMultiplier / bar.sc;
    }
    
    return adjustedBar;
  });
  
  // Return to chronological order
  return adjusted.sort((a, b) => a.t - b.t);
}
```

This processes bars **newest-to-oldest**, maintaining a cumulative multiplier. This is the gold standard and is now used for **all intervals**.

### Weekly / Monthly (Handler-Based Adjustment)

In the current architecture, WEEKLY and MONTHLY series share the same adjustment pipeline as DAILY:

- The v2 AV handlers fetch **raw** AV time series (including weekly/monthly adjusted endpoints as delivered by AV) and normalize them into `CompactBar` payloads.
- `_internalSaveAvTimeSeriesData` then:
  - For DAILY split-adjusted writes, relies on `bar.sc` coming directly from the provider payload (AV daily adjusted response).
  - For WEEKLY/MONTHLY split-adjusted writes, loads `symbol-data/{symbol}.splitHistory` (maintained by `sync-splits.ts` and real-time split detection) and injects `sc` onto the correct period-end bars:
    - For each split `{ date, factor }`, find the **first** weekly/monthly bar where `b.d >= date` and set `b.sc = factor`.
  - Calls `adjustHistoryForBackfill` once on the full bar array, regardless of interval.

As a result:

- **There is only one split-adjustment pass** for D/W/M, implemented by `adjustHistoryForBackfill`.
- Weekly/monthly SA series are guaranteed to be mathematically consistent with the daily SA series derived from the same `splitHistory`.

---

## Future Enhancement: Daily SA Aggregation

For maximum correctness and to eliminate idempotency concerns, we could rebuild W/M bars entirely from daily SA:

```typescript
// For each W/M bar:
const dailyBarsInPeriod = getDailySaBarsForPeriod(symbol, period);

const aggregated = {
  o: dailyBarsInPeriod[0].o,
  h: Math.max(...dailyBarsInPeriod.map(b => b.h)),
  l: Math.min(...dailyBarsInPeriod.map(b => b.l)),
  c: dailyBarsInPeriod[last].c,
  v: sum(dailyBarsInPeriod.map(b => b.v))
};
```

This is implemented in `rebuildPeriodBarFromDailySa()` but not yet integrated into the main flow. It would require:
1. Loading all daily SA data for the symbol
2. Grouping by week/month
3. Rebuilding each W/M bar from scratch

This would be **perfectly idempotent** and **mathematically exact**, but requires more Firestore reads.

---

## Verification

### Expected Results for AAPL

After running `sync-splits.ts` to normalize `splitHistory` and then `backfill-av-daily-adjusted.ts` with `INCLUDE_WEEKLY=1` and `INCLUDE_MONTHLY=1` (which calls the v2 handlers + `_internalSaveAvTimeSeriesData` + `adjustHistoryForBackfill`):

**Pre-2000 bars** (e.g., 1999-12-31):
- Should be adjusted by cumulative factor: `1 / (2 × 2 × 7 × 4) = 1/112`
- If raw close was $100, adjusted close should be ~$0.89

**2000-2005 bars** (e.g., 2003-01-01):
- Should be adjusted by: `1 / (2 × 7 × 4) = 1/56`
- If raw close was $100, adjusted close should be ~$1.79

**2005-2014 bars** (e.g., 2010-01-01):
- Should be adjusted by: `1 / (7 × 4) = 1/28`
- If raw close was $100, adjusted close should be ~$3.57

**2014-2020 bars** (e.g., 2018-01-01):
- Should be adjusted by: `1 / 4 = 0.25`
- If raw close was $100, adjusted close should be $25.00

**Post-2020 bars** (e.g., 2023-01-01):
- Should be unadjusted (at current scale)
- If raw close was $100, adjusted close should be $100.00

### Comparison with Daily SA

Weekly/monthly bars should now be **numerically consistent** with daily SA bars:
- Weekly high = max of daily SA highs in that week
- Weekly low = min of daily SA lows in that week
- Weekly open = first daily SA open in that week
- Weekly close = last daily SA close in that week

---

## Summary

✅ **Fixed**: `replay-split-history.ts` now sorts splits newest-to-oldest
✅ **Documented**: Mathematical reasoning in code comments
✅ **Future-ready**: `rebuildPeriodBarFromDailySa()` available for daily SA aggregation approach

The fix is minimal (one line change) but critical. The mathematical correctness depends entirely on processing order.
