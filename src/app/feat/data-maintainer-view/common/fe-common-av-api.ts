import { environment } from '../../../../environments/environment';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { inject } from '@angular/core';
import { API_BASES } from '../../../core/api/api.tokens';

/**
 * Production URL for the Alpha Vantage API Gateway
 * (Deprecated: prefer API_BASES.av)
 */
const AV_GATEWAY_PROD_URL = 'https://alphavantageapiv2-lsluydmucq-uc.a.run.app';

/**
 * Development URL base for the Alpha Vantage API Gateway
 * (Deprecated: prefer API_BASES.av)
 */
const AV_DEV_URL_BASE = 'http://localhost:5001/alpha-vantage-proxy-api/us-central1';

/**
 * Returns the correct Alpha Vantage gateway base URL using DI if available; falls back to environment.
 */
function getAlphaVantageBaseUrl(): string {
  try {
    // Prefer centralized API bases when an injection context is available
    const bases = inject(API_BASES);
    if (bases?.av) return bases.av;
  } catch {}
  // Fallback to legacy env-based logic for non-DI contexts (tests, early bootstrap)
  return environment.production ? AV_GATEWAY_PROD_URL : AV_DEV_URL_BASE;
}

/**
 * All possible backend URLs for Alpha Vantage functions (for use in interceptors)
 * (Deprecated: auth interceptor now relies on API_BASES)
 */
export const AlphaVantageBackendUrls = [
  AV_GATEWAY_PROD_URL,
  AV_DEV_URL_BASE
];

/**
 * Converts an AlphaVantageEndpoint to a URL path segment
 * Example: TIME_SERIES_DAILY -> 'time-series-daily'
 */
function endpointToPath(endpoint: AlphaVantageEndpoint): string {
  return endpoint.toLowerCase().replace(/_/g, '-');
}

/**
 * Returns the full URL for an Alpha Vantage endpoint
 * @param endpoint The Alpha Vantage endpoint to call
 */
export function getAlphaVantageEndpointUrl(endpoint: AlphaVantageEndpoint): string {
  const baseUrl = getAlphaVantageBaseUrl();
  console.log(`av-api gAEU Using base URL: ${baseUrl}, endpoint: ${endpoint}`);
  // For production, use the direct path (e.g., https://alpha-...run.app/TIME_SERIES_DAILY)
  // For development/emulator, use the full path with function name
  return environment.production
    ? `${baseUrl}/${endpoint}`
    : `${baseUrl}/alphaVantageApiV2/${endpoint}`;
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