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
 * Fixed delay (in milliseconds) added to each job execution
 * to spread AV calls and make individual executions visible in logs.
 */
export const JOB_EXECUTION_DELAY_MS = 1_000;

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
 */
export const CLOUD_TASKS_RATE_LIMITS = {
  maxConcurrentDispatches: 20,
  maxDispatchesPerSecond: 1.0, // Stay under AV 75/min limit
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
