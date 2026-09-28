import axios from 'axios';
import { getFunctions } from 'firebase-admin/functions';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { ApiProvider, DATA_PROVIDERS } from '@shared/core';

import { getAlphaVantageApiKey } from '../../utils/utils';
import { admin } from '../../../firebase-admin-init';
import { getDefaultAvThrottle } from '../services/av-throttle.service';
import { CorpusMetadataService } from '../services/corpus-metadata.service';
import { GcsCorpusAdapter } from '../services/gcs-corpus-adapter.service';
import { HistoricalOptionsRetrievalService } from '../services/historical-options-retrieval.service';
import { MAX_CORPUS_SEED_ATTEMPTS, seedCorpusItem } from '../services/corpus-seed.worker';
import { createOptionsEnabledChecker } from '../services/options-enabled-gate';
import { isTsBuildLeaseHeld } from '../services/ts-build-lease.service';
import { MetricBuildService } from '../../symbol-metrics/build.service';
import { SymbolMetricsRepository } from '../../symbol-metrics/services/symbol-metrics.repository';
import { DailyAdjustedReader } from '../../swing-set/services/daily-adjusted-reader.service';
import { optionsCorpusBucket } from '../types';
import { OPTIONS_CORPUS_SEED_TASK_QUEUE, type CorpusSeedPayload } from '../types';
import { OPTIONS_TS_BUILD_TASK_QUEUE, type TsBuildPayload } from './ts-build.task';

export { OPTIONS_CORPUS_SEED_TASK_QUEUE };

function getBucket() {
  return admin.storage().bucket(optionsCorpusBucket());
}

function createRetrievalService(): HistoricalOptionsRetrievalService {
  const provider = DATA_PROVIDERS[ApiProvider.ALPHA_VANTAGE];
  return new HistoricalOptionsRetrievalService({
    axiosInstance: axios.create({
      baseURL: provider.baseUrl,
      timeout: provider.defaultTimeoutMs,
    }),
    throttle: getDefaultAvThrottle(),
    apiKey: getAlphaVantageApiKey(),
    baseUrl: provider.baseUrl,
  });
}

/**
 * Cloud Task worker that seeds a single symbol+date into the
 * historical-options GCS corpus (options-enabled symbols only).
 *
 * Exported as `processHistoricalOptionsCorpusSeedTask`; re-exported from
 * `functions/src/index.ts` for deployment.
 */
export const processHistoricalOptionsCorpusSeedTask = onTaskDispatched<CorpusSeedPayload>(
  {
    retryConfig: { maxAttempts: 1 },
    rateLimits: {
      maxConcurrentDispatches: 1,
      maxDispatchesPerSecond: 1.0,
    },
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: ['ALPHAVANTAGE_API_KEY'],
  },
  async (req) => {
    const payload = req.data;

    const gcs = new GcsCorpusAdapter(getBucket());
    const db = admin.firestore();
    await seedCorpusItem(payload, {
      isOptionsEnabled: createOptionsEnabledChecker(),
      retrieval: createRetrievalService(),
      gcs,
      metadata: new CorpusMetadataService(),
      maxAttempts: MAX_CORPUS_SEED_ATTEMPTS,
      enqueueTask: async (nextPayload) => {
        const queue = getFunctions().taskQueue(OPTIONS_CORPUS_SEED_TASK_QUEUE);
        await queue.enqueue(nextPayload);
      },
      logger: (message, meta) => console.log(`[corpus-seed] ${message}`, meta ?? {}),
      onSeedSuccess: async (symbol, date) => {
        // A held lease means a range build owns this symbol and already covers
        // the date — enqueuing would just bounce on the lease every 60s.
        if (await isTsBuildLeaseHeld(db, symbol)) {
          console.log('[corpus-seed] skip ts-build enqueue — range build holds lease', { symbol, date });
          return;
        }
        const tsQueue = getFunctions().taskQueue<TsBuildPayload>(OPTIONS_TS_BUILD_TASK_QUEUE);
        await tsQueue.enqueue({ symbol, date });
        console.log('[corpus-seed] enqueued ts-build', { symbol, date });
      },
      // Task #171 — compute symbol metrics wherever the corpus object is
      // confirmed present (fresh write or alreadyExists). Errors are
      // warn-swallowed inside the worker.
      metrics: new MetricBuildService({
        gcs,
        bars: new DailyAdjustedReader(db),
        repo: new SymbolMetricsRepository(db),
      }),
    });
  },
);
