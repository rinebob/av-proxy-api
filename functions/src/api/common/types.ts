import { 
  AlphaVantageEndpoint
} from '../../common/common-av';
import { EndpointSymbolUsage } from '../../common/common-fn';

import { 
  BenzingaEndpoint,
  BzCalendarType,

} from '../../common/common-benz';

import { 
  HttpMethod 
} from './enums';

import { ApiProvider } from '../../common/data-providers';

import { AvEndpointCategory } from '../../common/alpha-vantage/av-endpoint-category.enum';

export interface EndpointParameter {
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
  description: string;
  default?: any;
  enum?: string[];
}

/////////// DO NOT EDIT
// Legacy support for AV. Migrate to new RequestConfig as soon as possible
export interface EndpointConfig {
  id: AlphaVantageEndpoint | BenzingaEndpoint | BzCalendarType;
  name: string;
  provider: ApiProvider;
  category: AvEndpointCategory | string;  // Allow string for backward compatibility
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
export interface RequestConfig<TId = string> {
  id: TId;
  name: string;
  provider: ApiProvider;
  category: AvEndpointCategory | string;  // Allow string for backward compatibility
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
