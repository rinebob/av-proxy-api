/**
 * Benzinga API Types and Enums (Backend)
 * Consolidated types for Benzinga API integration
 */

/**
 * Actual Benzinga API endpoints
 */
export enum BenzingaEndpoint {
  CALENDAR = 'calendar',
  NEWS = 'news'
}

/**
 * Company-specific calendar types (require a ticker/symbol)
 */
export enum BzCompanyDataCalendarType {
  EARNINGS = 'earnings',
  DIVIDENDS = 'dividends',
  CONFERENCE_CALLS = 'conference-calls',
  RATINGS = 'ratings',
  GUIDANCE = 'guidance',
  SPLITS = 'splits',
  OFFERINGS = 'offerings',
}

/**
 * Market-wide calendar types (don't require a ticker)
 */
export enum BzMarketDataCalendarType {
  ECONOMICS = 'economics',
  IPOS = 'ipos',
  FDA = 'fda',
  MERGERS_ACQUISITIONS = 'mergers-acquisitions'
}

/**
 * Union of all calendar types
 */
export type BzCalendarType = BzCompanyDataCalendarType | BzMarketDataCalendarType;

/**
 * Type guard to check if a calendar type is a company data type
 */
export function isBzCompanyDataCalendarType(calendarType: BzCalendarType): calendarType is BzCompanyDataCalendarType {
  return Object.values(BzCompanyDataCalendarType).includes(calendarType as BzCompanyDataCalendarType);
}

/**
 * Type guard to check if a calendar type is a market data type
 */
export function isBzMarketDataCalendarType(calendarType: BzCalendarType): calendarType is BzMarketDataCalendarType {
  return Object.values(BzMarketDataCalendarType).includes(calendarType as BzMarketDataCalendarType);
}

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
 * Type mapping from calendar type to response item type
 */
export interface BZCalendarResponseMap {
  [BzCompanyDataCalendarType.EARNINGS]: BenzingaEarningsItem[];
  [BzCompanyDataCalendarType.DIVIDENDS]: BenzingaDividendItem[];
  [BzMarketDataCalendarType.ECONOMICS]: any[];
  [BzMarketDataCalendarType.IPOS]: any[];
  [BzCompanyDataCalendarType.CONFERENCE_CALLS]: BenzingaConferenceCallItem[];
  [BzMarketDataCalendarType.FDA]: any[];
  [BzMarketDataCalendarType.MERGERS_ACQUISITIONS]: any[];
  [BzCompanyDataCalendarType.RATINGS]: BenzingaRatingItem[];
  [BzCompanyDataCalendarType.GUIDANCE]: any[];
  [BzCompanyDataCalendarType.SPLITS]: any[];
  [BzCompanyDataCalendarType.OFFERINGS]: any[];
}

/**
 * Strongly-typed response type
 * Usage: BenzingaCalendarResponse<BzCompanyDataCalendarType.EARNINGS> for earnings data
 */
export type BenzingaCalendarResponse<T extends BzCalendarType> = {
  [K in T]: BZCalendarResponseMap[K];
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
 * Helper to get the correct response type for a calendar type
 */
export function getResponseTypeForCalendarType<T extends BzCalendarType>(
  calendarType: T,
  data: any
): BenzingaCalendarResponse<T>[T] {
  return {
    [calendarType]: data
  }[calendarType];
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
 * Keys are BzCompanyDataCalendarType enum values for type safety.
 */
export const BENZINGA_ENDPOINTS_REQUIRING_TICKER: Record<BzCompanyDataCalendarType, boolean> = {
  [BzCompanyDataCalendarType.EARNINGS]: true,
  [BzCompanyDataCalendarType.DIVIDENDS]: true,
  [BzCompanyDataCalendarType.CONFERENCE_CALLS]: true,
  [BzCompanyDataCalendarType.RATINGS]: true,
  [BzCompanyDataCalendarType.GUIDANCE]: true,
  [BzCompanyDataCalendarType.SPLITS]: true,
  [BzCompanyDataCalendarType.OFFERINGS]: true,
} as const;
