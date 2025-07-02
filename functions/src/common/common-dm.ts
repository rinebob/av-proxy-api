/**
 * Shared types for Data Maintainer functionality between frontend and backend
 */

/**
 * Enum for Data Maintainer endpoints used in the UI and backend integration.
 * Keep this in sync with the frontend version in fe-common-dm.ts
 */
export enum DataMaintainerEndpoint {
  COMPANY_OVERVIEW = 'company-overview',
  BALANCE_SHEET = 'balance-sheet',
  INCOME_STATEMENT = 'income-statement',
  CASH_FLOW = 'cash-flow',
  EARNINGS = 'earnings',
  LISTING_STATUS = 'listing-status',
  IPO_CALENDAR = 'ipo-calendar',
  SECTOR_PERFORMANCE = 'sector-performance',
  OVERVIEW = 'overview',
  SYMBOL_SEARCH = 'symbol-search',
  TIME_SERIES = 'time-series',
  QUOTE_ENDPOINT = 'quote-endpoint',
}

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
