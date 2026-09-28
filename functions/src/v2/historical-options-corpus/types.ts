import type { AvHistoricalOptionsResponse, SvtOptionsAnalysis } from '@shared/alpha-vantage';
import type { Timestamp } from 'firebase-admin/firestore';

// Note: the former CorpusSymbol ('QQQ' | 'TQQQ') restriction was lifted in
// Task #150 — any tracked symbol with optionsEnabled === true is processable;
// the curation gate lives in services/options-enabled-gate.ts.

/** Versioned envelope stored as the gzipped object payload in GCS. */
export interface HistoricalOptionsCorpusEnvelope {
  version: 'v1';
  schema: 'historical-options';
  generatedAt: string;
  symbol: string;
  date: string;
  response: AvHistoricalOptionsResponse;
  analysis: SvtOptionsAnalysis;
  checksum: {
    algorithm: 'sha256';
    value: string;
  };
}

/** Status of a single corpus seed item. */
export type CorpusItemStatus =
  | 'pending'
  | 'in_progress'
  | 'success'
  | 'failure'
  | 'permanent_failure'
  | 'not_found'
  /** Terminal: curation gate dropped the item (optionsEnabled !== true). */
  | 'skipped';

/** Firestore document stored under `options_corpus_runs/{runId}/items/{symbol}_{date}`. */
export interface CorpusItemDoc {
  symbol: string;
  date: string;
  status: CorpusItemStatus;
  attempts: number;
  gcsPath?: string;
  sha256?: string;
  bytes?: number;
  generation?: string;
  error?: string;
  attemptedAt?: Timestamp;
  completedAt?: Timestamp;
  apiCalls?: number;
}

/** Firestore document stored under `options_corpus_runs/{runId}`. */
export interface CorpusRunDoc {
  runId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  status: 'planned' | 'in_progress' | 'completed' | 'failed';
  symbols: string[];
  startDate: string;
  endDate: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  apiCalls: number;
  dryRun: boolean;
  pilot: boolean;
}

/** Result of reading a stored corpus item. */
export type CorpusReadResult =
  | {
      status: 'FOUND';
      response: AvHistoricalOptionsResponse;
      analysis: SvtOptionsAnalysis;
      envelope: HistoricalOptionsCorpusEnvelope;
      bytes: number;
    }
  | { status: 'NOT_FOUND' }
  | { status: 'CORRUPT'; reason: string };

/** Symbol + date pair used throughout the corpus. */
export interface CorpusItemKey {
  symbol: string;
  date: string;
}

/** Provenance of a corpus seed item — stamped onto the GCS object metadata. */
export type CorpusItemKind = 'confirmed' | 'interim';

/** Payload for a single corpus seed Cloud Task. */
export interface CorpusSeedPayload {
  runId: string;
  symbol: string;
  date: string;
  attempt: number;
  /**
   * Pivot provenance (Task #154): 'interim' objects are deleted when the
   * swing doc's extreme advances past their date; 'confirmed' snapshots are
   * permanent. Undefined for non-pivot producers (nightly/pilot).
   */
  kind?: CorpusItemKind;
}

/** Queue name for Stage-1 corpus seed tasks (matches the exported function id). */
export const OPTIONS_CORPUS_SEED_TASK_QUEUE = 'processHistoricalOptionsCorpusSeedTask';

/** Canonical GCS object prefix for the corpus. */
export const HISTORICAL_OPTIONS_CORPUS_PREFIX = 'historical-options/v1';

/**
 * Earliest date the options corpus seeds/builds. SA carries swing data back
 * to ~1999, but the front-end only consumes 2019+ — pre-floor dates cost a
 * rate-limited AV fetch and a GCS write nobody reads. Enforced at the pivot
 * planner, the seed worker, and the ts-build task.
 */
export const OPTIONS_CORPUS_FLOOR_DATE = '2019-01-01';

// Single fixed buckets — env override only for non-prod testing. The bucket
// name is config, not a secret; it's already in firebase.json storage rules.
export const DEFAULT_OPTIONS_CORPUS_BUCKET = 'av-hist-options-corpus-bucket';
export const DEFAULT_OPTIONS_TIME_SERIES_BUCKET = 'av-options-time-series-bucket';

/** Corpus bucket name — `OPTIONS_CORPUS_BUCKET` env override or the prod default. */
export function optionsCorpusBucket(): string {
  return process.env.OPTIONS_CORPUS_BUCKET ?? DEFAULT_OPTIONS_CORPUS_BUCKET;
}

/** Time-series bucket name — `OPTIONS_TIME_SERIES_BUCKET` env override or default. */
export function optionsTimeSeriesBucket(): string {
  return process.env.OPTIONS_TIME_SERIES_BUCKET ?? DEFAULT_OPTIONS_TIME_SERIES_BUCKET;
}

/** Firestore root collection for corpus runs. */
export const OPTIONS_CORPUS_RUNS_COLLECTION = 'options_corpus_runs';

/** Subcollection for per-item seed outcomes. */
export const OPTIONS_CORPUS_ITEMS_SUBCOLLECTION = 'items';

/** Canonical GCS object prefix for per-contract time series JSONL files. */
export const TIME_SERIES_PREFIX = 'time-series/v1';
