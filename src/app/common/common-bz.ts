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

// Map endpoint to correct API response type
export type BenzingaEndpointResponseMap = {
    [BenzingaEndpoint.EARNINGS]: EarningsResponse;
    [BenzingaEndpoint.DIVIDENDS]: DividendsApiResponse;
    [BenzingaEndpoint.ECONOMICS]: any;
    [BenzingaEndpoint.IPOS]: any;
    [BenzingaEndpoint.CONFERENCE_CALLS]: any;
    [BenzingaEndpoint.FDA]: any;
    [BenzingaEndpoint.MERGERS_ACQUISITIONS]: any;
    [BenzingaEndpoint.RATINGS]: any;
    [BenzingaEndpoint.GUIDANCE]: any;
    [BenzingaEndpoint.SPLITS]: any;
    [BenzingaEndpoint.OFFERINGS]: any;
};

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
  columns: [],
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
  columns: [],
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

/**
 * Earnings endpoint parameters (form-side, lowerCamelCase)
 */
export interface EarningsCalendarParams extends BenzingaCalendarParamsBase {
  calendarType: BenzingaEndpoint.EARNINGS;
  // Add earnings-specific fields here if needed
}

/**
 * Discriminated union of all supported endpoint params (form-side)
 */
export type BenzingaCalendarParams =
  | DividendsCalendarParams
  | EarningsCalendarParams;


/**
 * Represents the structure of a single earnings event from Benzinga.
 * TODO: Create separate interfaces for each calendar type.
 */
export interface EarningsItem {
  id?: string;
  date: string;
  time: string;
  ticker: string;
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
