import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { processTimeSeriesJobInternal, type ProcessTimeSeriesJobPayload } from './time-series-jobs.worker';

const taskLogger = betterLogger('tSJ.t');

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
    const payload = req.data as ProcessTimeSeriesJobPayload;

    const baseLogPayload: BetterLogPayload = {
      function: 'pSJT',
      symbol: payload.symbol,
      marketDate: payload.marketDate,
      interval: 'n/a',
      endpoint: String(payload.endpoint),
    };

    taskLogger.info('job.task.start', baseLogPayload);
    await processTimeSeriesJobInternal(payload);
    taskLogger.info('job.task.complete', baseLogPayload);
  },
);
