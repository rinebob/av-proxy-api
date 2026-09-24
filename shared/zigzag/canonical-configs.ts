/**
 * Canonical ZigZag configurations.
 *
 * SA generates a swing set for every tracked symbol under each of these four
 * parameter sets. They are the single source of truth shared with ST — doc
 * keys ({symbol}_{paramsId}) stay stable only if both sides use identical
 * values, so do not edit these casually.
 */
import type { ZigZagConfig } from './zigzag.types';

export const CANONICAL_ZIGZAG_CONFIGS: ZigZagConfig[] = [
  { devThreshold: 10, leftDepth: 10, rightDepth: 10, allowZigZagOnOneBar: true, projectionPivots: true, lineColor: '#1976d2', showTriggerDots: true },
  { devThreshold: 5,  leftDepth: 5,  rightDepth: 5,  allowZigZagOnOneBar: true, projectionPivots: true, lineColor: '#1976d2', showTriggerDots: true },
  { devThreshold: 3,  leftDepth: 3,  rightDepth: 3,  allowZigZagOnOneBar: true, projectionPivots: true, lineColor: '#1976d2', showTriggerDots: true },
  { devThreshold: 2,  leftDepth: 2,  rightDepth: 2,  allowZigZagOnOneBar: true, projectionPivots: true, lineColor: '#1976d2', showTriggerDots: true },
];
