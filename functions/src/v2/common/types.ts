import { 
  HttpMethod 
} from './enums';

import { ApiProvider } from './data-providers';

import { AvEndpointCategory } from './common-av';
import { EndpointSymbolUsage, TimeSeriesInterval } from './common-fn';

export interface EndpointParameter {
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
  description: string;
  default?: any;
  enum?: string[];
}

export interface EndpointConfig<TId extends string = string> {
  id: TId;
  name: string;
  provider: ApiProvider;
  category: AvEndpointCategory | string;
  apiEndpoint: string;
  method: HttpMethod;
  description: string;
  ttl: number;
  /** @deprecated Use symbolUsage instead */
  requiresSymbol?: boolean;
  symbolUsage?: EndpointSymbolUsage;
  parameters: Record<string, EndpointParameter>;
  /**
   * The Firestore document path in the format 'collection/doc/collection/doc/...'.
   * Parameters in curly braces will be replaced with actual values from the request.
   * Example: 'market_data/{symbol}/time_series/daily/{date}'
   */
  firestorePath?: string;
  documentationUrl: string;
}

// TODO: Update all Alpha Vantage (AV) usage to use RequestConfig instead of EndpointConfig
export interface RequestConfig<TId = string, TCategory = string> {
  id: TId;
  name: string;
  provider: ApiProvider;
  category: TCategory;
  apiEndpoint: string;
  method: HttpMethod;
  description: string;
  ttl: number;
  /** @deprecated Use symbolUsage instead */
  requiresSymbol?: boolean;
  symbolUsage?: EndpointSymbolUsage;
  parameters: Record<string, EndpointParameter>;
  /**
   * The Firestore document path in the format 'collection/doc/collection/doc/...'.
   * Parameters in curly braces will be replaced with actual values from the request.
   * Example: 'market_data/{symbol}/time_series/daily/{date}'
   */
  firestorePath?: string;
  documentationUrl: string;
}

/**
 * Extends EndpointConfig for Alpha Vantage time series endpoints.
 */
export interface TimeSeriesEndpointConfig extends EndpointConfig {
  interval: TimeSeriesInterval;
  // Add other time series–specific config as needed
}

export interface ApiResponse<T = any> {
  data: T;
  metadata: {
    timestamp: Date;
    endpoint: string;
    symbol?: string;
    ttl: number;
    requestId: string;
    processingTimeMs: number;
  };
}

export interface ApiContext {
  requestId?: string;
}

export interface ApiError extends Error {
  code: string;
  status: number;
  details?: any;
}

export interface ApiRequestOptions {
  params?: Record<string, any>;
  headers?: Record<string, string>;
  timeout?: number;
  retryCount?: number;
}
