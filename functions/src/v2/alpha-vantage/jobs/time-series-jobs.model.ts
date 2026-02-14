import type { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import type { TradingPhase } from '@shared/health-metrics';
import type { RefreshTrigger } from '@shared/firestore';
import type { DataReadyPayloadV1 } from '../../partner/schemas/data-ready.schema';

/**
 * Status values for a single Alpha Vantage time-series refresh job.
 *
 * Jobs are per { marketDate, symbol, endpoint, phase } and tracked
 * under system/time-series-jobs/{marketDate}/jobs/{jobId}.
 */
export enum TimeSeriesJobStatus {
  Pending = 'PENDING',
  InProgress = 'IN_PROGRESS',
  Success = 'SUCCESS',
  TransientFailure = 'TRANSIENT_FAILURE',
  PermanentFailure = 'PERMANENT_FAILURE',
}

/**
 * Indicates whether the time-series for a given job has reached the
 * expected period-end bar (e.g. day/week/month) or is still in-progress.
 */
export enum PeriodStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  PERIOD_END = 'PERIOD_END',
}

/**
 * Job type for routing to correct Firestore paths and aggregation logic.
 */
export enum TimeSeriesJobType {
  REALTIME = 'realtime',
  BACKFILL = 'backfill',
}

/**
 * Execution modes for a time-series job.
 * - Compact: standard small-window refresh (scheduler path).
 * - FullBackfill: destructive full history rebuild for symbol+endpoint.
 */
export enum TimeSeriesJobMode {
  Compact = 'COMPACT',
  FullBackfill = 'FULL_BACKFILL',
}

/**
 * Terminal status values for job aggregation.
 * Used by both realtime and backfill aggregators to track job completion.
 */
export enum TimeSeriesJobTerminalStatus {
  SUCCESS = 'SUCCESS',
  PERMANENT_FAILURE = 'PERMANENT_FAILURE',
}

/**
 * Run-level status for time-series job runs (date-level or backfill runs).
 */
export enum TimeSeriesRunStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETE = 'COMPLETE',
}

/**
 * Indicates how current the vendor time-series data is for a given job's
 * target marketDate.
 *
 * This is intentionally orthogonal to TimeSeriesJobStatus:
 * - status describes pipeline health (success vs failure).
 * - dataFreshness describes whether the latest bar is at or after the
 *   target period end.
 */
export enum TimeSeriesDataFreshness {
  UNKNOWN = 'UNKNOWN',
  FRESH = 'FRESH',
  STALE = 'STALE',
}

/**
 * Canonical shape for an Alpha Vantage time-series refresh job
 * targeting sa-time-series data.
 */
export interface TimeSeriesJob {
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  interval: TimeSeriesInterval;
  phase: TradingPhase;

  status: TimeSeriesJobStatus;
  attempts: number;
  lastError?: string;

  // Optional execution mode for this job. When omitted, the job is treated
  // as a standard compact refresh. FULL_BACKFILL jobs perform a destructive
  // refresh for the target symbol+endpoint using OutputSize.FULL.
  mode?: TimeSeriesJobMode;

  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  lastAttemptAt?: FirebaseFirestore.Timestamp;

  // When validation confirms that the target bar/date for this
  // marketDate is present and correct. For DAILY this maps to the
  // finalized daily bar timestamp; for W/M it may map to the
  // provider's latest period bar.
  finalizedAtMs?: number;

  // Data freshness relative to the target marketDate/period for this job.
  // This does not indicate pipeline failure; it only captures whether the
  // latest vendor bar is fresh for the target period.
  dataFreshness?: TimeSeriesDataFreshness;
}

/**
 * Canonical shape for a realtime POST run document stored at
 * `realtime-runs/{runId}`.
 */
export interface RealtimeRun {
  runId: string;
  runType: string;
  marketDate: string;
  phase: TradingPhase;
  interval: TimeSeriesInterval;
  trigger: RefreshTrigger;

  status: TimeSeriesRunStatus;

  // Timestamps capturing the lifecycle of a realtime POST run.
  // - runCreatedAt: when the run document itself was first written.
  // - jobsCreationStartedAt: when the first job document for this run was created.
  // - runStartedAt: when the first AV fetch began for any job in this run.
  // - jobsCreationCompletedAt: when the last job document for this run was written.
  // - runFinishedAt: when the last AV fetch completed and the run reached a
  //   terminal state.
  runCreatedAt: FirebaseFirestore.Timestamp;
  jobsCreationStartedAt?: FirebaseFirestore.Timestamp;
  runStartedAt?: FirebaseFirestore.Timestamp;
  jobsCreationCompletedAt?: FirebaseFirestore.Timestamp;
  runFinishedAt?: FirebaseFirestore.Timestamp;

  createdJobs: number;
  finishedJobs: number;
  successJobs: number;
  permanentFailureJobs: number;

  // Count of symbols that were considered for this run but skipped during
  // job creation because their existing jobs were already in a terminal
  // state or because no work was needed.
  skippedSymbolsCount?: number;

  // Total duration in milliseconds from runStartedAt to runFinishedAt, plus a
  // human-readable formatted representation for quick inspection.
  totalDuration?: number;
  totalDurationFormatted?: string;

  // Symbols that reached permanent failure for this run.
  permanentFailureSymbols?: string[];

  // Symbols whose data was still stale for this run's target marketDate
  // and interval, based on the dataFreshness check in the worker.
  staleSymbols?: string[];

  // Symbols that should be retried on subsequent A/B/C passes for this
  // interval and trading date. This includes both stale symbols and
  // permanent failures.
  retrySymbols?: string[];

  // Subset of symbols that belonged to the per-run retry set and
  // subsequently reached SUCCESS for this run. This is used to derive
  // includeSymbols for retry-only Partner Data Ready messages so that
  // partners can ingest just the symbols that became fresh in this pass.
  retrySuccessSymbols?: string[];

  // Partner data-ready message tracking for this run.
  partnerDataReady?: {
    messageSent: boolean;
    sendTime: FirebaseFirestore.Timestamp;
    messagePayload?: DataReadyPayloadV1;
  };
}
