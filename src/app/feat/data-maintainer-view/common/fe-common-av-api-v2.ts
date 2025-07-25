
///////////// COPIED FROM FUNCTIONS/SRC/V2/COMMON/COMMON-DM.TS ////////////
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
  _createdAt: string | Date;
  _lastUpdated: string | Date;

  // Is currently on at least one users personal symbol watchlist
  // This is used to determine if a symbol should be included in the list of symbols to refresh
  _isActive: boolean;

  // Explicit dev-only flag to specifically enable data refreshing
  // If true, AV data will be regularly refreshed for this symbol
  // Be careful about request limits
  _refreshEnabled: boolean;  
}

export interface ListSymbolsV2Response {
  ok: boolean;
  symbols: TrackedSymbolV2[];
  error?: string;
}