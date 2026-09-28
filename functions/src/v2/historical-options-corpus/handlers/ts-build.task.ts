import { getFunctions } from 'firebase-admin/functions';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { db } from '../../../firebase-admin-init';
import { createTimeSeriesBuilderService } from '../services/time-series-builder.service';
import { createOptionsEnabledChecker } from '../services/options-enabled-gate';
import { acquireTsBuildLease, releaseTsBuildLease } from '../services/ts-build-lease.service';
import { handleTsBuildTask } from './ts-build.core';

/**
 * Payload for a symbol's time-series build task. Either `date` (single-day)
 * or a `startDate`/`endDate` range. Range tasks self-continue: on the
 * internal time budget the handler re-enqueues the unprocessed tail.
 */
export interface TsBuildPayload {
  symbol: string;
  date?: string;
  startDate?: string;
  endDate?: string;
}

export const OPTIONS_TS_BUILD_TASK_QUEUE = 'processHistoricalOptionsTsBuildTask';

/**
 * Cloud Task worker that builds per-contract time-series JSONL files for a
 * symbol+date (or date range) from the raw GCS corpus.
 *
 * Triggered by the corpus seed worker after a successful seed, and by the
 * admin trigger for whole-symbol range builds. The builder is idempotent:
 * it reads existing JSONL, merges new observations, deduplicates by date,
 * and skips writes whose dates are already covered.
 *
 * Concurrency is safe above 1 because a per-symbol Firestore lease
 * serializes tasks touching the same contract files; contenders defer
 * and re-enqueue instead of racing.
 *
 * Retry policy: 3 attempts with exponential backoff. Safe to retry because
 * the builder is idempotent.
 */
export const processHistoricalOptionsTsBuildTask = onTaskDispatched<TsBuildPayload>(
  {
    retryConfig: { maxAttempts: 3 },
    rateLimits: {
      maxConcurrentDispatches: 10,
      maxDispatchesPerSecond: 5.0,
    },
    memory: '4GiB',
    timeoutSeconds: 1200,
  },
  async (req) => {
    const service = createTimeSeriesBuilderService();
    const queue = getFunctions().taskQueue<TsBuildPayload>(OPTIONS_TS_BUILD_TASK_QUEUE);
    await handleTsBuildTask(req.data, {
      isOptionsEnabled: createOptionsEnabledChecker(),
      buildSymbol: (symbol, startDate, endDate, options) =>
        service.buildSymbol(symbol, startDate, endDate, undefined, undefined, options),
      acquireLease: (symbol) => acquireTsBuildLease(db, symbol),
      releaseLease: (symbol) => releaseTsBuildLease(db, symbol),
      enqueueTask: async (payload, delaySeconds) => {
        await queue.enqueue(
          payload,
          delaySeconds ? { scheduleDelaySeconds: delaySeconds } : undefined,
        );
      },
      logger: (m, meta) => console.log(`[ts-build-task] ${m}`, meta ?? {}),
      warn: (m, meta) => console.warn(`[ts-build-task] ${m}`, meta ?? {}),
      error: (m, meta) => console.error(`[ts-build-task] ${m}`, meta ?? {}),
    });
  },
);
