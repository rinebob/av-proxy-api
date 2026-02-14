import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { processTimeSeriesJobInternal, type ProcessTimeSeriesJobPayload } from './time-series-jobs.worker';
import { CLOUD_TASKS_RATE_LIMITS, CLOUD_TASKS_RETRY_CONFIG, JOB_FUNCTION_MEMORY } from './job-config';

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
    retryConfig: CLOUD_TASKS_RETRY_CONFIG,
    rateLimits: CLOUD_TASKS_RATE_LIMITS,
    memory: JOB_FUNCTION_MEMORY,
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
