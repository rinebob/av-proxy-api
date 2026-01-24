import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

import { enqueueFullBackfillJobsForEndpoint } from './av-time-series-refresh-manager';
import { betterLogger, type BetterLogPayload } from '../../utils/utils';

const taskLog = betterLogger('av.fullBackfill.task');

interface FullBackfillTaskPayload {
  marketDate?: string;
  symbols?: string[];
  // Target endpoint for this run. Each task invocation is responsible for a
  // single endpoint (DAILY, WEEKLY, or MONTHLY) to keep execution time
  // bounded and avoid long multi-endpoint controllers.
  endpoint: AlphaVantageEndpoint;
}

export const processFullBackfillRunTask = onTaskDispatched<FullBackfillTaskPayload>({
  retryConfig: {
    maxAttempts: 3,
    minBackoffSeconds: 30,
    maxBackoffSeconds: 300,
  },
  // Allow a generous but bounded window for a single-endpoint enqueue over
  // the full symbol universe. This avoids repeated 60s timeouts while keeping
  // each task focused on one endpoint.
  timeoutSeconds: 600,
  memory: '512MiB',
}, async (req) => {
  const data = (req.data || {}) as FullBackfillTaskPayload;

  const marketDate = data.marketDate;
  const symbols = Array.isArray(data.symbols) ? data.symbols : undefined;
  const endpoint = data.endpoint;

  if (!endpoint) {
    taskLog.error('fullbackfill.task.error missing_endpoint', {
      function: 'pFBRT',
      marketDate: marketDate || 'auto(et)',
      symbols: symbols || 'ALL',
    } as BetterLogPayload);
    return;
  }

  const baseLog: BetterLogPayload = {
    function: 'pFBRT',
    marketDate: marketDate || 'auto(et)',
    interval: 'n/a',
    endpoint: String(endpoint),
  } as BetterLogPayload;

  const symbolCount = symbols ? symbols.length : 0;

  taskLog.info(
    `fullbackfill.task.start mktDate=${marketDate || 'auto(et)'} endpoint=${String(endpoint)} symbols=${
      symbols ? symbolCount : 'ALL'
    }`,
    {
      ...baseLog,
      symbols: symbols || 'ALL',
      symbolCount,
    } as BetterLogPayload,
  );

  const result = await enqueueFullBackfillJobsForEndpoint({
    endpoint,
    marketDate,
    symbols,
  });

  const count = result?.symbolCount ?? 0;

  taskLog.info(
    `fullbackfill.task.complete mktDate=${marketDate || result?.marketDate || 'auto(et)'} ` +
      `endpoint=${String(endpoint)} symbols=${count}`,
    {
      ...baseLog,
      symbolCount: count,
      runId: result?.runId,
    } as BetterLogPayload,
  );
});
