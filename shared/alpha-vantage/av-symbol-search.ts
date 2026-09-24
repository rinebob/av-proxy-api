// COPIED FROM functions/src/v2/common/common-av.ts. Do not use directly until migration is complete.

import { TimestampLike } from "../firestore";
import type { TrackedSymbolCompanyInfo } from './av-company-overview';

// Canonical shared symbol match interface for Alpha Vantage symbol search (normalized keys)
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

export interface AlphaVantageSymbolMatch {
    "1. symbol": string;
    "2. name": string;
    "3. type": string;
    "4. region": string;
    "5. marketOpen": string;
    "6. marketClose": string;
    "7. timezone": string;
    "8. currency": string;
    "9. matchScore": string;
}

export interface AlphaVantageSymbolSearchResponse {
    bestMatches: AlphaVantageSymbolMatch[];
}


/**
 * Represents a symbol from Alpha Vantage SYMBOL_SEARCH endpoint
 * This is the canonical shape for all symbol data in the system
 */
export interface AvSymbol {
    // AV SYMBOL_SEARCH response object fields
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
 * Represents a symbol from Alpha Vantage SYMBOL_SEARCH endpoint
 * This is the canonical shape for all symbol data in the system
 */
export interface TrackedSymbolV2 extends AvSymbol {
  // System fields. _ prefix to allow flattening without mixing with AV fields
  _createdAt: TimestampLike | Date;
  _lastUpdated: TimestampLike | Date;

  // Is currently on at least one users personal symbol watchlist
  // This is used to determine if a symbol should be included in the list of symbols to refresh
  _isActive: boolean;

  // Stable company identity fields denormalized from COMPANY_OVERVIEW.
  // Populated by the OVERVIEW refresh job to enable sector/industry sorting
  // without requiring a join to symbol-data.
  companyInfo?: TrackedSymbolCompanyInfo;
  _companyInfoLastUpdated?: TimestampLike | Date;

  // Options-corpus flags (Topic #102 / Thread #105).
  // `optionable`: factual — symbol has a listed option chain (system-probed).
  // `optionsEnabled`: curated — operator opted the symbol into the options
  // corpus pipeline (swing-set generation → pivot options ingest → contract
  // time-series). Both absent until Thread #105 lands.
  optionable?: boolean | null;
  optionsEnabled?: boolean;
  optionableCheckedAt?: TimestampLike | Date;
  /** Liquidity snapshot recorded by the optionable probe (Thread #105 §80). */
  optionableProbeSummary?: {
    totalContracts?: number;
    totalVolume?: number;
    totalOpenInterest?: number;
    uniqueStrikes?: number;
    /** Count of distinct expiration dates in the probed chain. */
    expirations?: number;
  };
  /** Audit trail of optionsEnabled toggles (Thread #105 §70). */
  optionsEnabledHistory?: {
    enabled: boolean;
    changedBy?: string;
    changedAt: TimestampLike | Date;
    reason?: string;
  }[];
}

export interface ListSymbolsV2Response {
    symbols: TrackedSymbolV2[];
    total: number;
    limit: number;
    offset: number;
}

/**
 * Lifecycle states for a newly tracked symbol while initial data is fetched.
 * The 'ready' state signals to consumers that all required data is present.
 */
export enum TrackedSymbolOnboardingStatus {
  PENDING = 'pending',
  PRICE_DATA_READY = 'price_data_ready',
  READY = 'ready',
  ONBOARDING_FAILED = 'onboarding_failed',
}

// Centralized Firestore field names for tracked symbols
export const TRACKED_SYMBOL_V2_FIELDS = {
  SYMBOL: 'symbol',
  NAME: 'name',
  TYPE: 'type',
  REGION: 'region',
  MARKET_OPEN: 'marketOpen',
  MARKET_CLOSE: 'marketClose',
  TIMEZONE: 'timezone',
  CURRENCY: 'currency',
  MATCH_SCORE: 'matchScore',
  CREATED_AT: '_createdAt',
  LAST_UPDATED: '_lastUpdated',
  IS_ACTIVE: '_isActive',
  COMPANY_INFO: 'companyInfo',
  COMPANY_INFO_LAST_UPDATED: '_companyInfoLastUpdated',
  ONBOARDING_STATUS: '_onboardingStatus',
  READY_AT: '_readyAt',
  ONBOARDING_FAILED_AT: '_onboardingFailedAt',
  ONBOARDING_FAILURE_REASON: '_onboardingFailureReason',
  OPTIONABLE: 'optionable',
  OPTIONS_ENABLED: 'optionsEnabled',
  OPTIONABLE_CHECKED_AT: 'optionableCheckedAt',
  OPTIONABLE_PROBE_SUMMARY: 'optionableProbeSummary',
  OPTIONS_ENABLED_HISTORY: 'optionsEnabledHistory',
};

/**
 * Fields legal for `sortBy` in listSymbolsV2 and the partner list endpoint.
 * `companyInfo.*` entries are nested field paths — Firestore orderBy accepts
 * dotted paths on map fields. Narrower than TRACKED_SYMBOL_V2_FIELDS: fields
 * like matchScore/timezone exist on the doc but are not sortable via the API.
 */
export const TRACKED_SYMBOL_SORTABLE_FIELDS = [
  'symbol', 'name', 'type', 'region', 'currency',
  '_createdAt', '_lastUpdated',
  'companyInfo.Sector', 'companyInfo.Industry', 'companyInfo.Country',
  'companyInfo.marketCap', 'companyInfo.beta',
] as const;

export type TrackedSymbolSortableField = (typeof TRACKED_SYMBOL_SORTABLE_FIELDS)[number];

/**
 * Resolves a caller-supplied sortBy value to a valid Firestore field path,
 * falling back to 'symbol' for absent or non-whitelisted values.
 */
export function resolveTrackedSymbolSortField(sortBy: string | undefined | null): string {
  return sortBy && (TRACKED_SYMBOL_SORTABLE_FIELDS as readonly string[]).includes(sortBy)
    ? sortBy
    : TRACKED_SYMBOL_V2_FIELDS.SYMBOL;
}

export interface SaveTrackedSymbolResponse {
    success: boolean;
    symbol: string;
    message?: string;
    error?: string;
}

/**
 * Options for listing symbols
 */
export interface ListSymbolsOptions {
    activeOnly?: boolean;
    includeInactive?: boolean; // For backward compatibility
    limit?: number;
    offset?: number;
    sortBy?: string; // validated via resolveTrackedSymbolSortField; non-whitelisted falls back to 'symbol'
    sortDirection?: 'asc' | 'desc';
  
}