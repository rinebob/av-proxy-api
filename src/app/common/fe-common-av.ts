/**
 * This file contains shared interfaces for Alpha Vantage API parameters.
 */

/**
 * Parameters for the getDailyStockDataSimple Cloud Function.
 */
export interface DailyStockParams {
  symbol: string;
  outputsize?: 'compact' | 'full';
}

/**
 * Parameters for the getGlobalQuote Cloud Function.
 */
export interface GlobalQuoteParams {
  symbol: string;
}
