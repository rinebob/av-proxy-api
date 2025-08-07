// COPIED FROM functions/src/v2/common/common-av.ts. Do not use directly until migration is complete.

import { TimestampLike } from "../firestore";

// Canonical shared symbol match interface for Alpha Vantage symbol search (normalized keys)
export interface SvtAvSymbolMatch {
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

export interface AlphaVantageSymbolMatch {
    "1. symbol": string;
    "2. name": string;
    "3. type": string;
    "4. region": string;
    "5. marketOpen": string;
    "6. marketClose": string;
    "7. timezone": string;
    "8. currency": string;
    "9. matchScore": string;
}

export interface AlphaVantageSymbolSearchResponse {
    bestMatches: AlphaVantageSymbolMatch[];
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
  _createdAt: TimestampLike | Date;
  _lastUpdated: TimestampLike | Date;

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

export interface SaveTrackedSymbolResponse {
    success: boolean;
    symbol: string;
    message?: string;
    error?: string;
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