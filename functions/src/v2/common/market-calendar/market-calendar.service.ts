import {
  UNIFIED_MARKET_HOLIDAYS,
  type MarketHolidayItem,
} from './market-holidays.data';

/**
 * Market calendar service backed by the static holiday data file.
 *
 * This is the authoritative source of truth for the intraday pipeline's
 * market-open/closed decisions. The static list is maintained annually;
 * a missing year throws loudly rather than silently returning no holidays.
 *
 * PT-to-ET conversion: the scheduler runs in America/Los_Angeles and fires
 * at fixed PT clock times (0800, 1000, 1200). ET is 3 hours ahead of PT
 * during normal trading hours. This service owns that conversion so
 * callers pass PT clock times directly.
 */
export class MarketCalendarService {
  private static readonly PT_TO_ET_OFFSET_HOURS = 3;

  /**
   * True if the market is open on the given ET date (YYYY-MM-DD).
   * Returns false for weekends and NYSE-observed holidays.
   * Early-close days are still trading days — the market opens, just closes early.
   */
  isTradingDay(date: string): boolean {
    const dayOfWeek = this.getDayOfWeek(date);
    if (dayOfWeek === 0 || dayOfWeek === 6) return false; // Sun or Sat

    const holiday = this.findHoliday(date);
    if (holiday && holiday.status === 'closed') return false;

    return true;
  }

  /**
   * True if the market is open at the given PT clock time on the given ET date.
   * Returns false for weekends, holidays, and ticks that fire after an early-close time.
   * Internally converts PT HHMM to ET wall-clock for comparison.
   *
   * Boundary: if the ET time equals the early-close time, the market is still
   * considered open (the tick fires at the close moment, not after it).
   */
  isMarketOpenAt(date: string, clockPt: string): boolean {
    if (!this.isTradingDay(date)) return false;

    const earlyCloseEt = this.getEarlyCloseEt(date);
    if (!earlyCloseEt) return true; // No early close — market open all day

    const etMinutes = this.ptToEtMinutes(clockPt);
    const closeMinutes = this.parseTimeToMinutes(earlyCloseEt);
    return etMinutes <= closeMinutes;
  }

  /**
   * Returns the early-close ET time (e.g. "13:00") for the date, or null.
   * Returns null for normal trading days and full-closure holidays.
   */
  getEarlyCloseEt(date: string): string | null {
    const holiday = this.findHoliday(date);
    if (holiday && holiday.status === 'early_close' && holiday.earlyCloseEt) {
      return holiday.earlyCloseEt;
    }
    return null;
  }

  /**
   * Finds the holiday entry for the given date, if any.
   * Throws if the year is not covered by the static data.
   */
  private findHoliday(date: string): MarketHolidayItem | undefined {
    const year = date.substring(0, 4);
    const yearData = UNIFIED_MARKET_HOLIDAYS[year];
    if (!yearData) {
      throw new Error(
        `MarketCalendarService: no holiday data for year ${year}. ` +
          'The static holiday list must be updated annually. ' +
          'See functions/src/v2/common/market-calendar/market-holidays.data.ts.',
      );
    }
    return yearData.holidays.find((h) => h.date === date);
  }

  /**
   * Returns the day of week (0 = Sunday, 6 = Saturday) for the given YYYY-MM-DD date.
   */
  private getDayOfWeek(date: string): number {
    // Parse as local date at midnight to avoid UTC offset issues.
    const [y, m, d] = date.split('-').map(Number);
    const jsDate = new Date(y, m - 1, d);
    return jsDate.getDay();
  }

  /**
   * Converts a PT HHMM string (e.g. "0800") to ET minutes since midnight.
   * PT is 3 hours behind ET during normal trading hours.
   */
  private ptToEtMinutes(clockPt: string): number {
    const hours = parseInt(clockPt.substring(0, 2), 10);
    const minutes = parseInt(clockPt.substring(2, 4), 10);
    const ptMinutes = hours * 60 + minutes;
    const etMinutes = ptMinutes + MarketCalendarService.PT_TO_ET_OFFSET_HOURS * 60;
    return etMinutes;
  }

  /**
   * Parses an ET time string (e.g. "13:00") to minutes since midnight.
   */
  private parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}
