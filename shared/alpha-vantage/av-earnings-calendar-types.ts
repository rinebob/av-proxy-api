/**
 * TypeScript types for the Alpha Vantage EARNINGS_CALENDAR endpoint response.
 * @see https://www.alphavantage.co/documentation/#earnings-calendar
 *
 * AV returns this endpoint as CSV (not JSON). These types represent the
 * parsed row structure. `estimate` and `timeOfTheDay` can be empty strings
 * when AV has no estimate or timing data for a given entry — other fields
 * (symbol, name, reportDate, fiscalDateEnding, currency) are always populated.
 */

export interface AvEarningsCalendarEntry {
  symbol: string;
  name: string;
  reportDate: string;
  fiscalDateEnding: string;
  estimate: string;
  currency: string;
  timeOfTheDay: string;
}
