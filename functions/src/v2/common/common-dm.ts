/**
 * Shared types and constants for Data Maintainer functionality between frontend and backend
 */

import * as admin from 'firebase-admin';

// Metadata server URL for fetching identity tokens in Google Cloud
// This is used for service-to-service authentication
// https://cloud.google.com/compute/docs/access/authenticate-workloads#applications
// https://cloud.google.com/functions/docs/securing/authenticating#function-to-function
// https://cloud.google.com/run/docs/authenticate/service-to-service#nodejs
export const METADATA_SERVER_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=';

/**
 * Enum for Data Maintainer endpoints used in the UI and backend integration.
 * Keep this in sync with the frontend version in fe-common-dm.ts
 */
export enum DataMaintainerEndpoint {
  // Benzinga Endpoints (alphabetical order)
  ANALYST_INSIGHTS = 'analyst-insights',
  ANALYST_RATINGS = 'analyst-ratings',
  DIVIDENDS = 'dividends',
  ECONOMIC_CALENDAR = 'economic-calendar',
  FUTURE_EARNINGS = 'future-earnings',
  INSIDER_TRADES = 'insider-trades',
  MERGERS_ACQUISITIONS = 'mergers-acquisitions',
  TRENDING_TICKERS = 'trending-tickers',
  UNUSUAL_OPTIONS = 'unusual-options',
  
  // Alpha Vantage Endpoints (alphabetical order)
  BALANCE_SHEET = 'balance-sheet',
  CASH_FLOW = 'cash-flow',
  COMPANY_OVERVIEW = 'company-overview',
  ECONOMIC_INDICATORS = 'economic-indicators',
  EARNINGS_CALENDAR = 'earnings-calendar',
  GLOBAL_QUOTE = 'global-quote',
  HISTORICAL_EPS = 'historical-eps',
  HISTORICAL_OPTIONS = 'historical-options',
  INCOME_STATEMENT = 'income-statement',
  INSIDER_TRANSACTIONS = 'insider-transactions',
  IPO_CALENDAR = 'ipo-calendar',
  NEWS_SENTIMENT = 'news-sentiment',
  OPTIONS_CHAIN = 'options-chain',
  SECTOR = 'sector',
  SYMBOL_SEARCH = 'symbol-search',
  TECHNICAL_INDICATORS = 'technical-indicators',
  TIME_SERIES_DAILY_ADJUSTED = 'time-series-daily-adjusted',
  TIME_SERIES_INTRADAY = 'time-series-intraday',
  TOP_GAINERS_LOSERS = 'top-gainers-losers',
  TREASURY_YIELD = 'treasury-yield',
  
  // Legacy/Deprecated (alphabetical order, keep for backward compatibility)
  EARNINGS = 'earnings',
  LISTING_STATUS = 'listing-status',
  OVERVIEW = 'overview',
  QUOTE_ENDPOINT = 'quote',
  SECTOR_PERFORMANCE = 'sector-performance',
  TIME_SERIES = 'time-series',
}

/**
 * Represents a symbol from Alpha Vantage SYMBOL_SEARCH endpoint
 * This is the canonical shape for all symbol data in the system
 */
export interface AvSymbol {
    // AV SYMBOL_SEARCH response object fields
    symbol: string;
    name: string;
    type: string;
    region: string;
    marketOpen: string;
    marketClose: string;
    timezone: string;
    currency: string;
    matchScore: string;
}

/**
 * Represents a symbol from Alpha Vantage SYMBOL_SEARCH endpoint
 * This is the canonical shape for all symbol data in the system
 */
export interface TrackedSymbolV2 extends AvSymbol {
  // System fields. _ prefix to allow flattening without mixing with AV fields
  _createdAt: admin.firestore.Timestamp | Date;
  _lastUpdated: admin.firestore.Timestamp | Date;

  // Is currently on at least one users personal symbol watchlist
  // This is used to determine if a symbol should be included in the list of symbols to refresh
  _isActive: boolean;

  // Explicit dev-only flag to specifically enable data refreshing
  // If true, AV data will be regularly refreshed for this symbol
  // Be careful about request limits
  _refreshEnabled: boolean;  
}

export interface ListSymbolsV2Response {
    symbols: TrackedSymbolV2[];
    total: number;
    limit: number;
    offset: number;
}

