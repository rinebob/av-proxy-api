import { AvCompanyOverview } from '@shared/alpha-vantage';
import { environment } from '../../../../environments/environment';
import { inject } from '@angular/core';
import { API_BASES } from '../../../core/api/api.tokens';

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
  SAVE_TRACKED_SYMBOL = 'saveTrackedSymbol',
  LIST_SYMBOLS_V2 = 'listSymbolsV2',
}

// Deprecated: legacy base/url constants. Prefer API_BASES.dm.
const DM_PROD_URLS = {} as const;
const DM_DEV_URL_BASE = 'http://localhost:5001/alpha-vantage-proxy-api/us-central1';

/**
 * Resolve Data Maintainer base URL from DI (API_BASES.dm) when available; fallback to legacy env logic.
 */
function getDataMaintainerBaseUrl(): string {
  try {
    const bases = inject(API_BASES);
    if (bases?.dm) return bases.dm;
  } catch {}
  // Fallback for environments/tests without DI context
  return DM_DEV_URL_BASE; // dev-style default; prefer API_BASES in production apps
}

/**
 * All possible backend URLs for Data Maintainer functions (for use in interceptors).
 * Deprecated: the interceptor now relies on API_BASES values.
 */
export const DataMaintainerBackendUrls = [
  ...Object.values(DataMaintainerFunctionName).map(name => `${DM_DEV_URL_BASE}/${name}`)
];

/**
 * Returns the correct Data Maintainer function URL for the current environment.
 */
export function getDataMaintainerFunctionUrl(functionName: DataMaintainerFunctionName): string {
  const base = getDataMaintainerBaseUrl();
  return `${base}/${functionName}`;
}

/////////////////////////////// INTERFACES /////////////////////////

/**
 * Represents a symbol search match result from Alpha Vantage SYMBOL_SEARCH endpoint
 * TODO: This interface should be replaced with the one from shared/alpha-vantage/av-symbol-search.ts
 * Remove this interface after migration is complete
 */
export interface AvSymbolSearchMatchResult {
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

// TODO: This interface should be replaced with the one from shared/alpha-vantage/av-symbol-search.ts
// Remove this interface after migration is complete
export interface AvSymbolSearchResult {
  bestMatches: AvSymbolSearchMatchResult[];
}

/**
 * Represents a single symbol match from Alpha Vantage SYMBOL_SEARCH endpoint
 * Must match same interface in functions/src/common/common-av.ts
 * 
 * TODO: This interface should be replaced with the one from shared/alpha-vantage/av-symbol-search.ts
 * Remove this interface after migration is complete
 */
export interface SvtAvSymbolMatch {
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
 * Use the shared type to avoid divergence.
 */
// AvCompanyOverview is imported from @shared/alpha-vantage

export interface ApiResponse<T> {
  ok: boolean;
  symbol: string;
  endpoint: string;
  data: T;
  dataSource: 'mock' | 'alpha_vantage';
  timestamp: string;
}

// TODO: Align this with shared/alpha-vantage/av-company-overview.ts
export interface AvCompanyOverviewResponse {
  ok: boolean;
  symbol: string;
  endpoint: string;
  data: AvCompanyOverview;
  dataSource: 'mock' | 'alpha_vantage';
  timestamp: string;
}

/**
 * Represents a tracked symbol in the system
 * Matches the backend TrackedSymbol interface
 * TODO: Align this with shared/alpha-vantage/av-symbol-search.ts
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
  createdAt?: string | Date;
  lastUpdated?: string | Date;
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

/**
 * Request payload for syncing (adding/removing) symbols
 */
export interface SyncSymbolsRequest {
  /** Array of symbols to be added or removed */
  symbols: string[];
  
  /** Timestamp of the operation */
  timestamp: Date;
  
  /** If true, the symbols should be removed (marked as inactive) instead of added/updated */
  remove?: boolean;
  
  /** Optional metadata for the operation */
  metadata?: Record<string, any>;
}

export interface SyncSymbolsResponse {
  success: boolean;
  message?: string;
  added: number;
  removed: number;
  totalActive: number;
  timestamp: Date | string;
  // Symbol data from SYMBOL_SEARCH
  symbolData?: TrackedSymbol;
  // For backward compatibility
  addedCount?: number;
  removedCount?: number;
  totalTracked?: number;
  error?: string;
}

/**
 * Represents a document in the data_points subcollection
 * Each document is keyed by endpoint name (e.g., 'company-overview')
 */
export interface EndpointData<T = any> {
  /** The endpoint identifier (e.g., 'company-overview') */
  endpoint: string;
  /** The stock/financial symbol this data is for */
  symbol: string;
  /** When this data was last updated */
  lastUpdated: string | Date;
  /** When this data should be refreshed */
  nextRefreshAt: string | Date;
  /** Time-to-live in seconds for this data point */
  ttlSeconds: number;
  /** Status of the last fetch attempt */
  status: 'success' | 'error' | 'pending';
  /** The actual API response data */
  data: T;
  /** Error details if status is 'error' */
  errorDetails?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

/**
 * Represents a refresh event document in the refresh_events subcollection
 * Each document is keyed by endpoint name (e.g., 'company-overview')
 */
export interface RefreshEvent {
  /** The endpoint that was refreshed */
  endpoint: string;
  /** The symbol that was refreshed */
  symbol: string;
  /** When the refresh was completed */
  completedAt: string | Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Status of the refresh */
  status: 'success' | 'error' | 'pending';
  /** Error details if the refresh failed */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
  /** Additional metadata about the refresh */
  metadata?: Record<string, any>;
}

// Specific endpoint data types
export type CompanyOverviewData = EndpointData<AvCompanyOverview>;
// Add other endpoint-specific types as needed