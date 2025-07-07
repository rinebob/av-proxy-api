/**
 * Benzinga API Types and Enums
 */

/**
 * Benzinga API Types and Enums (Backend Minimal)
 * Only types/enums needed for backend calendar param validation and mapping.
 * Do NOT add frontend/UI-specific objects here.
 */

// Company-specific endpoints (require a ticker/symbol)
export enum CompanyDataEndpoint {
  EARNINGS = 'earnings',
  DIVIDENDS = 'dividends',
  CONFERENCE_CALLS = 'conference-calls',
  RATINGS = 'ratings',
  GUIDANCE = 'guidance',
  SPLITS = 'splits',
  OFFERINGS = 'offerings',
}

// Market-wide endpoints (don't require a ticker)
export enum MarketDataEndpoint {
  ECONOMICS = 'economics',
  IPOS = 'ipos',
  FDA = 'fda',
  MERGERS_ACQUISITIONS = 'mergers-acquisitions',
}

// Union of all endpoint types
export type BenzingaEndpoint = CompanyDataEndpoint | MarketDataEndpoint;

// Type guard to check if an endpoint is a company data endpoint
export function isCompanyDataEndpoint(endpoint: BenzingaEndpoint): endpoint is CompanyDataEndpoint {
  return Object.values(CompanyDataEndpoint).includes(endpoint as CompanyDataEndpoint);
}

// Type guard to check if an endpoint is a market data endpoint
export function isMarketDataEndpoint(endpoint: BenzingaEndpoint): endpoint is MarketDataEndpoint {
  return Object.values(MarketDataEndpoint).includes(endpoint as MarketDataEndpoint);
}

// Backward compatibility type (deprecated, use BenzingaEndpoint instead)
export type BenzingaCalendarType = BenzingaEndpoint;

export const BenzingaCalendarType = {
  ...CompanyDataEndpoint,
  ...MarketDataEndpoint
} as const;

// Type assertion to ensure all endpoints are covered
type AssertExtends<T, U extends T> = never;
// Export the type to avoid unused warning and make it available for use
export type _AllEndpointsCovered = AssertExtends<
  keyof BenzingaCalendarResponse,
  BenzingaEndpoint
>;

export enum BenzingaOutputFormat {
  JSON = 'json',
  XML = 'xml'
}

// Base interface for all calendar items
export interface BenzingaCalendarItemBase {
  id: string;
  date: string;
  time: string;
  time_updated: string;
  date_updated: string;
  ticker: string;
  name: string;
  exchange: string;
  [key: string]: any; // Allow additional properties
}

// Earnings specific fields
export interface BenzingaEarningsItem extends BenzingaCalendarItemBase {
  eps?: string | number | null;
  eps_estimated?: string | number | null;
  eps_surprise?: string | number | null;
  eps_surprise_percent?: string | number | null;
  revenue?: string | number | null;
  revenue_estimated?: string | number | null;
  revenue_surprise?: string | number | null;
  revenue_surprise_percent?: string | number | null;
  fiscal_year?: string | number | null;
  fiscal_quarter?: string | number | null;
}

// Dividends specific fields
export interface BenzingaDividendItem extends BenzingaCalendarItemBase {
  dividend?: string | number | null;
  dividend_prior?: string | number | null;
  dividend_yield?: string | number | null;
  dividend_type?: string | null;
  dividend_frequency?: string | null;
  dividend_ex_date?: string | null;
  dividend_record_date?: string | null;
  dividend_pay_date?: string | null;
}

// Conference calls specific fields
export interface BenzingaConferenceCallItem extends BenzingaCalendarItemBase {
  call_time?: string | null;
  call_url?: string | null;
  call_phone?: string | null;
  call_passcode?: string | null;
}

// Ratings specific fields
export interface BenzingaRatingItem extends BenzingaCalendarItemBase {
  action_company?: string | null;
  action_pt?: string | null;
  adjusted_pt_current?: string | number | null;
  adjusted_pt_prior?: string | number | null;
  analyst?: string | null;
  analyst_name?: string | null;
  current?: string | null;
  prior?: string | null;
}

// Union type for all possible calendar items
export type BenzingaCalendarItem = 
  | BenzingaEarningsItem
  | BenzingaDividendItem
  | BenzingaConferenceCallItem
  | BenzingaRatingItem
  | BenzingaCalendarItemBase;

