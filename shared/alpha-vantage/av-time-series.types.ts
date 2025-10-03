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
 * Shared Firestore time-series compact bar schema.
 * This matches the persisted short-key format used by time-series writers (AV adjusted series).
 * Fields are required per our persisted schema for AV daily/weekly/monthly adjusted.
 */
export interface CompactBar {
  // epoch millis at 00:00:00Z (for daily/weekly/monthly)
  t: number;
  // human-readable ISO date (YYYY-MM-DD, UTC). Added by writers/backfill.
  d?: string;

  // OHLC
  o: number;
  h: number;
  l: number;
  c: number;

  // Volume (always present in our stored bars)
  v: number;

  // Adjusted series fields (always present for our stored AV adjusted series)
  ac: number; // adjusted close
  dv: number; // dividend amount
  sc: number; // split coefficient
  // Previous close may not always be set by provider for time-series; optional
  pc?: number; // previous close (if present in provider payload)

  // Derived change metrics (computed by writers/backfill)
  ch?: number; // change vs prior close (rounded 2dp)
  cp?: number; // percent change vs prior close (rounded 2dp)

  // Intraday snapshot fields (set by time-series writers when available)
  ip?: number; // intradayPrice (mark price) observed during the session
  io?: number; // intradayObservedAt epoch ms (wall-clock when snapshot was taken)
  it?: string; // intradayTime derived as 'HH:mm' in America/New_York from io
}
