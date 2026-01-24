import type { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import type { TradingPhase } from '@shared/health-metrics';

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
}
