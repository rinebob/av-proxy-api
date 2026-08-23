/**
 * Configuration constants for time-series job pipeline.
 * 
 * Centralizes all magic numbers and configuration values
 * to improve maintainability and eliminate hardcoded values.
 */

/**
 * Maximum number of retry attempts for a job before
 * it is marked as PERMANENT_FAILURE.
 */
export const MAX_JOB_ATTEMPTS = 5;

/**
 * Fixed delay (in milliseconds) added to each job execution.
 *
 * Previously 1000ms to spread AV calls, but this was redundant with the
 * Cloud Tasks rate limiter (maxDispatchesPerSecond). Set to 0 because the
 * rate limiter already controls dispatch throughput. If you need to add
 * jitter for a specific reason, set this to a small value (e.g. 200ms).
 */
export const JOB_EXECUTION_DELAY_MS = 0;

/**
 * Maximum number of non-success jobs to include in run documents
 * to keep document size manageable.
 */
export const MAX_NON_SUCCESS_JOBS_IN_RUN_DOC = 50;

/**
 * Maximum run duration (in milliseconds) before a job is
 * considered timed out.
 */
export const MAX_RUN_DURATION_MS = 60 * 60 * 1000; // 60 minutes

/**
 * The clockPt (PT) value of the first intraday snapshot run of each trading day.
 * clockPt is always derived from America/Los_Angeles to match the scheduler timezone.
 * Co-located with the schedule `0 8,10,12 * * 1-5 (PT)` — if the schedule changes,
 * update this constant to match the new first tick.
 */
export const INTRADAY_FIRST_TICK = '0800';

/**
 * Maximum run duration for intraday snapshot runs.
 *
 * Intraday runs drain faster than POST runs (~13 min at 1.0/sec for 760
 * symbols), so the reconcile window is kept tight. Do NOT use
 * MAX_RUN_DURATION_MS for intraday — it would delay PDR notifications
 * by up to an hour.
 */
export const INTRADAY_MAX_RUN_DURATION_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Rate limits for Cloud Tasks queue.
 *
 * AV API tier: 75 req/min = 1.25/sec. Set to 1.2/sec (72/min) to leave
 * headroom for non-pipeline AV calls (manual triggers, onboarding, etc.).
 * With JOB_EXECUTION_DELAY_MS=0, this is the sole rate limiter.
 */
export const CLOUD_TASKS_RATE_LIMITS = {
  maxConcurrentDispatches: 20,
  maxDispatchesPerSecond: 1.2, // 72/min, under AV 75/min limit
} as const;

/**
 * Retry configuration for Cloud Tasks.
 */
export const CLOUD_TASKS_RETRY_CONFIG = {
  maxAttempts: 5,
  minBackoffSeconds: 10,
  maxBackoffSeconds: 300,
} as const;

/**
 * Memory allocation for job processing functions.
 */
export const JOB_FUNCTION_MEMORY = '512MiB' as const;

/**
 * TTL (time-to-live) for run documents and their jobs subcollections.
 *
 * After this duration, a nightly cleanup function will delete the run doc
 * and all child job docs to prevent unbounded Firestore growth.
 *
 * Both intraday-runs and realtime-runs use the same 2-day TTL:
 * - Intraday runs are only useful for same-day observability.
 * - POST runs rarely need inspection beyond the next trading day.
 */
export const RUN_DOC_TTL_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

/**
 * Maximum number of run documents to delete in a single cleanup invocation.
 *
 * Caps work per function execution to stay safely within the 9-min timeout.
 * At ~760 symbols per run and a 500-op Firestore batch limit, 200 runs is
 * a safe ceiling (~152,000 potential job docs, processed in batches of 500).
 */
export const CLEANUP_MAX_RUNS_PER_INVOCATION = 200;

/**
 * Firestore batch write limit (hard cap imposed by the SDK).
 */
export const FIRESTORE_BATCH_SIZE = 500;

/**
 * Timeout configuration for different job types.
 */
export const JOB_TIMEOUTS = {
  STANDARD: 540, // 9 minutes in seconds
  BACKFILL: 600, // 10 minutes in seconds
} as const;
