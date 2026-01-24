/**
 * Global constants for V2 functions
 */

// Cloud Tasks
export enum CloudTask {
  REMEDIATE_SPLIT_HISTORY = 'remediateSplitHistory',
  // For v2 onTaskDispatched, the queue name must match the function id.
  // The worker function is exported as processTimeSeriesJobTask, so we
  // enqueue to that queue name rather than a custom one.
  TIME_SERIES_JOB = 'processTimeSeriesJobTask',
  // Background worker that performs a full time-series backfill enqueue
  // for all requested intervals. The queue name matches the function id.
  FULL_BACKFILL_RUN = 'processFullBackfillRunTask',
}
