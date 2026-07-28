/**
 * Shared types for the per-contract metadata catalog.
 *
 * The catalog lives in Firestore at
 * `options-file-index/{symbol}/ts-contracts/{contractId}` and is updated
 * daily by the time-series builder.  The `partnerContractCatalogV2`
 * endpoint serves these docs to consumers with server-side filtering,
 * sorting, and pagination.
 */

// ---- Firestore collection constants ----

/** Subcollection for per-contract catalog docs. */
export const TS_CONTRACTS_SUBCOLLECTION = 'ts-contracts';

// ---- Document types ----

/**
 * Snapshot of the most recent observation's greeks and liquidity fields.
 *
 * Values are strings (matching the JSONL storage format) to avoid precision
 * loss.  Consumers parse to float as needed.
 *
 * `bid`, `ask`, and `last` are intentionally excluded — they are quote-detail
 * fields not needed for contract selection.
 */
export interface LatestSnapshot {
  mark?: string;
  volume?: string;
  openInterest?: string;
  iv?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
}

/**
 * Per-contract catalog document stored at
 * `options-file-index/{symbol}/ts-contracts/{contractId}`.
 *
 * Written by the time-series builder after each GCS file flush and by the
 * one-time backfill script.  Expired contracts become frozen — their docs
 * retain the last known values indefinitely.
 */
export interface ContractCatalogDoc {
  /** OCC-format contract identifier (e.g. "QQQ260116C00450000"). */
  contractId: string;
  /** Expiration date in ISO format (e.g. "2026-01-16"). */
  expiration: string;
  /** Strike price in dollars. */
  strike: number;
  /** Option type. */
  type: 'call' | 'put';
  /** First trading date with data for this contract (ISO date). */
  firstObserved: string;
  /** Day of week for `firstObserved` (e.g. "Wed"). */
  firstObservedDow: string;
  /** Most recent trading date with data (ISO date). */
  lastObserved: string;
  /** Day of week for `lastObserved` (e.g. "Fri"). */
  lastObservedDow: string;
  /** Total number of daily observations. */
  observationCount: number;
  /**
   * Trading days from `firstObserved` to `expiration` (inclusive).
   * Approximation — `firstObserved` is our proxy for market listing date.
   */
  expectedObservationCount: number;
  /** Calendar days from `firstObserved` to `expiration`. */
  contractLengthDays: number;
  /** Human-readable length label (e.g. "3mo", "1yr"). */
  contractLengthBucket: string;
  /** Snapshot of most recent observation. Absent on backfilled expired contracts. */
  latest?: LatestSnapshot;
  /** Numeric delta from latest observation, for Firestore range queries. */
  latestDelta?: number;
  /** Numeric IV from latest observation, for Firestore range queries. */
  latestIv?: number;
  /** ISO timestamp of the last write to this doc. */
  lastUpdated: string;
}

/**
 * Symbol summary document stored at `options-file-index/{symbol}`.
 *
 * Aggregated daily from all `ts-contracts` docs for the symbol.  Powers the
 * length-bucket filter buttons in the UI.
 */
export interface ContractSummaryDoc {
  /** Ticker symbol (e.g. "QQQ"). */
  symbol: string;
  /** Total number of contracts (active + expired). */
  totalContracts: number;
  /** Number of distinct expiration dates. */
  expirationCount: number;
  /** Histogram: bucket label → contract count. */
  lengthBuckets: Record<string, number>;
  /** ISO timestamp of the last aggregation run. */
  lastUpdated: string;
}

// ---- API response types ----

/**
 * Single contract entry in the catalog API response.
 *
 * Same as `ContractCatalogDoc` but omits `lastUpdated`, which is
 * internal metadata not relevant to API consumers.
 */
export type ContractCatalogEntry = Omit<ContractCatalogDoc, 'lastUpdated'>;

/**
 * Response for `partnerContractCatalogV2` in catalog mode.
 */
export interface ContractCatalogResponse {
  ok: true;
  symbol: string;
  contracts: ContractCatalogEntry[];
  count: number;
  /** Opaque cursor for the next page. Absent when there are no more results. */
  nextPageToken?: string;
}

/**
 * Response for `partnerContractCatalogV2` in summary mode (`?summary=true`).
 */
export interface ContractSummaryResponse {
  ok: true;
  symbol: string;
  totalContracts: number;
  expirationCount: number;
  lengthBuckets: Record<string, number>;
  lastUpdated: string;
}

/**
 * Error response for `partnerContractCatalogV2`.
 */
export interface ContractCatalogErrorResponse {
  ok: false;
  error: string;
  code: string;
  timestamp: string;
}

// ---- Sort options ----

/** Fields the catalog endpoint can sort by. */
export type CatalogSortField =
  | 'expiration'
  | 'strike'
  | 'contractLengthDays'
  | 'observationCount'
  | 'delta';

/** Sort direction. */
export type CatalogSortOrder = 'asc' | 'desc';
