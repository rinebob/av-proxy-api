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

// Metadata interface for each endpoint
export interface BenzingaEndpointMetadata {
  name: BenzingaEndpoint;
  url: string; // Only the leaf, e.g. 'earnings'
  displayName: string;
}

// Metadata objects for each endpoint
const earningsMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.EARNINGS,
  url: 'earnings',
  displayName: 'Earnings'
};

const dividendsMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.DIVIDENDS,
  url: 'dividends',
  displayName: 'Dividends'
};

const economicsMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.ECONOMICS,
  url: 'economics',
  displayName: 'Economics'
};

const iposMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.IPOS,
  url: 'ipos',
  displayName: 'IPOs'
};

const conferenceCallsMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.CONFERENCE_CALLS,
  url: 'conference_calls',
  displayName: 'Con calls'
};

const fdaMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.FDA,
  url: 'fda',
  displayName: 'FDA'
};

const mergersAcquisitionsMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.MERGERS_ACQUISITIONS,
  url: 'ma',
  displayName: 'M&As'
};

const ratingsMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.RATINGS,
  url: 'ratings',
  displayName: 'Ratings'
};

const guidanceMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.GUIDANCE,
  url: 'guidance',
  displayName: 'Guidance'
};

const splitsMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.SPLITS,
  url: 'splits',
  displayName: 'Splits'
};

const offeringsMeta: BenzingaEndpointMetadata = {
  name: BenzingaEndpoint.OFFERINGS,
  url: 'offerings',
  displayName: 'Offerings'
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
 * Parameters for the getDynamicCalendar Cloud Function.
 */
export interface BenzingaCalendarParams {
  calendarType: BenzingaEndpoint;
  tickers?: string | string[];
  securities?: string | string[]; // For FDA endpoint
  date_from?: string;
  date_to?: string;
  page?: number;
  pagesize?: number;
  // Endpoint-specific params
  date_sort?: string;
  dividend_yield_gt?: string;
  importance?: string;
  country?: string;
  category?: string;
  fuzzy?: string;
}

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
