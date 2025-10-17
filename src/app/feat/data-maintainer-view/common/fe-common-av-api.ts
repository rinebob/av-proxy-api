import { environment } from '../../../../environments/environment';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { GatewayFunctionPath } from '../../../common/fe-common-fn';


/**
 * Converts an AlphaVantageEndpoint to a URL path segment
 * Example: TIME_SERIES_DAILY -> 'time-series-daily'
 */
function endpointToPath(endpoint: AlphaVantageEndpoint): string {
  return endpoint.toLowerCase().replace(/_/g, '-');
}

/**
 * Builds the full Alpha Vantage endpoint URL from a provided base URL.
 * Callers should pass API_BASES.av from DI to avoid runtime inject() usage here.
 *
 * Note: In v2, all Alpha Vantage requests are routed through the single
 * gateway function `alphaVantageApiV2`, which internally dispatches to the
 * correct handler based on the trailing path segment. There are no per-endpoint
 * Cloud Function exports (e.g., `/HISTORICAL_OPTIONS` does not exist).
 */
export function buildAlphaVantageEndpointUrl(baseUrl: string, endpoint: AlphaVantageEndpoint): string {
  // Always route through the gateway function in both dev and prod
  return `${baseUrl}/${GatewayFunctionPath.ALPHA_VANTAGE}/${endpoint}`;
}

/////////////////////////////// TYPES /////////////////////////

/**
 * Union type of all possible response data shapes from Alpha Vantage API
 */
export type AlphaVantageResponseData = 
  | TimeSeriesDataPoint[] 
  | GlobalQuoteData 
  | CompanyOverviewData 
  | Record<string, unknown>;

/////////////////////////////// INTERFACES /////////////////////////

/**
 * Response structure for Alpha Vantage API calls
 */
export interface AlphaVantageApiResponse<T = any> {
  ok: boolean;
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  data: T;
  timestamp: string;
  error?: string;
  errorDetails?: {
    message: string;
    code?: string | number;
    stack?: string;
  };
}

/**
 * Parameters for fetching data from Alpha Vantage endpoints
 */
export interface FetchAlphaVantageParams {
  symbol: string;
  [key: string]: any; // Allow for additional parameters
}

/**
 * Represents a data point from Alpha Vantage time series data
 */
export interface TimeSeriesDataPoint {
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  timestamp?: string; // Some endpoints include this in the key
}

/**
 * Global Quote data structure
 */
export interface GlobalQuoteData {
  symbol: string;
  open: string;
  high: string;
  low: string;
  price: string;
  volume: string;
  latestTradingDay: string;
  previousClose: string;
  change: string;
  changePercent: string;
}

/**
 * Company Overview data structure
 */
export interface CompanyOverviewData {
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
  // Add more fields as needed from Alpha Vantage's company overview
}

/**
 * Request to save a tracked symbol.
 * Matches the backend Omit<TrackedSymbol, 'createdAt' | 'lastUpdated'>
 */
export interface SaveTrackedSymbolRequest {
    symbol: string;
    name: string;
    type?: string;
    region?: string;
    marketOpen?: string;
    marketClose?: string;
    timezone?: string;
    currency?: string;
    matchScore?: string | number;
    // Add any other fields from your TrackedSymbol interface except createdAt/lastUpdated
  }

/**
 * Response from saveTrackedSymbol cloud function.
 */
export interface SaveTrackedSymbolResponse {
    success: boolean;
    symbol: string;
    message?: string;
    error?: string;
  }