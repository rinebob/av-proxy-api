/**
 * Shared types for bulk symbol onboarding/import.
 * Used by both Cloud Functions and Angular frontend via @shared/bulk-import.
 */

export interface BulkImportItem {
  /** Canonical symbol to onboard (e.g., NVDA) */
  symbol: string;
  /** Human-readable company name (from scraper/company_name) */
  name: string;
  /** Optional exchange identifier from scraper (e.g., NASDAQ, NYSE) */
  exchange?: string;
  /** Optional list of ETF tickers this symbol belongs to (e.g., ["SPY", "QQQ"]) */
  etfs?: string[];
}

export enum BulkImportOutcome {
  ALREADY_TRACKED = 'ALREADY_TRACKED',
  AUTO_ACCEPTED = 'AUTO_ACCEPTED',
  QUEUED_PENDING_NO_STRICT_MATCH = 'QUEUED_PENDING_NO_STRICT_MATCH',
  FAILED = 'FAILED',
}

export interface BulkImportSymbolLog {
  symbol: string;
  name: string;
  exchange?: string;
  etfs?: string[];
  outcome: BulkImportOutcome;
  /** Optional reason for FAILED or queued cases (e.g., NO_STRICT_MATCH, AV_ERROR, NO_CANDIDATES). */
  reason?: string;
  /** Number of AV candidates returned for this symbol (if lookup was performed). */
  avCandidateCount?: number;
}

export interface BulkImportResult {
  ok: boolean;
  /** Symbols we skipped because they already existed in tracked-symbols. */
  alreadyTracked: number;
  /** Symbols auto-accepted via strict AV match and written to tracked-symbols. */
  autoAccepted: number;
  /** Symbols queued for manual review in symbol-import-queue. */
  queuedForReview: number;
  /** Symbols that definitively failed during this run (e.g., AV errors, no candidates). */
  failed: number;
  /**
   * Detailed error list for quick inspection of hard failures.
   * Typically populated for FAILED items or hard errors.
   */
  errors: { symbol: string; name: string; error: string }[];
  /** Optional per-symbol logs. Frontend can use this for richer summaries if needed. */
  logs?: BulkImportSymbolLog[];
}
