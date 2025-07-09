/**
 * Benzinga API Types and Enums (Backend)
 * Consolidated types for Benzinga API integration
 */

/**
 * Company-specific endpoints (require a ticker/symbol)
 */
export enum CompanyDataEndpoint {
  EARNINGS = 'earnings',
  DIVIDENDS = 'dividends',
  CONFERENCE_CALLS = 'conference-calls',
  RATINGS = 'ratings',
  GUIDANCE = 'guidance',
  SPLITS = 'splits',
  OFFERINGS = 'offerings',
}

/**
 * Market-wide endpoints (don't require a ticker)
 */
export enum MarketDataEndpoint {
  ECONOMICS = 'economics',
  IPOS = 'ipos',
  FDA = 'fda',
  MERGERS_ACQUISITIONS = 'mergers-acquisitions',
  NEWS = 'news'
}

/**
 * Union of all endpoint types
 */
export type BenzingaEndpoint = CompanyDataEndpoint | MarketDataEndpoint;

/**
 * Type guard to check if an endpoint is a company data endpoint
 */
export function isCompanyDataEndpoint(endpoint: BenzingaEndpoint): endpoint is CompanyDataEndpoint {
  return Object.values(CompanyDataEndpoint).includes(endpoint as CompanyDataEndpoint);
}

/**
 * Type guard to check if an endpoint is a market data endpoint
 */
export function isMarketDataEndpoint(endpoint: BenzingaEndpoint): endpoint is MarketDataEndpoint {
  return Object.values(MarketDataEndpoint).includes(endpoint as MarketDataEndpoint);
}

/**
 * Backward compatibility type
 */
export type BenzingaCalendarType = BenzingaEndpoint;

/**
 * Output format for API responses
 */
export enum BenzingaOutputFormat {
  JSON = 'json',
  XML = 'xml'
}

/**
 * Base interface for all calendar items
 */
export interface BenzingaCalendarItemBase {
  id: string;
  date: string;
  time: string;
  time_updated: string;
  date_updated: string;
  ticker: string;
  name: string;
  exchange: string;
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

/**
 * Union type for all possible calendar items
 */
export type BenzingaCalendarItem = 
  | BenzingaEarningsItem
  | BenzingaDividendItem
  | BenzingaConferenceCallItem
  | BenzingaRatingItem
  | BenzingaCalendarItemBase;

/**
 * Type mapping from endpoint to response item type
 */
export interface BenzingaEndpointResponseMap {
  [CompanyDataEndpoint.EARNINGS]: BenzingaEarningsItem[];
  [CompanyDataEndpoint.DIVIDENDS]: BenzingaDividendItem[];
  [MarketDataEndpoint.ECONOMICS]: any[];
  [MarketDataEndpoint.IPOS]: any[];
  [CompanyDataEndpoint.CONFERENCE_CALLS]: BenzingaConferenceCallItem[];
  [MarketDataEndpoint.FDA]: any[];
  [MarketDataEndpoint.MERGERS_ACQUISITIONS]: any[];
  [CompanyDataEndpoint.RATINGS]: BenzingaRatingItem[];
  [CompanyDataEndpoint.GUIDANCE]: any[];
  [CompanyDataEndpoint.SPLITS]: any[];
  [CompanyDataEndpoint.OFFERINGS]: any[];
  [MarketDataEndpoint.NEWS]: any[];
}

/**
 * Strongly-typed response type
 * Usage: BenzingaCalendarResponse<CompanyDataEndpoint.EARNINGS> for earnings data
 */
export type BenzingaCalendarResponse<T extends BenzingaEndpoint> = {
  [K in T]: BenzingaEndpointResponseMap[K];
};

// Type guard functions
export function isEarningsItem(item: BenzingaCalendarItem): item is BenzingaEarningsItem {
  return 'eps' in item || 'revenue' in item;
}

export function isDividendItem(item: BenzingaCalendarItem): item is BenzingaDividendItem {
  return 'dividend' in item || 'dividend_yield' in item;
}

export function isConferenceCallItem(item: BenzingaCalendarItem): item is BenzingaConferenceCallItem {
  return 'call_time' in item || 'call_url' in item;
}

export function isRatingItem(item: BenzingaCalendarItem): item is BenzingaRatingItem {
  return 'action_company' in item || 'analyst' in item;
}

/**
 * Helper to get the correct response type for an endpoint
 */
export function getResponseTypeForEndpoint<T extends BenzingaEndpoint>(
  endpoint: T,
  data: any
): BenzingaCalendarResponse<T>[T] {
  return {
    [endpoint]: data
  }[endpoint];
}

/**
 * Params for Benzinga Calendar API (snake_case, matches Benzinga docs)
 * Only include fields that are actually sent to Benzinga.
 */
export interface BenzingaCalendarParams {
  tickers?: string;
  securities?: string[];
  date_from?: string;
  date_to?: string;
  date?: string;
  updated?: string;
  importance?: string;
  dividend_yield_gt?: string;
  country?: string;
  category?: string;
  fuzzy?: string;
  sort?: string;
  page?: number;
  pagesize?: number;
}

/**
 * Indicates which Benzinga calendar endpoints require a ticker parameter.
 * Keys are BenzingaCalendarType enum values for type safety.
 */
export const BENZINGA_ENDPOINTS_REQUIRING_TICKER: Record<CompanyDataEndpoint, boolean> = {
  [CompanyDataEndpoint.EARNINGS]: true,
  [CompanyDataEndpoint.DIVIDENDS]: true,
  [CompanyDataEndpoint.CONFERENCE_CALLS]: true,
  [CompanyDataEndpoint.RATINGS]: true,
  [CompanyDataEndpoint.GUIDANCE]: true,
  [CompanyDataEndpoint.SPLITS]: true,
  [CompanyDataEndpoint.OFFERINGS]: true,
} as const;
