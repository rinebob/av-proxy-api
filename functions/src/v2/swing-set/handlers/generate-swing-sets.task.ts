/**
 * generateSwingSetsTask — Cloud Task worker.
 *
 * Fires when `optionsEnabled` flips to true on a tracked symbol (wired in
 * setOptionsEnabledV2 — the governed toggle path; Thread #105 owns the
 * full flag lifecycle). Payload
 * `{ symbol }` → SwingSetGenerationService. All logic lives in
 * generate-swing-sets.core.ts (side-effect-free for tests); this file only
 * wires prod deps. Queue name must match the exported function id.
 */
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { admin } from '../../../firebase-admin-init';
import { DailyAdjustedReader } from '../services/daily-adjusted-reader.service';
import { SwingSetRepository } from '../services/swing-set.repository';
import { SwingSetGenerationService } from '../services/swing-set-generation.service';
import { fanoutPivotSeedsForSymbol } from '../../historical-options-corpus/services/pivot-seed-fanout';
import {
  handleGenerateSwingSets,
  type GenerateSwingSetsPayload,
} from './generate-swing-sets.core';

export const generateSwingSetsTask = onTaskDispatched<GenerateSwingSetsPayload>(
  {
    retryConfig: { maxAttempts: 3 },
    rateLimits: {
      maxConcurrentDispatches: 5,
      maxDispatchesPerSecond: 2,
    },
    memory: '512MiB',
    timeoutSeconds: 240,
  },
  async (req) => {
    const db = admin.firestore();
    const repository = new SwingSetRepository(db);
    await handleGenerateSwingSets(req.data, {
      repository,
      generation: new SwingSetGenerationService(new DailyAdjustedReader(db), repository, console),
      logger: console,
      onGenerated: fanoutPivotSeedsForSymbol,
    });
  },
);
