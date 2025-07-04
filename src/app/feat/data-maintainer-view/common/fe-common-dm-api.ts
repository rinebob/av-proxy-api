import { environment } from '../../../../environments/environment';

/**
 * Enum for Data Maintainer Cloud Function names.
 * Extend as new Data Maintainer endpoints are created.
 */

export enum DataMaintainerFunctionName {
  FETCH_AND_STORE_DATA = 'fetchAndStoreData',
  CHECK_MOCK_DATA = 'checkMockData',
  LIST_SYMBOLS = 'listSymbols',
  GET_SYMBOL_DETAILS = 'getSymbolDetails',
  SYNC_SYMBOLS = 'syncSymbols',
}

// Production URLs for each Data Maintainer Cloud Function
const DM_PROD_URLS = {
  [DataMaintainerFunctionName.FETCH_AND_STORE_DATA]: 'https://fetchandstoredata-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.CHECK_MOCK_DATA]: 'https://checkmockdata-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.LIST_SYMBOLS]: 'https://listsymbols-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.GET_SYMBOL_DETAILS]: 'https://getsymboldetails-lsluydmucq-uc.a.run.app',
  [DataMaintainerFunctionName.SYNC_SYMBOLS]: 'https://syncsymbols-lsluydmucq-uc.a.run.app',
} as const;

// Development URL base
const DM_DEV_URL_BASE = 'http://localhost:5001/alpha-vantage-proxy-api/us-central1';

/**
 * All possible backend URLs for Data Maintainer functions (for use in interceptors).
 */
export const DataMaintainerBackendUrls = [
  ...Object.values(DM_PROD_URLS),
  ...Object.values(DataMaintainerFunctionName).map(name => `${DM_DEV_URL_BASE}/${name}`)
];

/**
 * Returns the correct Data Maintainer function URL for the current environment.
 */
export function getDataMaintainerFunctionUrl(functionName: DataMaintainerFunctionName): string {
  if (environment.production) {
    return DM_PROD_URLS[functionName];
  }
  return `${DM_DEV_URL_BASE}/${functionName}`;
}


/////////////////////////////// INTERFACES /////////////////////////

/**
 * Represents a symbol search result from Alpha Vantage SYMBOL_SEARCH endpoint
 */
export interface AvSymbolSearchResult {
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
 * Interface for the Alpha Vantage company overview data payload.
 */
export interface AvCompanyOverview {
  Symbol: string;
  AssetType: string;
  Name: string;
  Description: string;
  CIK: string;
  Exchange: string;
  Currency: string;
  Country: string;
  Sector: string;
  Industry: string;
  Address: string;
  OfficialSite: string;
  FiscalYearEnd: string;
  LatestQuarter: string;
  MarketCapitalization: string;
  EBITDA: string;
  PERatio: string;
  PEGRatio: string;
  BookValue: string;
  DividendPerShare: string;
  DividendYield: string;
  EPS: string;
  RevenuePerShareTTM: string;
  ProfitMargin: string;
  OperatingMarginTTM: string;
  ReturnOnAssetsTTM: string;
  ReturnOnEquityTTM: string;
  RevenueTTM: string;
  GrossProfitTTM: string;
  DilutedEPSTTM: string;
  QuarterlyEarningsGrowthYOY: string;
  QuarterlyRevenueGrowthYOY: string;
  AnalystTargetPrice: string;
  AnalystRatingStrongBuy: string;
  AnalystRatingBuy: string;
  AnalystRatingHold: string;
  AnalystRatingSell: string;
  AnalystRatingStrongSell: string;
  TrailingPE: string;
  ForwardPE: string;
  PriceToSalesRatioTTM: string;
  PriceToBookRatio: string;
  EVToRevenue: string;
  EVToEBITDA: string;
  Beta: string;
  "52WeekHigh": string;
  "52WeekLow": string;
  "50DayMovingAverage": string;
  "200DayMovingAverage": string;
  SharesOutstanding: string;
  SharesFloat: string;
  PercentInsiders: string;
  PercentInstitutions: string;
  DividendDate: string;
  ExDividendDate: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  symbol: string;
  endpoint: string;
  data: T;
  dataSource: 'mock' | 'alpha_vantage';
  timestamp: string;
}

export interface AvCompanyOverviewResponse {
  ok: boolean;
  symbol: string;
  endpoint: string;
  data: AvCompanyOverview;
  dataSource: 'mock' | 'alpha_vantage';
  timestamp: string;
}

export interface ClientSource {
  clientId: string;
  firstSeen: string | Date;
  lastSeen: string | Date;
  metadata?: Record<string, any>;
}

/**
 * Represents a tracked symbol in the system
 * Matches the backend TrackedSymbol interface
 */
export interface TrackedSymbol {
  // AV SYMBOL_SEARCH fields
  symbol: string;
  name: string;
  type: string;
  region: string;
  marketOpen: string;
  marketClose: string;
  timezone: string;
  currency: string;
  matchScore: string;
  
  // System fields
  isActive: boolean;
  createdAt: string | Date;
  clientId?: string;
}

export interface ListSymbolsResponse {
  ok: boolean;
  symbols: TrackedSymbol[];
  error?: string;
}

export interface SymbolDetailsResponse {
  ok: boolean;
  data: TrackedSymbol | null;
  error?: string;
}

export interface SyncSymbolsRequest {
  clientId: string;
  clientName: string;
  symbols: string[];
  metadata?: Record<string, any>;
}

export interface SyncSymbolsResponse {
  ok: boolean;
  added: number;
  removed: number;
  totalActive: number;
  error?: string;
}

///////////////////////////////////////////////////////////////////