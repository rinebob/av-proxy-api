/**
 * Alpha Vantage API endpoint paths
 */
export enum AlphaVantageEndpoints {
  GET_DAILY_STOCK_DATA_SIMPLE = 'getDailyStockDataSimple',
  GET_GLOBAL_QUOTE = 'getGlobalQuote',
}

/**
 * Benzinga API endpoint paths
 */
export enum BenzingaEndpoints {
  GET_CALENDAR = 'getBenzingaCalendar',
  // Add more Benzinga endpoints here as they're created
}

/**
 * Type that includes all possible endpoint enums
 */
export type ApiEndpoints = AlphaVantageEndpoints | BenzingaEndpoints;
