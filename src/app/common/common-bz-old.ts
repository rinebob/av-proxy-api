/**
 * This file contains shared interfaces for Benzinga API parameters and responses.
 */

// Canonical Benzinga endpoint keys (lower-kebab-case)
export enum BenzingaEndpoint {
    EARNINGS = 'earnings',
    DIVIDENDS = 'dividends',
    ECONOMICS = 'economics',
    IPOS = 'ipos',
    CONFERENCE_CALLS = 'conference-calls',
    FDA = 'fda',
    MERGERS_ACQUISITIONS = 'mergers-acquisitions',
    RATINGS = 'ratings',
    GUIDANCE = 'guidance',
    SPLITS = 'splits',
    OFFERINGS = 'offerings'
  }
  
  // Column configuration for dynamic calendar tables
  export interface CalendarColumnConfig {
    key: string;
    displayName: string;
    format?: 'text' | 'number' | 'percent' | 'currency' | 'date' | 'abbreviateCurrency';
    currencySymbol?: string;
    digitsInfo?: string;
  }
  
  // --- Benzinga Calendar Endpoint Response Types ---
  
  /**
   * IPO Calendar API response object (single IPO)
   */
  export interface BzIpoCalendarEntry {
    id: string;
    date: string;
    time: string;
    ticker: string;
    exchange: string;
    name: string;
    open_date_verified: boolean;
    pricing_date: string;
    currency: string;
    price_min: string;
    price_max: string;
    price_public_offering: string;
    price_open: string;
    deal_status: string;
    ipo_type: string;
    insider_lockup_days: number;
    insider_lockup_date: string;
    offering_value: number;
    offering_shares: number;
    shares_outstanding: number;
    lead_underwriters: string[];
    other_underwriters: string[];
    underwriter_quiet_expiration_days: number;
    underwriter_quiet_expiration_date: string;
    notes: string;
    updated: number;
  }
  export interface BzIpoCalendarResponse {
    ipos: BzIpoCalendarEntry[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
  }
  
  /**
   * Splits Calendar API response object (single split)
   */
  export interface BzSplitCalendarEntry {
    symbol: string;
    company_name: string;
    split_date: string;
    split_ratio: string;
    announcement_date: string;
    ex_date: string;
    record_date: string;
    payment_date: string;
    notes: string;
    updated: number;
  }
  export interface BzSplitsCalendarResponse {
    splits: BzSplitCalendarEntry[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
  }
  
  /**
   * Guidance Calendar API response object (single guidance)
   */
  export interface BzGuidanceCalendarEntry {
    symbol: string;
    company_name: string;
    guidance_date: string;
    fiscal_period: string;
    guidance_type: string;
    guidance_value: string;
    guidance_range_min: string;
    guidance_range_max: string;
    currency: string;
    notes: string;
    updated: number;
  }
  export interface BzGuidanceCalendarResponse {
    guidance: BzGuidanceCalendarEntry[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
  }
  
  // --- Column Metadata Arrays ---
  export const bzIpoCalendarColumns: CalendarColumnConfig[] = [
    { key: 'date', displayName: 'Date', format: 'date' },
    { key: 'ticker', displayName: 'Ticker', format: 'text' },
    { key: 'name', displayName: 'Company', format: 'text' },
    { key: 'exchange', displayName: 'Exchange', format: 'text' },
    { key: 'price_min', displayName: 'Price Min', format: 'currency', currencySymbol: 'USD' },
    { key: 'price_max', displayName: 'Price Max', format: 'currency', currencySymbol: 'USD' },
    { key: 'price_public_offering', displayName: 'Offering Price', format: 'currency', currencySymbol: 'USD' },
    { key: 'offering_shares', displayName: 'Shares', format: 'number' },
    { key: 'offering_value', displayName: 'Offering Value', format: 'currency', currencySymbol: 'USD' },
    { key: 'deal_status', displayName: 'Status', format: 'text' },
    { key: 'ipo_type', displayName: 'Type', format: 'text' },
  ];
  
  export const bzSplitsCalendarColumns: CalendarColumnConfig[] = [
    { key: 'symbol', displayName: 'Symbol', format: 'text' },
    { key: 'company_name', displayName: 'Company', format: 'text' },
    { key: 'split_date', displayName: 'Split Date', format: 'date' },
    { key: 'split_ratio', displayName: 'Ratio', format: 'text' },
    { key: 'announcement_date', displayName: 'Announced', format: 'date' },
    { key: 'ex_date', displayName: 'Ex Date', format: 'date' },
    { key: 'record_date', displayName: 'Record Date', format: 'date' },
    { key: 'payment_date', displayName: 'Payment Date', format: 'date' },
  ];
  
  export const bzGuidanceCalendarColumns: CalendarColumnConfig[] = [
    { key: 'symbol', displayName: 'Symbol', format: 'text' },
    { key: 'company_name', displayName: 'Company', format: 'text' },
    { key: 'guidance_date', displayName: 'Date', format: 'date' },
    { key: 'fiscal_period', displayName: 'Fiscal Period', format: 'text' },
    { key: 'guidance_type', displayName: 'Type', format: 'text' },
    { key: 'guidance_value', displayName: 'Value', format: 'currency', currencySymbol: 'USD' },
    { key: 'guidance_range_min', displayName: 'Range Min', format: 'currency', currencySymbol: 'USD' },
    { key: 'guidance_range_max', displayName: 'Range Max', format: 'currency', currencySymbol: 'USD' },
    { key: 'currency', displayName: 'Currency', format: 'text' },
  ];
  
  // Map endpoint to correct API response type
  export type BenzingaEndpointResponseMap = {
      [BenzingaEndpoint.EARNINGS]: EarningsResponse;
      [BenzingaEndpoint.DIVIDENDS]: DividendsApiResponse;
      [BenzingaEndpoint.ECONOMICS]: any;
      [BenzingaEndpoint.IPOS]: BzIpoCalendarResponse;
      [BenzingaEndpoint.CONFERENCE_CALLS]: any;
      [BenzingaEndpoint.FDA]: any;
      [BenzingaEndpoint.MERGERS_ACQUISITIONS]: any;
      [BenzingaEndpoint.RATINGS]: any;
      [BenzingaEndpoint.GUIDANCE]: BzGuidanceCalendarResponse;
      [BenzingaEndpoint.SPLITS]: BzSplitsCalendarResponse;
      [BenzingaEndpoint.OFFERINGS]: any;
  };
  
  // --- Earnings Endpoint Types ---
  
  /**
   * Represents a single earnings record from the Benzinga Earnings endpoint.
   */
  export interface EarningsItem {
    exchange: string;
    name: string;
    period: string;
    eps_est: number | null;
    eps_act: number | null;
    eps_surprise: number | null;
    eps_surprise_percent: number | null;
    revenue_est: number | null;
    revenue_act: number | null;
    revenue_surprise: number | null;
    revenue_surprise_percent: number | null;
    updated: string;
    currency: string;
    importance: number;
    notes: string | null;
  }
  
  export interface EarningsCalendarParams extends BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint.EARNINGS;
    // Add earnings-specific filters if needed
  }
  
  // Map endpoint to correct item array type
  export type BenzingaEndpointItemMap = {
      [BenzingaEndpoint.EARNINGS]: EarningsItem[];
      [BenzingaEndpoint.DIVIDENDS]: DividendItem[];
      [BenzingaEndpoint.ECONOMICS]: any[];
      [BenzingaEndpoint.IPOS]: any[];
      [BenzingaEndpoint.CONFERENCE_CALLS]: any[];
      [BenzingaEndpoint.FDA]: any[];
      [BenzingaEndpoint.MERGERS_ACQUISITIONS]: any[];
      [BenzingaEndpoint.RATINGS]: any[];
      [BenzingaEndpoint.GUIDANCE]: any[];
      [BenzingaEndpoint.SPLITS]: any[];
      [BenzingaEndpoint.OFFERINGS]: any[];
  };
  
  // Metadata interface for each endpoint
  export interface BenzingaEndpointParamMeta {
    formKey: string;
    apiKey: string;
  }
  
  export interface BenzingaEndpointMetadata {
    name: BenzingaEndpoint;
    url: string; // Only the leaf, e.g. 'earnings'
    displayName: string;
    title: string;
    columns: CalendarColumnConfig[];
    params: BenzingaEndpointParamMeta[];
  }
  
  const baseParams: BenzingaEndpointParamMeta[] = [
    { formKey: 'ticker', apiKey: 'ticker' },
    { formKey: 'startDate', apiKey: 'start_date' },
    { formKey: 'endDate', apiKey: 'end_date' }
  ];
  
  // Metadata objects for each endpoint
  const earningsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.EARNINGS,
    url: 'earnings',
    displayName: 'Earnings',
    title: 'Earnings Calendar',
    columns: [
      { key: 'date', displayName: 'Date', format: 'date' },
      { key: 'period', displayName: 'Period', format: 'text' },
      { key: 'eps', displayName: 'EPS', format: 'currency', currencySymbol: 'USD', digitsInfo: '1.2-2' },
      { key: 'eps_est', displayName: 'EPS Est', format: 'currency', currencySymbol: 'USD', digitsInfo: '1.2-2' },
      { key: 'eps_prior', displayName: 'EPS Prior', format: 'currency', currencySymbol: 'USD', digitsInfo: '1.2-2' },
      { key: 'eps_surprise', displayName: 'EPS Surprise', format: 'currency', currencySymbol: 'USD', digitsInfo: '1.2-2' },
      { key: 'eps_surprise_percent', displayName: 'EPS Surprise %', format: 'percent', digitsInfo: '1.2-2' },
      { key: 'revenue', displayName: 'Revenue', format: 'abbreviateCurrency', digitsInfo: '1.0-0' },
      { key: 'revenue_est', displayName: 'Revenue Est', format: 'abbreviateCurrency', digitsInfo: '1.0-0' },
      { key: 'revenue_prior', displayName: 'Revenue Prior', format: 'abbreviateCurrency', digitsInfo: '1.0-0' },
      { key: 'revenue_surprise', displayName: 'Revenue Surprise', format: 'abbreviateCurrency', digitsInfo: '1.0-0' },
      { key: 'revenue_surprise_percent', displayName: 'Revenue Surprise %', format: 'percent', digitsInfo: '1.2-2' },
      { key: 'eps_type', displayName: 'EPS Type', format: 'text' },
      { key: 'notes', displayName: 'Notes', format: 'text' }
    ],
    params: [...baseParams]
  };
  
  const dividendsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.DIVIDENDS,
    url: 'dividends',
    displayName: 'Dividends',
    title: 'Dividends Calendar',
    columns: [
      { key: 'date', displayName: 'Date', format: 'date' },
      { key: 'dividend', displayName: 'Dividend', format: 'currency', currencySymbol: '$', digitsInfo: '1.2-2' },
      { key: 'dividend_prior', displayName: 'Prior Dividend', format: 'currency', currencySymbol: '$', digitsInfo: '1.2-2' },
      { key: 'dividend_type', displayName: 'Type', format: 'text' },
      { key: 'dividend_yield', displayName: 'Yield', format: 'percent', digitsInfo: '1.2-2' },
      { key: 'ex_dividend_date', displayName: 'Ex-Div Date', format: 'date' },
      { key: 'record_date', displayName: 'Record Date', format: 'date' },
      { key: 'payable_date', displayName: 'Payable Date', format: 'date' },
      { key: 'frequency', displayName: 'Frequency', format: 'text' },
      { key: 'currency', displayName: 'Currency', format: 'text' },
      { key: 'notes', displayName: 'Notes', format: 'text' },
      { key: 'updated', displayName: 'Updated', format: 'date' }
    ],
    params: [
      ...baseParams,
      { formKey: 'dividendYieldGt', apiKey: 'dividend_yield_gt' },
      { formKey: 'dateSort', apiKey: 'sort' }
    ]
  };
  
  const economicsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.ECONOMICS,
    url: 'economics',
    displayName: 'Economics',
    title: 'Economics Calendar',
    columns: [],
    params: [...baseParams]
  };
  
  const iposMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.IPOS,
    url: 'ipos',
    displayName: 'IPOs',
    title: 'IPO Calendar',
    columns: bzIpoCalendarColumns,
    params: [...baseParams]
  };
  
  const conferenceCallsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.CONFERENCE_CALLS,
    url: 'conference_calls',
    displayName: 'Con calls',
    title: 'Conference Calls Calendar',
    columns: [],
    params: [...baseParams]
  };
  
  const fdaMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.FDA,
    url: 'fda',
    displayName: 'FDA',
    title: 'FDA Calendar',
    columns: [],
    params: [...baseParams]
  };
  
  const mergersAcquisitionsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.MERGERS_ACQUISITIONS,
    url: 'ma',
    displayName: 'M&As',
    title: 'Mergers & Acquisitions Calendar',
    columns: [],
    params: [...baseParams]
  };
  
  const ratingsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.RATINGS,
    url: 'ratings',
    displayName: 'Ratings',
    title: 'Ratings Calendar',
    columns: [],
    params: [...baseParams]
  };
  
  const guidanceMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.GUIDANCE,
    url: 'guidance',
    displayName: 'Guidance',
    title: 'Guidance Calendar',
    columns: bzGuidanceCalendarColumns,
    params: [...baseParams]
  };
  
  const splitsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.SPLITS,
    url: 'splits',
    displayName: 'Splits',
    title: 'Splits Calendar',
    columns: [],
    params: [...baseParams]
  };
  
  const offeringsMeta: BenzingaEndpointMetadata = {
    name: BenzingaEndpoint.OFFERINGS,
    url: 'offerings',
    displayName: 'Offerings',
    title: 'Offerings Calendar',
    columns: [],
    params: [...baseParams]
  };
  
  // Canonical map: key = BenzingaEndpoint, value = metadata object
  export const BENZINGA_ENDPOINTS_MAP: Record<BenzingaEndpoint, BenzingaEndpointMetadata> = {
    [BenzingaEndpoint.EARNINGS]: earningsMeta,
    [BenzingaEndpoint.DIVIDENDS]: dividendsMeta,
    [BenzingaEndpoint.ECONOMICS]: economicsMeta,
    [BenzingaEndpoint.IPOS]: iposMeta,
    [BenzingaEndpoint.CONFERENCE_CALLS]: conferenceCallsMeta,
    [BenzingaEndpoint.FDA]: fdaMeta,
    [BenzingaEndpoint.MERGERS_ACQUISITIONS]: mergersAcquisitionsMeta,
    [BenzingaEndpoint.RATINGS]: ratingsMeta,
    [BenzingaEndpoint.GUIDANCE]: guidanceMeta,
    [BenzingaEndpoint.SPLITS]: splitsMeta,
    [BenzingaEndpoint.OFFERINGS]: offeringsMeta
  };
  
  /**
   * Base parameters for all Benzinga calendar endpoints (form-side, lowerCamelCase)
   */
  export interface BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint;
    tickers?: string | string[];
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }
  
  /**
   * Dividends endpoint parameters (form-side, lowerCamelCase)
   */
  export interface DividendsCalendarParams extends BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint.DIVIDENDS;
    dividendYieldGt?: string;
    dateSort?: string;
  }
  
   /** Discriminated union of all supported endpoint params (form-side)
   */
  export interface IposCalendarParams extends BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint.IPOS;
    // Add IPO-specific filters if needed
  }
  export interface SplitsCalendarParams extends BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint.SPLITS;
    // Add splits-specific filters if needed
  }
  
  export interface GuidanceCalendarParams extends BenzingaCalendarParamsBase {
    calendarType: BenzingaEndpoint.GUIDANCE;
    // Add guidance-specific filters if needed
  }
  
  export type BenzingaCalendarParams =
    | DividendsCalendarParams
    | IposCalendarParams
    | SplitsCalendarParams
    | GuidanceCalendarParams
    | EarningsCalendarParams;
  
  /**
   * Represents the overall API response for an earnings calendar request from Benzinga.
   */
  export interface EarningsResponse {
    earnings: EarningsItem[];
    next_url?: string;
    previous_url?: string | null;
    count: number;
    status: string;
    message?: string;
  }
  
  /**
   * Represents a single dividend record from the Benzinga Dividends endpoint.
   */
  export interface DividendItem {
    id: string;
    ticker: string;
    name: string;
    exchange: string;
    date: string; // ISO date string
    ex_dividend_date: string; // ISO date string
    record_date: string; // ISO date string
    payable_date: string; // ISO date string
    dividend: string;
    dividend_prior: string;
    dividend_type: string;
    dividend_yield: string;
    end_regular_dividend: boolean;
    frequency: number;
    importance: number;
    currency: string;
    notes: string;
    updated: number; // Unix timestamp
  }
  
  
  /**
   * Full API response for Benzinga Dividends endpoint.
   */
  export interface DividendsApiResponse {
    dividends: DividendItem[];
  }
  