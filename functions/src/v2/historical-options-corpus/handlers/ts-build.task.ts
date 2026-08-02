import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { createTimeSeriesBuilderService } from '../services/time-series-builder.service';

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
    const { symbol, date } = req.data;

    console.log('[ts-build-task] start', { symbol, date });

    const service = createTimeSeriesBuilderService();

    try {
      const report = await service.buildSymbol(symbol, date, date);

      console.log('[ts-build-task] done', {
        symbol: report.symbol,
        foundDates: report.foundDates,
        missingDates: report.missingDates,
        processedContracts: report.processedContracts,
        failedContracts: report.failedContracts,
      });

      if (report.missingDates > 0) {
        console.warn('[ts-build-task] missing dates — corpus may not be ready', {
          symbol,
          date,
          missingDates: report.missingDates,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ts-build-task] failed', { symbol, date, error: message });
      throw error;
    }
  },
);
