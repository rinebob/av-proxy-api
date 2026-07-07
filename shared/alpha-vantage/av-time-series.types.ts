import { TimeSeriesInterval } from './av-time-series';

/**
 * Shared normalized types for Alpha Vantage time-series responses.
 * Single source of truth for both Functions and Frontend.
 */
export interface AvCommonMeta {
  information?: string;
  symbol?: string;
  lastRefreshed?: string;
  outputSize?: string;
  timeZone?: string;
}

export interface AvOhlcEntry {
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose?: number;
  volume: number;
  dividendAmount?: number;
  splitCoefficient?: number;
}

/**
 * Unified normalized response: series are keyed by the shared TimeSeriesInterval enum.
 * Example access: result.series[TimeSeriesInterval.DAILY]
 */
export interface AvTimeSeriesNormalized {
  meta: AvCommonMeta;
  series: Partial<Record<TimeSeriesInterval, Record<string, AvOhlcEntry>>>;
}

/**
 * Human-readable day-of-week for persisted bars.
 */
export enum DayOfWeek {
  Sun = 'Sun',
  Mon = 'Mon',
  Tue = 'Tue',
  Wed = 'Wed',
  Thu = 'Thu',
  Fri = 'Fri',
  Sat = 'Sat',
}

/**
 * Shared Firestore time-series compact bar schema.
 * This matches the persisted short-key format used by time-series writers (AV adjusted series).
 * During PRE (intraday), only a subset (date, dow, ip/io/it) may be present.
 * POST (daily adjusted) fills OHLC/adjusted fields.
 */
export interface CompactBar {
  // epoch millis at 00:00:00Z (for daily/weekly/monthly)
  t: number;
  // human-readable ISO date (YYYY-MM-DD, UTC). Added by writers/backfill.
  d?: string;
  // required human-readable day-of-week (ET) for display/debug
  dow: DayOfWeek;

  // OHLC (optional for PRE/intraday; expected after POST finalize)
  o?: number;
  h?: number;
  l?: number;
  c?: number;

  // Volume (optional for PRE/intraday; expected after POST finalize)
  v?: number;

  // Adjusted series fields (optional during PRE; populated by POST daily adjusted write)
  ac?: number; // adjusted close
  dv?: number; // dividend amount
  sc?: number; // split coefficient
  // Previous close may not always be set by provider for time-series; optional
  pc?: number; // previous close (if present in provider payload)

  // Derived change metrics (computed by writers/backfill)
  ch?: number; // change vs prior close (rounded 2dp)
  cp?: number; // percent change vs prior close (rounded 2dp)

  // Intraday snapshot fields (set by time-series writers when available)
  ip?: number; // intradayPrice (mark price) observed during the session
  io?: number; // intradayObservedAt epoch ms (wall-clock when snapshot was taken)
  it?: string; // intradayTime derived as 'HH:mm' in America/New_York from io

  // Intraday delta metrics (computed at pre-close snapshot time)
  ic?: number | null; // intradayChange = ip - previousClose (null when no prior bar)
  ipc?: number | null; // intradayPercentChange = (ic / previousClose) * 100 (null when no prior bar)

  /**
   * Bar status flag — written at write time by pipeline workers and stored in Firestore.
   * Mirrors the TradeStation barStatus convention:
   *   -1 = first update of a new bar period (period-open boundary)
   *    0 = interim/in-progress update
   *    1 = final period-closing bar
   * Historical bars always have barStatus 1.
   * Only the trailing (current-period) bar carries -1 or 0.
   */
  barStatus?: -1 | 0 | 1;
}
