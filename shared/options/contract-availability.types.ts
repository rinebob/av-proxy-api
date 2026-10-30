/**
 * Shared types for the contract availability endpoint
 * (`partnerContractAvailabilityV1`).
 *
 * The endpoint returns, per symbol: (1) filtered entries from the
 * `options-file-index/{symbol}/ts-contracts` catalog — the canonical list of
 * contracts that actually have time-series data — and (2) `corpusDates`, the
 * dates for which a corpus object exists under
 * `historical-options-corpus/{symbol}/`.
 */

import type { ContractCatalogEntry, ContractCatalogErrorResponse } from './contract-catalog.types';
import type { PickOptionType } from './options-delta-picks.types';

/** Maximum contracts returned in one response before `truncated` is set. */
export const CONTRACT_AVAILABILITY_MAX_CONTRACTS = 2000;

/**
 * Normalized filter params parsed from the request query string.
 *
 * `expirations` (explicit list) overrides `expirationGte`/`expirationLte` —
 * when present, the range fields are absent.
 */
export interface ContractAvailabilityFilters {
  symbol: string;
  /** Inclusive lower bound on expiration (YYYY-MM-DD). */
  expirationGte?: string;
  /** Inclusive upper bound on expiration (YYYY-MM-DD). */
  expirationLte?: string;
  /** Explicit expiration list; overrides the expiration range. */
  expirations?: string[];
  /** Inclusive lower bound on strike. */
  strikeGte?: number;
  /** Inclusive upper bound on strike. */
  strikeLte?: number;
  /** Strike must be an exact multiple of this step (evaluated in cents). */
  strikeStep?: number;
  /** Option type filter; absent = both. */
  type?: PickOptionType;
  /** Inclusive bounds on the contract's first observation date. */
  firstObservedGte?: string;
  firstObservedLte?: string;
}

/** Response for `partnerContractAvailabilityV1`. */
export interface ContractAvailabilityResponse {
  ok: true;
  symbol: string;
  contracts: ContractCatalogEntry[];
  count: number;
  /** True when `contracts` was capped at CONTRACT_AVAILABILITY_MAX_CONTRACTS. */
  truncated: boolean;
  /** Dates with a corpus object for the symbol, sorted ascending (YYYY-MM-DD). */
  corpusDates: string[];
  corpusDateCount: number;
}

/** Error response for `partnerContractAvailabilityV1` — same shape as V2. */
export type ContractAvailabilityErrorResponse = ContractCatalogErrorResponse;
