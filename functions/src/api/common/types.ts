import { 
  AlphaVantageEndpoint,
  AvEndpointSymbolUsage 
} from '../../common/common-av';

import { 
  BenzingaEndpoint,
  BzCalendarType
} from '../../common/common-benz';

import { 
  ApiProvider, 
  HttpMethod 
} from './enums';

import { AvEndpointCategory } from '../../common/alpha-vantage/av-endpoint-category.enum';

export interface EndpointParameter {
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
  description: string;
  default?: any;
  enum?: string[];
}

export interface EndpointConfig {
  id: AlphaVantageEndpoint | BenzingaEndpoint | BzCalendarType;
  name: string;
  provider: ApiProvider;
  category: AvEndpointCategory | string;  // Allow string for backward compatibility
  path: string;
  method: HttpMethod;
  description: string;
  ttl: number;
  /** @deprecated Use symbolUsage instead */
  requiresSymbol?: boolean;
  symbolUsage?: AvEndpointSymbolUsage;
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
