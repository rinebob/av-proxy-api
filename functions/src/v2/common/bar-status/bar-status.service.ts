import { TimeSeriesInterval } from '@shared/alpha-vantage';
import type { CompactBar } from '@shared/alpha-vantage';
import { isUsMarketHolidayEt } from '../../utils/utils';
import { INTRADAY_FIRST_TICK } from '../../alpha-vantage/jobs/job-config';

/**
 * Returns the next US market trading day after the given YYYY-MM-DD date string.
 * Skips weekends and NYSE holidays (computed algorithmically via isUsMarketHolidayEt).
 */
export function nextTradingDay(dateStr: string): string {
  let d = new Date(`${dateStr}T00:00:00Z`);
  do {
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  } while (isWeekendUtc(d) || isUsMarketHolidayEt(toEtLocalDate(d)));
  return toDateStr(d);
}

/**
 * Returns the previous US market trading day before the given YYYY-MM-DD date string.
 * Skips weekends and NYSE holidays (computed algorithmically via isUsMarketHolidayEt).
 */
export function prevTradingDay(dateStr: string): string {
  let d = new Date(`${dateStr}T00:00:00Z`);
  do {
    d = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  } while (isWeekendUtc(d) || isUsMarketHolidayEt(toEtLocalDate(d)));
  return toDateStr(d);
}

/**
 * Computes the barStatus for a single bar at serve time. No pipeline params required.
 *
 * Phase is inferred from the bar itself:
 *  - bar.ip present → last written by a PRE (intraday snapshot) run
 *  - bar.ip absent  → last written by a POST (EOD finalized) run
 *
 * Rules:
 *  - Historical bars (bar.d < todayEt) → always 1 (closed, never changes)
 *  - Trailing bar (bar.d === todayEt):
 *      DAILY:   PRE (ip present) → 0, POST → 1
 *               Note: -1 for daily cannot be computed at serve time (clockPt unknown here).
 *               RS uses the PDR notification's barStatus for the -1 signal on daily.
 *      WEEKLY:  PRE && prevTradingDay crosses ISO week → -1, PRE other → 0
 *               POST && nextTradingDay crosses ISO week → 1, POST other → 0
 *      MONTHLY: PRE && prevTradingDay crosses month → -1, PRE other → 0
 *               POST && nextTradingDay crosses month → 1, POST other → 0
 *
 * @param bar      The CompactBar being evaluated.
 * @param interval The time-series interval (daily/weekly/monthly).
 * @param todayEt  Current ET trading date as YYYY-MM-DD.
 *
 * NOTE: Currently unused — retained for the upcoming W/M intraday snapshot feature
 * where serve-time barStatus inference may be needed for bars not yet written by a
 * pipeline run (see `wm-intraday-snapshot-plan.md`).
 */
export function computeBarStatus(
  bar: CompactBar,
  interval: TimeSeriesInterval,
  todayEt: string,
): -1 | 0 | 1 {
  const barDate = bar.d ?? epochToDateStr(bar.t);

  // All historical bars are definitively closed
  if (barDate < todayEt) return 1;

  // Infer phase from bar content: ip present → PRE run wrote this bar last
  const isPre = bar.ip != null;

  if (interval === TimeSeriesInterval.DAILY) {
    return isPre ? 0 : 1;
  }

  if (interval === TimeSeriesInterval.WEEKLY) {
    if (isPre) {
      const prev = prevTradingDay(todayEt);
      return isoWeek(prev) !== isoWeek(todayEt) ? -1 : 0;
    }
    const next = nextTradingDay(todayEt);
    return isoWeek(next) !== isoWeek(todayEt) ? 1 : 0;
  }

  if (interval === TimeSeriesInterval.MONTHLY) {
    if (isPre) {
      const prev = prevTradingDay(todayEt);
      return monthOf(prev) !== monthOf(todayEt) ? -1 : 0;
    }
    const next = nextTradingDay(todayEt);
    return monthOf(next) !== monthOf(todayEt) ? 1 : 0;
  }

  return 0;
}

/**
 * Computes the `barStatusDaily` attribute for a PRE PDR notification.
 * Used by the intraday snapshot aggregator only.
 *
 * NOTE: Once W/M intraday snapshot writes are implemented (see `wm-intraday-snapshot-plan.md`),
 * the aggregator will also emit `barStatusWeekly` and `barStatusMonthly` on PRE PDRs.
 * Those values will be computed using `prevTradingDay` period-boundary logic, not via
 * this function — extend the aggregator directly at that time.
 *
 * POST per-interval values (`barStatusWeekly`, `barStatusMonthly`) are computed
 * inline in the POST publisher using `nextTradingDay` calendar logic — not here.
 *
 *   PRE, first tick of day (clockPt === INTRADAY_FIRST_TICK) → -1
 *   PRE, subsequent ticks                                    →  0
 *   POST (unused here, included for completeness)            →  1
 */
export function computeRunBarStatus(
  phase: 'pre' | 'post',
  clockPt: string,
): -1 | 0 | 1 {
  if (phase === 'post') return 1;
  return clockPt === INTRADAY_FIRST_TICK ? -1 : 0;
}

/** Returns the current PT wall-clock time as HHMM (e.g. '0800'). Matches the intraday scheduler timezone. */
export function clockPtNow(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date()).replace(':', '');
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** True if the UTC date falls on Saturday (6) or Sunday (0). */
function isWeekendUtc(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Converts a UTC midnight Date to an ET-local Date suitable for
 * isUsMarketHolidayEt. Uses Intl to parse the ET wall-clock date.
 * # Reason: isUsMarketHolidayEt expects a local ET Date (getFullYear/Month/Date).
 */
function toEtLocalDate(utcDate: Date): Date {
  const etStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(utcDate);
  // etStr is YYYY-MM-DD; parse as local (no Z suffix) so getFullYear/Month/Date work
  return new Date(etStr);
}

/** Formats a UTC midnight Date as YYYY-MM-DD. */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Derives a YYYY-MM-DD string from epoch milliseconds (UTC midnight). */
function epochToDateStr(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Returns the ISO week number (1-53) for a YYYY-MM-DD string.
 * Uses the standard ISO 8601 algorithm: week containing the first Thursday.
 */
export function isoWeek(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  // Thursday of the same week (ISO weeks run Mon-Sun; Thu determines the year/week)
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + (4 - (d.getUTCDay() || 7)));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

/** Returns the calendar month (1-12) for a YYYY-MM-DD string. */
export function monthOf(dateStr: string): number {
  return parseInt(dateStr.slice(5, 7), 10);
}
