/**
 * Swing-set document types and the paramsId helper.
 *
 * `deriveParamsId` is ported verbatim from rel-str
 * `swing-analysis.types.ts` — SA must produce identical ids so the
 * `{symbol}_{paramsId}` doc keys match what ST computes client-side.
 */
import type { Pivot, Swing, SwingStats, ZigZagConfig } from './zigzag.types';
import type { TimestampLike } from '../firestore/timestamp';

/**
 * A persisted swing-set document in `options-swing-sets/{symbol}_{paramsId}`.
 *
 * Modeled on ST's `SwingAnalysisInput` shape but NOT readable by ST's existing
 * `SwingAnalysisDoc` Firestore path: `savedAt: string` becomes
 * `generatedAt: TimestampLike`, `id`/`userId` are absent (ST stamps those from
 * auth + doc read), and the collection differs (`options-swing-sets` vs
 * `st-swing-sets`, whose security rules require `userId`). ST consumes
 * SA-generated sets via the `partnerSwingSetsV2` endpoint, not by reading
 * this collection directly. `source` distinguishes SA- vs ST-generated sets.
 */
export interface SwingSetDoc {
  /** Symbol the set was generated for (uppercase). */
  symbol: string;
  /** Deterministic params id — see deriveParamsId. */
  paramsId: string;
  /** The config used to compute this set. */
  config: ZigZagConfig;
  /** Confirmed pivots, chronological order. */
  pivots: Pivot[];
  /** Projected (unconfirmed) pivot for the developing swing, if any.
   *  Tri-state (Pivot | null | undefined) matches ST's declaration verbatim. */
  projection?: Pivot | null;
  /** Derived swings (last one unconfirmed when a projection exists). */
  swings: Swing[];
  /** Computed swing statistics (confirmed swings only). */
  stats: SwingStats;
  /** When the set was generated. */
  generatedAt: TimestampLike;
  /** Which system generated this document. */
  source: 'sa' | 'st';
}

/**
 * SA's daily-adjusted bar — the input shape the BE service reads from
 * `sa-time-series/av-daily-adjusted` and maps into `PriceBar` before calling
 * the engine (`adjustedClose` → `close`, `date` → `date`/`x`).
 */
export interface DailyAdjustedBar {
  /** YYYY-MM-DD (UTC day). */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number;
  volume: number;
  dividendAmount: number;
  splitCoefficient: number;
}

/**
 * Derive a stable paramsId from a ZigZagConfig.
 * Combined with the symbol to form the Firestore document id:
 * `options-swing-sets/{symbol}_{paramsId}`.
 *
 * Format: dev{N}_L{N}_R{N}_1bar{Y|N}_proj{Y|N}
 */
export function deriveParamsId(config: ZigZagConfig): string {
  const parts = [
    `dev${config.devThreshold}`,
    `L${config.leftDepth}`,
    `R${config.rightDepth}`,
    `1bar${config.allowZigZagOnOneBar ? 'Y' : 'N'}`,
    `proj${config.projectionPivots ? 'Y' : 'N'}`,
  ];
  return parts.join('_');
}
