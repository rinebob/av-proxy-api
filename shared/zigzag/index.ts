/**
 * SA ZigZag Engine — public API facade.
 *
 * Ported from rel-str `st-zigzag.engine.ts`.
 *
 * Re-exports the pure ZigZag computation functions and types from their
 * focused modules:
 * - `zigzag.types.ts` — shared types and defaults
 * - `zigzag.pivots.ts` — pivot detection (confirmed + projected)
 * - `zigzag.swings.ts` — swing derivation
 * - `zigzag.stats.ts` — distribution summaries + histograms
 *
 * `computeTriggerPoints`/`TriggerPoint` from `st-zigzag.triggers.ts` are
 * intentionally NOT ported — they exist for chart rendering (reversal-trigger
 * dots), which the backend never does.
 *
 * Import from this module: `import { computeZigZagPivots } from '@shared/zigzag'`
 */

export { computeZigZagPivots } from './zigzag.pivots';
export { calcDev, isFiniteNum } from './zigzag.utils';
export { deriveSwings } from './zigzag.swings';
export { computeSwingStats } from './zigzag.stats';
export {
  DEFAULT_CONFIG,
  type ZigZagConfig,
  type Pivot,
  type ZigZagResult,
  type Swing,
  type SwingStats,
  type DistributionSummary,
  type Histogram,
  type DirectionStats,
  type PriceBar,
} from './zigzag.types';
