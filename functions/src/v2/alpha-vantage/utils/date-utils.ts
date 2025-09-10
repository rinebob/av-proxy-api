/**
 * Date utilities for Alpha Vantage handlers.
 */

/**
 * Parses an ISO-like date string into epoch milliseconds.
 * Returns NaN if the date is invalid.
 */
export function parseIsoDateMs(iso: string): number {
  return new Date(iso).getTime();
}