// Centralized Firestore field names for tracked symbols
export const TRACKED_SYMBOL_V2_FIELDS = {
  SYMBOL: 'symbol',
  NAME: 'name',
  TYPE: 'type',
  REGION: 'region',
  MARKET_OPEN: 'marketOpen',
  MARKET_CLOSE: 'marketClose',
  TIMEZONE: 'timezone',
  CURRENCY: 'currency',
  MATCH_SCORE: 'matchScore',
  CREATED_AT: '_createdAt',
  LAST_UPDATED: '_lastUpdated',
  IS_ACTIVE: '_isActive',
  REFRESH_ENABLED: '_refreshEnabled',
};

// Add this function near the top of your file or in a utils module
export function toTrackedSymbolV2(doc: FirebaseFirestore.DocumentData): TrackedSymbolV2 {
    // console.log('sMSvc toTrackedSymbolV2 input doc: ', doc);
    return {
      symbol: doc[TRACKED_SYMBOL_V2_FIELDS.SYMBOL] ?? '',
      name: doc[TRACKED_SYMBOL_V2_FIELDS.NAME] ?? '',
      type: doc[TRACKED_SYMBOL_V2_FIELDS.TYPE] ?? '',
      region: doc[TRACKED_SYMBOL_V2_FIELDS.REGION] ?? '',
      marketOpen: doc[TRACKED_SYMBOL_V2_FIELDS.MARKET_OPEN] ?? '',
      marketClose: doc[TRACKED_SYMBOL_V2_FIELDS.MARKET_CLOSE] ?? '',
      timezone: doc[TRACKED_SYMBOL_V2_FIELDS.TIMEZONE] ?? '',
      currency: doc[TRACKED_SYMBOL_V2_FIELDS.CURRENCY] ?? '',
      matchScore: doc[TRACKED_SYMBOL_V2_FIELDS.MATCH_SCORE] ?? '',
      _createdAt: doc[TRACKED_SYMBOL_V2_FIELDS.CREATED_AT] ?? null,
      _lastUpdated: doc[TRACKED_SYMBOL_V2_FIELDS.LAST_UPDATED] ?? null,
      _isActive: doc[TRACKED_SYMBOL_V2_FIELDS.IS_ACTIVE] ?? false,
      _refreshEnabled: doc[TRACKED_SYMBOL_V2_FIELDS.REFRESH_ENABLED] ?? false,
    };
  }

/**
 * Converts Firestore Timestamp fields in TrackedSymbolV2 objects to ISO strings for serialization.
 */
export function serializeTrackedSymbols(symbols: any[]): any[] {
  return (symbols || []).map(symbol => ({
    ...symbol,
    _createdAt: symbol._createdAt && typeof symbol._createdAt.toDate === 'function'
      ? symbol._createdAt.toDate().toISOString()
      : symbol._createdAt,
    _lastUpdated: symbol._lastUpdated && typeof symbol._lastUpdated.toDate === 'function'
      ? symbol._lastUpdated.toDate().toISOString()
      : symbol._lastUpdated,
  }));
}

/**
 * Options for listing symbols
 */
export interface ListSymbolsOptions {
  activeOnly?: boolean;
  includeInactive?: boolean; // For backward compatibility
  limit?: number;
  offset?: number;
  sortBy?: 'symbol' | 'lastUpdated';
  sortDirection?: 'asc' | 'desc';

}


/**
 * Set of endpoints that have been implemented and are ready for automatic refresh.
 * Add endpoints to this set as they are implemented.
 */
export const IMPLEMENTED_ENDPOINTS: Set<DataMaintainerEndpoint> = new Set([
  DataMaintainerEndpoint.COMPANY_OVERVIEW,
  // Add other endpoints here as they are implemented
]);

/**
 * Interface for mock data registry
 */
export interface MockDataRegistry {
  [endpoint: string]: {
    [symbol: string]: any; // Any because different endpoints have different data shapes
  };
}

export interface MockDataResponse<T = any> {
  ok: boolean;
  symbol: string;
  endpoint: DataMaintainerEndpoint;
  data: T;
}

export interface MockDataCheckResponse {
  available: boolean;
  symbol: string;
  endpoint: DataMaintainerEndpoint;
}
