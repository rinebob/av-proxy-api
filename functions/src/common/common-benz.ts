/**
 * Benzinga API Types and Enums
 */

/**
 * Benzinga API Types and Enums (Backend Minimal)
 * Only types/enums needed for backend calendar param validation and mapping.
 * Do NOT add frontend/UI-specific objects here.
 */

// Canonical endpoint names for backend logic (match FE BenzingaEndpoint values)
export enum BenzingaCalendarType {
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
  OFFERINGS = 'offerings',
}

export enum BenzingaOutputFormat {
  JSON = 'json',
  XML = 'xml'
}

/**
 * Params for Benzinga Calendar API (snake_case, matches Benzinga docs)
 * Only include fields that are actually sent to Benzinga.
 */
export interface BenzingaCalendarParams {
  tickers?: string[];           // All endpoints except FDA and Economics
  securities?: string[];        // FDA endpoint only
  date_from?: string;           // Start of date range (YYYY-MM-DD)
  date_to?: string;             // End of date range (YYYY-MM-DD)
  date?: string;                // Single date (if supported)
  updated?: string;             // For deltas
  importance?: string;          // For filtering by importance
  dividend_yield_gt?: string;   // Dividends endpoint only
  country?: string;             // Economics endpoint
  category?: string;            // Economics endpoint
  fuzzy?: string;               // Economics endpoint
  sort?: string;                // If supported (e.g., Dividends)
  page?: number;
  pagesize?: number;
}


export interface BenzingaCalendarResponse {
  [key: string]: any;
}


/**
 * Indicates which Benzinga calendar endpoints require a ticker parameter.
 * Keys are BenzingaCalendarType enum values for type safety.
 */
export const BENZINGA_ENDPOINTS_REQUIRE_TICKER: Record<BenzingaCalendarType, boolean> = {
  [BenzingaCalendarType.EARNINGS]: true,
  [BenzingaCalendarType.DIVIDENDS]: true,
  [BenzingaCalendarType.ECONOMICS]: false,
  [BenzingaCalendarType.IPOS]: false,
  [BenzingaCalendarType.CONFERENCE_CALLS]: false,
  [BenzingaCalendarType.FDA]: false,
  [BenzingaCalendarType.MERGERS_ACQUISITIONS]: false,
  [BenzingaCalendarType.RATINGS]: false,
  [BenzingaCalendarType.GUIDANCE]: false,
  [BenzingaCalendarType.SPLITS]: false,
  [BenzingaCalendarType.OFFERINGS]: false,
};

// Add more Benzinga-specific types and interfaces as needed
