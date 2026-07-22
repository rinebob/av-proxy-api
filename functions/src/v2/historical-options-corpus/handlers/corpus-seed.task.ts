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
import type { CorpusSeedPayload } from '../types';

export const OPTIONS_CORPUS_SEED_TASK_QUEUE = 'processHistoricalOptionsCorpusSeedTask';

function getBucket() {
  const bucketName = process.env.OPTIONS_CORPUS_BUCKET;
  if (!bucketName) {
    throw new Error('OPTIONS_CORPUS_BUCKET environment variable is not configured');
  }
  return admin.storage().bucket(bucketName);
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
 * Cloud Task worker that seeds a single symbol+date into the QQQ/TQQQ
 * historical-options GCS corpus.
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

    await seedCorpusItem(payload, {
      retrieval: createRetrievalService(),
      gcs: new GcsCorpusAdapter(getBucket()),
      metadata: new CorpusMetadataService(),
      maxAttempts: MAX_CORPUS_SEED_ATTEMPTS,
      enqueueTask: async (nextPayload) => {
        const queue = getFunctions().taskQueue(OPTIONS_CORPUS_SEED_TASK_QUEUE);
        await queue.enqueue(nextPayload);
      },
      logger: (message, meta) => console.log(`[corpus-seed] ${message}`, meta ?? {}),
    });
  },
);
