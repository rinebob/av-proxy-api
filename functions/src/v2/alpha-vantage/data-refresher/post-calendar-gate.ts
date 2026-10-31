import { MarketCalendarService } from '../../common/market-calendar/market-calendar.service';

/**
 * POST calendar gate skip reasons.
 *
 * - `weekend` — the market date falls on Saturday or Sunday.
 * - `holiday` — the market date is a full-closure NYSE/Nasdaq holiday.
 *
 * Unlike the intraday gate there is no `post_early_close` reason: the
 * POST passes fire after the close, so an early-close day is still a
 * full trading day for their purposes.
 */
export type PostSkipReason = 'weekend' | 'holiday';

/**
 * Checks whether the POST pipeline should skip work for the given ET
 * market date (YYYY-MM-DD).
 *
 * Returns the skip reason if the market was closed all day, or `null`
 * when runs were expected. Mirrors `getIntradaySkipReason` so callers
 * can be tested without mocking Firestore or Cloud Tasks.
 */
export function getPostSkipReason(marketDate: string): PostSkipReason | null {
  const calendar = new MarketCalendarService();

  if (calendar.isTradingDay(marketDate)) {
    return null;
  }

  const [y, m, d] = marketDate.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6 ? 'weekend' : 'holiday';
}
