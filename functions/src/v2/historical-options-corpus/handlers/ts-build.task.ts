import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { createTimeSeriesBuilderService } from '../services/time-series-builder.service';
import { createOptionsEnabledChecker } from '../services/options-enabled-gate';
import { handleTsBuildTask } from './ts-build.core';

/**
 * Payload for a single-symbol, single-date time-series build task.
 */
export interface TsBuildPayload {
  symbol: string;
  date: string;
}

export const OPTIONS_TS_BUILD_TASK_QUEUE = 'processHistoricalOptionsTsBuildTask';

/**
 * Cloud Task worker that builds per-contract time-series JSONL files for a
 * single symbol+date from the raw GCS corpus.
 *
 * Triggered by the corpus seed worker after a successful seed. The builder is
 * idempotent: it reads existing JSONL, merges the new date's observation,
 * deduplicates by date, and writes back.
 *
 * Retry policy: 3 attempts with exponential backoff. Safe to retry because
 * the builder is idempotent.
 */
export const processHistoricalOptionsTsBuildTask = onTaskDispatched<TsBuildPayload>(
  {
    retryConfig: { maxAttempts: 3 },
    rateLimits: {
      maxConcurrentDispatches: 1,
      maxDispatchesPerSecond: 1.0,
    },
    memory: '4GiB',
    timeoutSeconds: 1200,
  },
  async (req) => {
    const service = createTimeSeriesBuilderService();
    await handleTsBuildTask(req.data, {
      isOptionsEnabled: createOptionsEnabledChecker(),
      buildSymbol: (symbol, startDate, endDate) => service.buildSymbol(symbol, startDate, endDate),
      logger: (m, meta) => console.log(`[ts-build-task] ${m}`, meta ?? {}),
      warn: (m, meta) => console.warn(`[ts-build-task] ${m}`, meta ?? {}),
      error: (m, meta) => console.error(`[ts-build-task] ${m}`, meta ?? {}),
    });
  },
);
