/**
 * Swing-set document types and the paramsId helper.
 *
 * `deriveParamsId` is ported verbatim from rel-str
 * `swing-analysis.types.ts` — SA must produce identical ids so the
 * `{symbol}_{paramsId}` doc keys match what ST computes client-side.
 */
import type { ZigZagConfig } from './zigzag.types';
import type { TimestampLike } from '../firestore/timestamp';

/**
 * A persisted swing-set document in `options-swing-sets/{symbol}_{paramsId}`.
 *
 * SLIM SHAPE (post-#152 design decision): SA only needs pivot *dates* — the
 * corpus planner consumes them to schedule option-chain fetches, and ST
 * computes the full zigzag (pivots, swings, stats) client-side from its own
 * bars. Persisting the derived arrays wasted ~1-2 MB per doc against the
 * 1 MiB Firestore cap, so `pivots`/`swings`/`stats`/`projection` are gone.
 * What remains is the extraction output plus enough metadata to judge
 * freshness and canonicality.
 */
export interface SwingSetDoc {
  /** Symbol the set was generated for (uppercase). */
  symbol: string;
  /** Deterministic params id — see deriveParamsId. */
  paramsId: string;
  /** The config used to compute this set. */
  config: ZigZagConfig;
  /** Confirmed pivot dates (YYYY-MM-DD), chronological, deduped. */
  pivotDates: string[];
  /**
   * The developing swing's current extreme date — the projection's bar date
   * when one exists, else the last confirmed pivot's date. Equals
   * `getCurrentSwing`'s `extremeDate`.
   */
  currentExtremeDate: string | null;
  /** Current-swing direction ('up' = developing toward a high). */
  currentDirection: 'up' | 'down' | null;
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
