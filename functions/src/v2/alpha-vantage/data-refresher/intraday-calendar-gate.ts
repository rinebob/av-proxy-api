import { MarketCalendarService } from '../../common/market-calendar/market-calendar.service';

/**
 * Intraday calendar gate skip reasons.
 *
 * - `weekend` — the market date falls on Saturday or Sunday.
 * - `holiday` — the market date is a full-closure NYSE/Nasdaq holiday.
 * - `post_early_close` — the market date is an early-close day and the
 *   tick fires after the early-close time.
 */
export type IntradaySkipReason = 'weekend' | 'holiday' | 'post_early_close';

/**
 * Checks whether the intraday scheduler should skip job creation for the
 * given market date and PT clock time.
 *
 * Returns the skip reason if the market is closed, or `null` if the market
 * is open and jobs should be created.
 *
 * This encapsulates the calendar gate logic so it can be tested in
 * isolation without mocking Firestore or Cloud Tasks.
 */
export function getIntradaySkipReason(
  marketDate: string,
  clockPt: string,
): IntradaySkipReason | null {
  const calendar = new MarketCalendarService();

  if (!calendar.isTradingDay(marketDate)) {
    // Distinguish weekend from holiday using the day of week.
    const [y, m, d] = marketDate.split('-').map(Number);
    const jsDate = new Date(y, m - 1, d);
    const dow = jsDate.getDay();
    if (dow === 0 || dow === 6) {
      return 'weekend';
    }
    return 'holiday';
  }

  if (!calendar.isMarketOpenAt(marketDate, clockPt)) {
    return 'post_early_close';
  }

  return null;
}
