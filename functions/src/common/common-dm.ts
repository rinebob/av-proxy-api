/**
 * Shared types and constants for Data Maintainer functionality between frontend and backend
 */

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
 * TTL configuration in seconds for each endpoint
 */
export const ENDPOINT_TTLS: Record<DataMaintainerEndpoint, number> = {
  [DataMaintainerEndpoint.COMPANY_OVERVIEW]: 7 * 24 * 60 * 60, // 7 days in seconds
  [DataMaintainerEndpoint.BALANCE_SHEET]: 30 * 24 * 60 * 60, // 30 days
  [DataMaintainerEndpoint.INCOME_STATEMENT]: 30 * 24 * 60 * 60, // 30 days
  [DataMaintainerEndpoint.CASH_FLOW]: 30 * 24 * 60 * 60, // 30 days
  [DataMaintainerEndpoint.EARNINGS]: 24 * 60 * 60, // 24 hours
  [DataMaintainerEndpoint.LISTING_STATUS]: 7 * 24 * 60 * 60, // 7 days
  [DataMaintainerEndpoint.IPO_CALENDAR]: 6 * 60 * 60, // 6 hours
  [DataMaintainerEndpoint.SECTOR_PERFORMANCE]: 1 * 60 * 60, // 1 hour
  [DataMaintainerEndpoint.OVERVIEW]: 24 * 60 * 60, // 24 hours
  [DataMaintainerEndpoint.SYMBOL_SEARCH]: 7 * 24 * 60 * 60, // 7 days
  [DataMaintainerEndpoint.TIME_SERIES]: 1 * 60 * 60, // 1 hour
  [DataMaintainerEndpoint.QUOTE_ENDPOINT]: 5 * 60, // 5 minutes
};

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
