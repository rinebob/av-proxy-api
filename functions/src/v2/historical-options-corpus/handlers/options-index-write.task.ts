import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { db } from '../../../firebase-admin-init';
import { OptionsIndexWriter, type OptionsIndexWritePayload } from '../services/options-index.writer';

/**
 * Cloud Task worker that writes a batch of options file index docs to Firestore.
 *
 * Each task receives a payload with a phase ('delete' | 'expirations' | 'strikes' | 'metadata')
 * and writes docs individually to avoid Firestore batch transaction size limits.
 *
 * Triggered by the rebuild-options-index script via Cloud Tasks enqueueing.
 */
export const processOptionsIndexWriteTask = onTaskDispatched<OptionsIndexWritePayload>(
  {
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 300,
    },
    rateLimits: {
      maxConcurrentDispatches: 10,
      maxDispatchesPerSecond: 5,
    },
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req) => {
    const payload = req.data;
    const writer = new OptionsIndexWriter(db, (msg, meta) => {
      console.log(`[options-index-write] ${msg}`, meta ? JSON.stringify(meta) : '');
    });

    await writer.processWritePayload(payload);
  },
);
