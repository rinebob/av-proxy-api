import { AlphaVantageEndpoint } from './endpoints';

/**
 * Base response structure for Alpha Vantage API responses
 */
export interface AlphaVantageResponse<T = any> {
  /**
   * The endpoint that was called
   */
  endpoint: AlphaVantageEndpoint;
  
  /**
   * The symbol this data is for
   */
  symbol: string;
  
  /**
   * The actual response data
   */
  data: T;
  
  /**
   * Metadata about the response
   */
  meta?: {
    /**
     * When this data was last updated
     */
    lastUpdated: string;
    
    /**
     * Time-to-live in seconds for this data
     */
    ttl: number;
  };
}

/**
 * Company Overview response type
 */
export interface CompanyOverviewResponse {
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
  // ... other fields from Alpha Vantage
}

/**
 * Global Quote response type
 */
export interface GlobalQuoteResponse {
  '01. symbol': string;
  '02. open': string;
  '03. high': string;
  '04. low': string;
  '05. price': string;
  '06. volume': string;
  '07. latest trading day': string;
  '08. previous close': string;
  '09. change': string;
  '10. change percent': string;
}

/**
 * Map of response types by endpoint
 */
export type AlphaVantageResponseMap = {
  [AlphaVantageEndpoint.OVERVIEW]: CompanyOverviewResponse;
  [AlphaVantageEndpoint.GLOBAL_QUOTE]: GlobalQuoteResponse;
  // Add other endpoint response types here
  [key: string]: any;
};

/**
 * Type guard to check if a response is for a specific endpoint
 */
export function isAlphaVantageResponse<T extends AlphaVantageEndpoint>(
  response: any,
  endpoint: T
): response is AlphaVantageResponse<AlphaVantageResponseMap[T]> {
  return response?.endpoint === endpoint;
}
