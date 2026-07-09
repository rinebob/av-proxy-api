import { Timestamp } from 'firebase-admin/firestore';

import type { CompactBar } from '@shared/alpha-vantage';
import { DayOfWeek } from '@shared/alpha-vantage';

/**
 * Format a Firestore Timestamp as a human-readable PT date-time string.
 * @param ts Firestore Timestamp
 * @returns Formatted string in PT (e.g. "Jul 7, 2026, 3:30 PM")
 */
export function formatPtDateTime(ts: Timestamp): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Los_Angeles',
  }).format(ts.toDate());
}

/**
 * Derives a YYYY-MM-DD string from a CompactBar, preferring the stored `d` field
 * and falling back to epoch-ms `t` conversion.
 * Used consistently wherever a bar's calendar date is needed for period matching.
 */
export function barDateStr(b: CompactBar): string | null {
  if (b.d) return b.d;
  if (typeof b.t === 'number') return new Date(b.t).toISOString().slice(0, 10);
  return null;
}

/**
 * Shared ET time formatter for intraday snapshot strings (HH:mm, 24-hour clock).
 * Exported so daily and W/M writers reuse the same instance instead of creating
 * a new Intl.DateTimeFormat on every transaction.
 */
export const INTRADAY_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Compute DayOfWeek label from a trading date string (YYYY-MM-DD) using UTC midnight.
 * @param d ISO date string (YYYY-MM-DD)
 * @returns DayOfWeek label (Sun..Sat)
 */
export function computeDowFromDateString(d: string): DayOfWeek {
  const dt = new Date(`${d}T00:00:00.000Z`);
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  switch (day) {
    case 0: return DayOfWeek.Sun;
    case 1: return DayOfWeek.Mon;
    case 2: return DayOfWeek.Tue;
    case 3: return DayOfWeek.Wed;
    case 4: return DayOfWeek.Thu;
    case 5: return DayOfWeek.Fri;
    case 6: return DayOfWeek.Sat;
    default: return DayOfWeek.Mon;
  }
}

/** Returns today's ET trading date as YYYY-MM-DD. */
export function todayEtDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * Format an Eastern Time date-time string 'YYYY-MM-DD HH:mm:ss' for an epoch millis.
 * @param tsMs Epoch milliseconds
 * @returns ET formatted string with seconds precision
 */
export function formatEtDateTime(tsMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(tsMs));
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second}`;
}

/**
 * Helper: round a number to 2 decimal places.
 * @param n Number to round
 * @returns Rounded number
 */
export function round2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Find the bar with the largest `t` strictly less than `targetT`.
 * This is the canonical predecessor lookup used by intraday writers when they
 * need the previous period's close to compute change metrics.
 * @param bars Array of bars (order does not matter)
 * @param targetT Target epoch ms
 * @returns The immediate predecessor bar, or null if none exists
 */
export function findImmediatePredecessorBar(bars: Array<CompactBar>, targetT: number): CompactBar | null {
  return bars.reduce<CompactBar | null>(
    (p, b) => (b.t < targetT && (!p || b.t > p.t) ? b : p),
    null,
  );
}

/**
 * Compute change metrics from a previous close and a current close.
 * - `change` = currentClose - prevClose, rounded to 2dp
 * - `changePercent` = (change / prevClose) * 100, rounded to 2dp (undefined if prevClose is 0)
 * @param prevClose Previous period close (may be null/undefined)
 * @param currentClose Current close
 * @returns Object with change and changePercent (undefined when prevClose is not finite)
 */
export function computeChangeMetrics(
  prevClose: number | null | undefined,
  currentClose: number,
): { change: number | undefined; changePercent: number | undefined } {
  const prev = Number(prevClose);
  if (!Number.isFinite(prev)) {
    return { change: undefined, changePercent: undefined };
  }
  const change = Number((currentClose - prev).toFixed(2));
  const changePercent = prev !== 0 ? Number(((currentClose - prev) / prev * 100).toFixed(2)) : undefined;
  return { change, changePercent };
}

/**
 * Compute EOD change metrics for a sorted array of bars in-place.
 * - ch = currClose - prevClose
 * - cp = (ch / prevClose) * 100
 * - Uses RAW close (c) only as the baseline; omits when baseline is missing/zero.
 * @param bars Sorted ascending array of CompactBar
 */
export function computeChCpForBarsAscending(bars: Array<CompactBar>): void {
  if (!Array.isArray(bars) || bars.length === 0) return;
  // Assume already sorted ascending by t.
  for (let i = 0; i < bars.length; i++) {
    const curr = bars[i];
    const prev = i > 0 ? bars[i - 1] : undefined;
    const prevClose = prev?.c;
    const currClose = curr?.c;
    if (prevClose != null && prevClose !== 0 && currClose != null) {
      const change = currClose - prevClose;
      const pct = (change / prevClose) * 100;
      curr.ch = round2(change);
      curr.cp = round2(pct);
    } else {
      delete (curr as any).ch;
      delete (curr as any).cp;
    }
  }
}

/**
 * Recompute EOD change metrics for a specific index within a sorted bars array.
 * - Uses the immediate previous bar as the baseline.
 * - Uses RAW close (c) only and omits when baseline is missing/zero.
 * @param bars Sorted ascending array of CompactBar
 * @param index Index of the target bar to recompute
 */
export function computeChCpForTargetIndex(bars: Array<CompactBar>, index: number): void {
  if (!Array.isArray(bars) || index < 0 || index >= bars.length) return;
  const curr = bars[index];
  const prev = index > 0 ? bars[index - 1] : undefined;
  const prevClose = prev?.c;
  const currClose = curr?.c;
  if (prevClose != null && prevClose !== 0 && currClose != null) {
    const change = currClose - prevClose;
    const pct = (change / prevClose) * 100;
    curr.ch = round2(change);
    curr.cp = round2(pct);
  } else {
    delete (curr as any).ch;
    delete (curr as any).cp;
  }
}

/**
 * Build the top-level metadata object that is stored alongside the `bars` array
 * in a time-series year-shard or all-doc. Assumes `bars` is already sorted by `t`.
 *
 * This is a pure function so the same computation can be shared by all writers
 * without copying the same logic into each module.
 */
export function buildLatestMetadataFromBars(bars: Array<CompactBar>): {
  count: number;
  firstBarTs: number | null;
  lastBarTs: number | null;
  latest: CompactBar | null;
  latestUtcIso: string | null;
  latestEtDateTime: string | null;
  latestIoUtcIso: string | null;
  latestIoEtDateTime: string | null;
  version: string;
} {
  const latestBar = bars[bars.length - 1] ?? null;
  return {
    count: bars.length,
    firstBarTs: bars[0]?.t ?? null,
    lastBarTs: bars[bars.length - 1]?.t ?? null,
    latest: latestBar,
    latestUtcIso: latestBar?.t != null ? new Date(latestBar.t).toISOString() : null,
    latestEtDateTime: latestBar?.t != null ? formatEtDateTime(latestBar.t) : null,
    latestIoUtcIso: latestBar?.io != null ? new Date(Number(latestBar.io)).toISOString() : null,
    latestIoEtDateTime: latestBar?.io != null ? formatEtDateTime(Number(latestBar.io)) : null,
    version: `${bars[bars.length - 1]?.t ?? ''}-${bars.length}`,
  };
}
