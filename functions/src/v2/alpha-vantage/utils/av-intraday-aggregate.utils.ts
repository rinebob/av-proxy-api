import { parseAvEtTimestampMs } from './date-utils';

/**
 * Aggregated regular-trading-hours intraday OHLCV bar.
 */
export interface IntradayRthBarAggregate {
  /** Opening price of the first 15-minute bar at or after 09:30 ET. */
  o: number;
  /** Highest price observed from 09:30 ET through the latest bar. */
  h: number;
  /** Lowest price observed from 09:30 ET through the latest bar. */
  l: number;
  /** Close of the latest 15-minute bar. */
  c: number;
  /** Sum of 15-minute volumes from 09:30 ET through the latest bar. */
  v: number;
  /** Epoch milliseconds of the latest 15-minute bar timestamp (ET). */
  io: number;
  /** Human-readable HH:mm ET of the latest bar. */
  it: string;
}

/**
 * Extract the intraday time-series object from an Alpha Vantage response.
 * Prefers the series key named in the metadata, falling back to any key that
 * contains "time series" (case-insensitive).
 */
export function extractIntradaySeries(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const rawObj = raw as Record<string, unknown>;
  const keys = Object.keys(rawObj);
  const meta =
    (rawObj['Meta Data'] as Record<string, unknown> | undefined) ||
    (rawObj['MetaData'] as Record<string, unknown> | undefined) ||
    {};
  const interval = (meta['4. Interval'] as string | undefined) || (meta['Interval'] as string | undefined);
  const expectedKey = interval ? `Time Series (${interval})` : undefined;
  const seriesKey =
    (expectedKey && keys.includes(expectedKey))
      ? expectedKey
      : keys.find((k) => k.toLowerCase().includes('time series'));
  const series = seriesKey ? rawObj[seriesKey] : undefined;
  return series && typeof series === 'object' ? (series as Record<string, unknown>) : undefined;
}

function getNumeric(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseProviderBar(vals: unknown): { o?: number; h?: number; l?: number; c?: number; v?: number } {
  if (!vals || typeof vals !== 'object') {
    return {};
  }
  const v = vals as Record<string, unknown>;
  return {
    o: getNumeric(v['1. open'] ?? v.open),
    h: getNumeric(v['2. high'] ?? v.high),
    l: getNumeric(v['3. low'] ?? v.low),
    c: getNumeric(v['4. close'] ?? v.close),
    v: getNumeric(v['5. volume'] ?? v.volume),
  };
}

const ET_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const ET_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatEtDate(ms: number): string {
  return ET_DATE_FORMATTER.format(new Date(ms));
}

function formatEtTime(ms: number): string {
  return ET_TIME_FORMATTER.format(new Date(ms));
}

interface ParsedBar {
  ms: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Aggregate today's regular-trading-hours 15-minute AV bars into a single
 * OHLCV bar anchored at 09:30 ET.
 *
 * @param raw Alpha Vantage TIME_SERIES_INTRADAY response.
 * @param marketDate ET trading date in YYYY-MM-DD form.
 * @param anchorTime RTH anchor time in HH:mm:ss form. Defaults to 09:30:00 ET.
 * @returns Aggregated bar, or null if no qualifying bars are found.
 */
export function aggregateIntradayRthBar(
  raw: unknown,
  marketDate: string,
  anchorTime = '09:30:00',
): IntradayRthBarAggregate | null {
  const series = extractIntradaySeries(raw);
  if (!series) {
    return null;
  }

  const anchorMs = parseAvEtTimestampMs(`${marketDate} ${anchorTime}`);
  if (!Number.isFinite(anchorMs)) {
    return null;
  }

  const bars = Object.entries(series)
    .map(([ts, vals]) => {
      const ms = parseAvEtTimestampMs(ts);
      if (!Number.isFinite(ms)) return null;
      const bar = parseProviderBar(vals);
      if (
        bar.o == null ||
        bar.h == null ||
        bar.l == null ||
        bar.c == null ||
        bar.v == null
      ) {
        return null;
      }
      return { ms, ...bar } as ParsedBar;
    })
    .filter((b): b is ParsedBar => b !== null && formatEtDate(b.ms) === marketDate && b.ms >= anchorMs);

  if (bars.length === 0) {
    return null;
  }

  bars.sort((a, b) => a.ms - b.ms);

  const first = bars[0];
  const last = bars[bars.length - 1];

  let high = first.h;
  let low = first.l;
  let volume = 0;
  for (const bar of bars) {
    if (bar.h > high) high = bar.h;
    if (bar.l < low) low = bar.l;
    volume += bar.v;
  }

  return {
    o: first.o,
    h: high,
    l: low,
    c: last.c,
    v: volume,
    io: last.ms,
    it: formatEtTime(last.ms),
  };
}
