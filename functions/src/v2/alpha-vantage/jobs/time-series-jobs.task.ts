import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { createLogger } from '../../utils/utils';
import { processTimeSeriesJobInternal, type ProcessTimeSeriesJobPayload } from './time-series-jobs.worker';

const log = createLogger('av.ts.jobs.task');

/**
 * Cloud Task entry point for processing a single Alpha Vantage time-series job.
 *
 * This is the production-ready worker wrapper that Cloud Tasks will invoke.
 * It delegates all core logic to processTimeSeriesJobInternal, which currently
 * applies an emulator-only safety guard while the pipeline is under active
 * development.
 */
export const processTimeSeriesJobTask = onTaskDispatched<ProcessTimeSeriesJobPayload>(
  {
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 300,
    },
    rateLimits: {
      // Limit to a single concurrent execution. Combined with an
      // explicit 1s delay in the worker before calling Alpha Vantage,
      // this ensures we never exceed ~60 req/min across all jobs,
      // independent of Cloud Tasks' internal dispatch heuristics.
      maxConcurrentDispatches: 1,
    },
    memory: '512MiB',
    secrets: ['ALPHAVANTAGE_API_KEY'],
  },
  async (req) => {
    const payload = req.data;
    log.info('job.task.start', payload as unknown as Record<string, unknown>);
    await processTimeSeriesJobInternal(payload);
    log.info('job.task.complete', payload as unknown as Record<string, unknown>);
  },
);
