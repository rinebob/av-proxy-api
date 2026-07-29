/**
 * Request and response types for the spread time series endpoints.
 */

// ── Request types ──────────────────────────────────────────────────────────

export type SpreadType = 'vertical' | 'straddle' | 'strangle' | 'iron_condor';

export type LegDirection = 'long' | 'short';

export type OptionType = 'call' | 'put';

export type DebitOrCredit = 'debit' | 'credit';

export interface SpreadLegRequest {
  expiration: string;
  strike: number;
  optionType: OptionType;
  direction: LegDirection;
}

export interface SpreadRequest {
  spreadType: SpreadType;
  symbol: string;
  legs: SpreadLegRequest[];
  startDate?: string;
  endDate?: string;
}

// ── Response types ─────────────────────────────────────────────────────────

export interface LegObservation {
  date: string;
  mark: number;
}

export interface SpreadLegResponse {
  contractID: string;
  expiration: string;
  strike: number;
  optionType: OptionType;
  direction: LegDirection;
  firstObserved: string;
  lastObserved: string;
  series: LegObservation[];
}

export interface SpreadObservation {
  date: string;
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface SpreadResponse {
  ok: true;
  spreadType: SpreadType;
  symbol: string;
  debitOrCredit: DebitOrCredit;
  startDate: string;
  endDate: string;
  gaps: string[];
  legs: SpreadLegResponse[];
  series: SpreadObservation[];
}

export interface SpreadErrorResponse {
  ok: false;
  error: string;
  code: SpreadErrorCode;
  timestamp: string;
}

export enum SpreadErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  FORBIDDEN = 'FORBIDDEN',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  RESPONSE_TOO_LARGE = 'RESPONSE_TOO_LARGE',
  NOT_FOUND = 'NOT_FOUND',
}

// ── Internal result type (used by the pricing service) ─────────────────────

export interface SpreadResult {
  spreadType: SpreadType;
  symbol: string;
  debitOrCredit: DebitOrCredit;
  startDate: string;
  endDate: string;
  gaps: string[];
  legs: SpreadLegResponse[];
  series: SpreadObservation[];
}

export interface SpreadResultError {
  error: string;
  code: SpreadErrorCode;
  legIndex?: number;
  contractID?: string;
}

// ── Batch types (Phase 2) ──────────────────────────────────────────────────

export interface SpreadBatchRequest {
  spreads: SpreadRequest[];
  startDate?: string;
  endDate?: string;
}

/**
 * Per-spread result in a batch response. Contains only the spread series
 * (no leg series) to keep payload size manageable for multi-spread comparison.
 */
export interface SpreadBatchItemSuccess {
  ok: true;
  index: number;
  spreadType: SpreadType;
  symbol: string;
  debitOrCredit: DebitOrCredit;
  startDate: string;
  endDate: string;
  gaps: string[];
  series: SpreadObservation[];
}

export interface SpreadBatchItemFailure {
  ok: false;
  index: number;
  error: string;
  code: SpreadErrorCode;
}

export type SpreadBatchItem = SpreadBatchItemSuccess | SpreadBatchItemFailure;

export interface SpreadBatchResponse {
  ok: true;
  total: number;
  succeeded: number;
  failed: number;
  results: SpreadBatchItem[];
}

export interface SpreadBatchErrorResponse {
  ok: false;
  error: string;
  code: SpreadErrorCode;
  timestamp: string;
}
