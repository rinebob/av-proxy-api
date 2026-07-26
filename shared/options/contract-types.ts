/** Shared types for options contract listing and file viewing. */

/** GCS bucket identifier used by the storage viewer and backend services. */
export type BucketName = 'time-series' | 'corpus';

// ---- Firestore collection constants ----

/** Firestore root collection for the options file index. */
export const OPTIONS_FILE_INDEX_COLLECTION = 'options-file-index';

/** Subcollection for per-expiration index docs. */
export const TS_EXPIRATIONS_SUBCOLLECTION = 'ts-expirations';

/** Subcollection for per-strike index docs. */
export const TS_STRIKES_SUBCOLLECTION = 'ts-strikes';

// ---- Firestore index document types ----

/** Expiration-level index document in `options-file-index/{symbol}/ts-expirations/{date}`. */
export interface ExpirationIndexDoc {
  date: string;
  strikes: number[];
  types: string[];
  contractIds: string[];
  /** Earliest firstObserved across all contracts in this expiration (ISO date). */
  firstObserved?: string;
  /** Total observation count across all contracts in this expiration. */
  observationCount?: number;
}

/** Strike-level index document in `options-file-index/{symbol}/ts-strikes/{strike}`. */
export interface StrikeIndexDoc {
  strike: number;
  expirations: string[];
  types: string[];
  contractIds: string[];
}

/** Parsed OCC contract result shared by admin and partner endpoints. */
export interface ContractResult {
  contractId: string;
  expiration: string;
  strike: number;
  type: 'call' | 'put';
  /** First observed trading date (ISO) from GCS metadata. */
  firstObserved?: string;
  /** Number of trading day observations from GCS metadata. */
  observationCount?: number;
}

/** Result of listing time-series contracts for a symbol. */
export interface ListTimeSeriesResult {
  bucket: 'time-series';
  symbol: string;
  contracts: ContractResult[];
  count: number;
}

/** Metadata for a single corpus file entry from GCS listing. */
export interface CorpusFileEntry {
  date: string;
  size: number;
  generation: string;
  updated: string;
}

/** Result of listing corpus dates for a symbol. */
export interface ListCorpusResult {
  bucket: 'corpus';
  symbol: string;
  dates: string[];
  files: CorpusFileEntry[];
  count: number;
}

/** Result of reading a file from GCS. */
export interface ReadResult {
  bucket: BucketName;
  path: string;
  content: string;
  bytes: number;
  /** GCS custom metadata (time-series only). */
  metadata?: Record<string, string>;
}

/** Union of all list result types. */
export type ListResult = ListTimeSeriesResult | ListCorpusResult;

// ---- Storage Viewer request types ----

export interface ListTimeSeriesRequest {
  action: 'list';
  bucket: 'time-series';
  symbol: string;
  expiration?: string;
  strike?: number;
  type?: 'C' | 'P';
}

export interface ListCorpusRequest {
  action: 'list';
  bucket: 'corpus';
  symbol: string;
}

export interface ReadTimeSeriesRequest {
  action: 'read';
  bucket: 'time-series';
  symbol: string;
  contractId: string;
}

export interface ReadCorpusRequest {
  action: 'read';
  bucket: 'corpus';
  symbol: string;
  date: string;
}

export type StorageViewerRequest =
  | ListTimeSeriesRequest
  | ListCorpusRequest
  | ReadTimeSeriesRequest
  | ReadCorpusRequest;