// Type mapping from endpoint to response item type
export type BenzingaEndpointResponseMap = {
  [K in BenzingaEndpoint]: 
    K extends CompanyDataEndpoint.EARNINGS ? BenzingaEarningsItem[] :
    K extends CompanyDataEndpoint.DIVIDENDS ? BenzingaDividendItem[] :
    K extends CompanyDataEndpoint.CONFERENCE_CALLS ? BenzingaConferenceCallItem[] :
    K extends CompanyDataEndpoint.RATINGS ? BenzingaRatingItem[] :
    K extends CompanyDataEndpoint.GUIDANCE ? BenzingaCalendarItemBase[] :
    K extends CompanyDataEndpoint.SPLITS ? BenzingaCalendarItemBase[] :
    K extends CompanyDataEndpoint.OFFERINGS ? BenzingaCalendarItemBase[] :
    K extends MarketDataEndpoint.ECONOMICS ? BenzingaCalendarItemBase[] :
    K extends MarketDataEndpoint.IPOS ? BenzingaCalendarItemBase[] :
    K extends MarketDataEndpoint.FDA ? BenzingaCalendarItemBase[] :
    K extends MarketDataEndpoint.MERGERS_ACQUISITIONS ? BenzingaCalendarItemBase[] :
    BenzingaCalendarItemBase[];
};

// Strongly-typed response type
// Usage: BenzingaCalendarResponse<CompanyDataEndpoint.EARNINGS> for earnings data
export type BenzingaCalendarResponse<K extends BenzingaEndpoint = BenzingaEndpoint> = {
  [P in K]: BenzingaEndpointResponseMap[P];
};

// Type guard functions
export function isEarningsItem(item: BenzingaCalendarItem): item is BenzingaEarningsItem {
  return 'eps' in item || 'revenue' in item;
}

export function isDividendItem(item: BenzingaCalendarItem): item is BenzingaDividendItem {
  return 'dividend' in item || 'dividend_yield' in item;
}

export function isConferenceCallItem(item: BenzingaCalendarItem): item is BenzingaConferenceCallItem {
  return 'call_url' in item || 'call_phone' in item;
}

export function isRatingItem(item: BenzingaCalendarItem): item is BenzingaRatingItem {
  return 'action_company' in item || 'analyst' in item;
}

// Helper to get the correct response type for an endpoint
export function getResponseTypeForEndpoint<T extends BenzingaEndpoint>(
  endpoint: T,
  data: any
): BenzingaCalendarResponse<T>[T] {
  // Add runtime validation here if needed
  return data as BenzingaCalendarResponse<T>[T];
}

/**
 * Params for Benzinga Calendar API (snake_case, matches Benzinga docs)
 * Only include fields that are actually sent to Benzinga.
 */
export interface BenzingaCalendarParams {
  tickers?: string;             // Comma-separated ticker symbols (e.g., 'AAPL,MSFT')
  securities?: string[];        // FDA endpoint only
  date_from?: string;           // Start of date range (YYYY-MM-DD)
  date_to?: string;            // End of date range (YYYY-MM-DD)
  date?: string;               // Single date (if supported)
  updated?: string;            // For deltas
  importance?: string;         // For filtering by importance
  dividend_yield_gt?: string;  // Dividends endpoint only
  country?: string;            // Economics endpoint
  category?: string;           // Economics endpoint
  fuzzy?: string;              // Economics endpoint
  sort?: string;               // If supported (e.g., Dividends)
  page?: number;
  pagesize?: number;
}

/**
 * Indicates which Benzinga calendar endpoints require a ticker parameter.
 * Keys are BenzingaCalendarType enum values for type safety.
 */
export const BENZINGA_ENDPOINT_REQUIRES_TICKER: Record<CompanyDataEndpoint, boolean> = {
  [CompanyDataEndpoint.EARNINGS]: true,
  [CompanyDataEndpoint.DIVIDENDS]: true,
  [CompanyDataEndpoint.CONFERENCE_CALLS]: true,
  [CompanyDataEndpoint.RATINGS]: true,
  [CompanyDataEndpoint.GUIDANCE]: true,
  [CompanyDataEndpoint.SPLITS]: true,
  [CompanyDataEndpoint.OFFERINGS]: true,
};
