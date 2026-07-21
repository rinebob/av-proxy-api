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
  // Intraday snapshot worker: processes a single symbol's PRE-phase snapshot.
  // Queue name matches the exported function id.
  INTRADAY_SNAPSHOT_JOB = 'processIntradaySnapshotJobTask',
  // Background worker that retries fetching Company Overview for a newly added
  // equity symbol after D/W/M time-series are ready. Queue name matches function id.
  FETCH_COMPANY_OVERVIEW_ONBOARDING = 'processCompanyOverviewOnboardingTask',
}
