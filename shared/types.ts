import { ApiProvider } from "./data-providers";

export enum HttpMethod {
    GET = 'GET',
    POST = 'POST',
    PUT = 'PUT',
    DELETE = 'DELETE',
}

export enum EndpointSymbolUsage {
    REQUIRED = 'REQUIRED',
    NOT_SUPPORTED = 'NOT_SUPPORTED',
    OPTIONAL = 'OPTIONAL',
}


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
    provider: ApiProvider | string;
    category: string;
    apiEndpoint: string;
    method: HttpMethod | string;
    description: string;
    ttl: number;
    /** @deprecated Use symbolUsage instead */
    requiresSymbol?: boolean;
    symbolUsage?: EndpointSymbolUsage | string;
    firestorePath?: string;
    documentationUrl?: string;
    parameters: Record<string, EndpointParameter>;
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
