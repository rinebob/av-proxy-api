import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import {
  processIntradaySnapshotJobInternal,
  type IntradaySnapshotJobPayload,
} from './intraday-snapshot-jobs.worker';
import { CLOUD_TASKS_RETRY_CONFIG, JOB_FUNCTION_MEMORY } from './job-config';

const taskLogger = betterLogger('iS.Tsk');

/**
 * Cloud Task entry point for processing a single intraday snapshot job.
 *
 * Rate limits are kept identical to the POST time-series queue (1.0/sec,
 * 20 concurrent) so the intraday pipeline respects the same AV API budget.
 * Tune independently of processTimeSeriesJobTask if needed.
 */
export const processIntradaySnapshotJobTask = onTaskDispatched<IntradaySnapshotJobPayload>(
  {
    retryConfig: CLOUD_TASKS_RETRY_CONFIG,
    rateLimits: {
      maxDispatchesPerSecond: 1.0,
      maxConcurrentDispatches: 20,
    },
    memory: JOB_FUNCTION_MEMORY,
    secrets: ['ALPHAVANTAGE_API_KEY'],
  },
  async (req) => {
    const payload = req.data as IntradaySnapshotJobPayload;

    const baseLogPayload: BetterLogPayload = {
      function: 'pISJT',
      symbol: payload.symbol,
      marketDate: payload.marketDate,
      interval: 'intraday',
      endpoint: 'TIME_SERIES_INTRADAY',
    };

    taskLogger.info('intraday.task.start', baseLogPayload);
    await processIntradaySnapshotJobInternal(payload);
    taskLogger.info('intraday.task.complete', baseLogPayload);
  },
);
