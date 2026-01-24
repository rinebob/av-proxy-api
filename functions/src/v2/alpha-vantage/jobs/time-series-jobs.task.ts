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
      // IMPORTANT: Each job does 1 AV call. Keep maxDispatchesPerSecond <= 1.2
      // to stay under the 75 req/min AV limit with headroom while allowing
      // higher intra-job concurrency for Firestore writes.
      maxConcurrentDispatches: 20,
      maxDispatchesPerSecond: 1.0,
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
