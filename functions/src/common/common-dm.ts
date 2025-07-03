/**
 * Shared types and constants for Data Maintainer functionality between frontend and backend
 */

import * as admin from 'firebase-admin';

/**
 * Result of a refresh operation
 */
export interface RefreshResult {
  success: boolean;
  refreshed: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

/**
 * Represents a document to be processed during refresh
 */
export interface DocumentToProcess {
  symbol: string;
  endpoint: DataMaintainerEndpoint;
  ttl: number;
}

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

// Symbol Management Types
// Note: These types are now defined below with more complete definitions

export interface ListSymbolsResponse {
  symbols: TrackedSymbol[];
  total: number;
  limit: number;
  offset: number;
}

// Symbol Management Types
export interface ClientSource {
  clientId: string;
  firstSeen: admin.firestore.Timestamp;
  lastSeen: admin.firestore.Timestamp;
  metadata?: Record<string, any>;
}

/**
 * Represents a tracked symbol in the system
 */
export interface TrackedSymbol {
  symbol: string;
  displayName?: string;
  isActive: boolean;
  lastUpdated: admin.firestore.Timestamp | Date;
  createdAt: admin.firestore.Timestamp | Date;
  sources: ClientSource[];

  metadata?: Record<string, any>;
  deactivatedAt?: admin.firestore.Timestamp | Date;
}

/**
 * Represents a client site that tracks symbols
 */
export interface ClientSite {
  id: string;
  name: string;
  apiKey: string;
  lastActive: admin.firestore.Timestamp | Date;
  symbolCount: number;
  metadata?: Record<string, any>;
  createdAt: admin.firestore.Timestamp | Date;
  updatedAt: admin.firestore.Timestamp | Date;
  lastSync?: admin.firestore.Timestamp | Date; // For backward compatibility
  isActive?: boolean; // For backward compatibility
}

/**
 * Request to sync symbols from a client site
 */
export interface SymbolSyncRequest {
  clientId: string;
  clientName?: string;
  siteId?: string;
  symbols: string[];
  timestamp: admin.firestore.Timestamp | Date;
  metadata?: Record<string, any>;
}

/**
 * Response from a symbol sync operation
 */
export interface SymbolSyncResponse {
  success: boolean;
  message?: string;
  added: number;
  removed: number;
  totalActive: number;
  timestamp: admin.firestore.Timestamp | Date;
  // For backward compatibility
  addedCount?: number;
  removedCount?: number;
  totalTracked?: number;
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
 * Response from listing symbols
 */
export interface ListSymbolsResponse {
  symbols: TrackedSymbol[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * TTL configuration in seconds for each endpoint
 * These values should match the TTLs specified in data-maintainer.md
 */
export const ENDPOINT_TTLS: Record<DataMaintainerEndpoint, number> = {
  // Benzinga Endpoints (alphabetical order)
  [DataMaintainerEndpoint.ANALYST_INSIGHTS]: 72 * 60 * 60, // 72 hours
  [DataMaintainerEndpoint.ANALYST_RATINGS]: 72 * 60 * 60, // 72 hours
  [DataMaintainerEndpoint.DIVIDENDS]: 24 * 60 * 60, // 24 hours (recent), Indefinite handled in code
  [DataMaintainerEndpoint.ECONOMIC_CALENDAR]: 24 * 60 * 60, // 24 hours (future), Indefinite handled in code
  [DataMaintainerEndpoint.FUTURE_EARNINGS]: 4 * 60 * 60, // 4 hours (pre-release), Indefinite handled in code
  [DataMaintainerEndpoint.INSIDER_TRADES]: 24 * 60 * 60, // 24 hours (recent), 7 days handled in code
  [DataMaintainerEndpoint.MERGERS_ACQUISITIONS]: 24 * 60 * 60, // 24 hours (minimum, up to 7 days)
  [DataMaintainerEndpoint.TRENDING_TICKERS]: 15 * 60, // 15 minutes (trading hours)
  [DataMaintainerEndpoint.UNUSUAL_OPTIONS]: 5 * 60, // 5 minutes (trading hours)
  
  // Alpha Vantage Endpoints (alphabetical order)
  [DataMaintainerEndpoint.BALANCE_SHEET]: 30 * 24 * 60 * 60, // 30 days (quarterly refresh)
  [DataMaintainerEndpoint.CASH_FLOW]: 30 * 24 * 60 * 60, // 30 days (quarterly refresh)
  [DataMaintainerEndpoint.COMPANY_OVERVIEW]: 8 * 60 * 60, // 8 hours (temporary for production testing)
  [DataMaintainerEndpoint.ECONOMIC_INDICATORS]: 24 * 60 * 60, // 24 hours (most recent), Indefinite handled in code
  [DataMaintainerEndpoint.EARNINGS_CALENDAR]: 7 * 24 * 60 * 60, // 7 days
  [DataMaintainerEndpoint.GLOBAL_QUOTE]: 30, // 30 seconds
  [DataMaintainerEndpoint.HISTORICAL_EPS]: 30 * 24 * 60 * 60, // 30 days (quarterly refresh)
  [DataMaintainerEndpoint.HISTORICAL_OPTIONS]: 30 * 24 * 60 * 60, // 30 days (indefinite in doc, using 30 days as default)
  [DataMaintainerEndpoint.INCOME_STATEMENT]: 30 * 24 * 60 * 60, // 30 days (quarterly refresh)
  [DataMaintainerEndpoint.INSIDER_TRANSACTIONS]: 24 * 60 * 60, // 24 hours (recent), 7 days handled in code
  [DataMaintainerEndpoint.IPO_CALENDAR]: 24 * 60 * 60, // 24 hours
  [DataMaintainerEndpoint.NEWS_SENTIMENT]: 15 * 60, // 15 minutes (recent), Indefinite handled in code
  [DataMaintainerEndpoint.OPTIONS_CHAIN]: 30, // 30 seconds
  [DataMaintainerEndpoint.SECTOR]: 15 * 60, // 15 minutes (trading hours)
  [DataMaintainerEndpoint.SYMBOL_SEARCH]: 30 * 24 * 60 * 60, // 30 days (indefinite in doc, using 30 days as default)
  [DataMaintainerEndpoint.TECHNICAL_INDICATORS]: 5 * 60, // 5 minutes (intraday), 24h handled in code
  [DataMaintainerEndpoint.TIME_SERIES_DAILY_ADJUSTED]: 24 * 60 * 60, // 24 hours
  [DataMaintainerEndpoint.TIME_SERIES_INTRADAY]: 5 * 60, // 5 minutes (current day), Indefinite handled in code
  [DataMaintainerEndpoint.TOP_GAINERS_LOSERS]: 15 * 60, // 15 minutes (trading hours)
  [DataMaintainerEndpoint.TREASURY_YIELD]: 24 * 60 * 60, // 24 hours
  
  // Legacy/Deprecated - keeping these for backward compatibility (alphabetical order)
  [DataMaintainerEndpoint.EARNINGS]: 24 * 60 * 60, // 24 hours
  [DataMaintainerEndpoint.LISTING_STATUS]: 7 * 24 * 60 * 60, // 7 days
  [DataMaintainerEndpoint.OVERVIEW]: 24 * 60 * 60, // 24 hours
  [DataMaintainerEndpoint.QUOTE_ENDPOINT]: 5 * 60, // 5 minutes
  [DataMaintainerEndpoint.SECTOR_PERFORMANCE]: 60 * 60, // 1 hour
  [DataMaintainerEndpoint.TIME_SERIES]: 60 * 60, // 1 hour
};

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
