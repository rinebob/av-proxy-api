import type { AvHistoricalOptionsResponse, SvtOptionsAnalysis } from '@shared/alpha-vantage';
import type { Timestamp } from 'firebase-admin/firestore';

/** Supported symbols for the internal QQQ/TQQQ historical options corpus. */
export type CorpusSymbol = 'QQQ' | 'TQQQ';

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
  | 'not_found';

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

/** Payload for a single corpus seed Cloud Task. */
export interface CorpusSeedPayload {
  runId: string;
  symbol: string;
  date: string;
  attempt: number;
}

/** Canonical GCS object prefix for the corpus. */
export const HISTORICAL_OPTIONS_CORPUS_PREFIX = 'historical-options/v1';

/** Firestore root collection for corpus runs. */
export const OPTIONS_CORPUS_RUNS_COLLECTION = 'options_corpus_runs';

/** Subcollection for per-item seed outcomes. */
export const OPTIONS_CORPUS_ITEMS_SUBCOLLECTION = 'items';
