import { TrackedSymbolV2 } from '@shared/alpha-vantage';
import { TRACKED_SYMBOL_V2_FIELDS } from '@shared/alpha-vantage'

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
