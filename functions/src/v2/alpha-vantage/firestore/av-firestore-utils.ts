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
