/**
 * The ZigZag configuration used for corpus date sampling.
 *
 * SA generates one swing-set doc per options-enabled symbol under this
 * config. Its confirmed pivot dates mark every ≥2% extreme — the dates where
 * option-chain snapshots are fetched for the historical options corpus.
 * Coarser configs add no dates the 2% set doesn't already contain.
 *
 * Doc keys ({symbol}_{paramsId}) stay stable only if this value never
 * changes, so do not edit it casually.
 */
import type { ZigZagConfig } from './zigzag.types';

export const CORPUS_ZIGZAG_CONFIG: ZigZagConfig = {
  devThreshold: 2,
  leftDepth: 2,
  rightDepth: 2,
  allowZigZagOnOneBar: true,
  projectionPivots: true,
  lineColor: '#1976d2',
  showTriggerDots: true,
};
