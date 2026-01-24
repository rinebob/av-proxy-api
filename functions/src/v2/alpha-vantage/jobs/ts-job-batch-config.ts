/**
 * Batch size configuration for time-series job creation.
 *
 * These constants control how many symbols are processed in parallel when
 * creating or updating Firestore job documents and enqueueing Cloud Tasks.
 *
 * - TS_SCHEDULER_BATCH_SIZE controls the batching used by the scheduled
 *   POST runs in `runTimeSeriesJobsForEndpoint` (normal daily pipeline).
 * - TS_FULLBACKFILL_BATCH_SIZE controls the batching used by the
 *   admin-only full backfill HTTP entrypoint
 *   (`enqueueFullBackfillJobsForEndpoint`).
 *
 * Having separate constants allows us to tune operational behavior for
 * routine scheduler traffic versus heavy, operator-driven backfills
 * independently, even if they currently share the same numeric value.
 */

/**
 * Maximum number of symbols processed concurrently in the normal
 * scheduler-driven pipeline per batch.
 */
export const TS_SCHEDULER_BATCH_SIZE = 10;

/**
 * Batch size for admin-only full backfill time-series job runs.
 * Larger batches are safe here because this path is operator-driven and
 * we want to aggressively enqueue jobs for one-time history rebuilds.
 */
export const TS_FULLBACKFILL_BATCH_SIZE = 50;
