/**
 * sweepHistoricalOptionsCorpus — scheduled corpus reconcile (Task #154).
 *
 * Runs after the swing-set sweep so regenerated corpus docs are already in
 * place. For each options-enabled symbol: seed planned pivot dates missing
 * from GCS and delete superseded interim snapshots. Per-symbol failures are
 * logged, not fatal. Thin wrapper — logic lives in corpus-sweep.core.ts.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { CORPUS_SWEEP_SCHEDULE } from '../../common/function-schedules';
import { runCorpusSweep } from '../services/corpus-sweep.core';
import { createNightlyCorpusService } from '../services/nightly-corpus.service';
import { listOptionsEnabledSymbols } from '../services/options-enabled-gate';
import { fanoutPivotSeedsForSymbol } from '../services/pivot-seed-fanout';

export const sweepHistoricalOptionsCorpus = onSchedule(
  {
    schedule: CORPUS_SWEEP_SCHEDULE,
    timeZone: 'America/Los_Angeles',
    timeoutSeconds: 540,
    memory: '512MiB',
    maxInstances: 1,
  },
  async () => {
    // Nightly-miss heal: the 19:00 nightly run is the only path that seeds
    // today's chain for every enabled symbol (pivot-independent). Re-running
    // it here is idempotent — covered items are skipped — so a failed nightly
    // is repaired before the pivot reconcile pass below.
    try {
      const nightly = await createNightlyCorpusService().run();
      console.log('[sweepHistoricalOptionsCorpus] nightly-heal', JSON.stringify(nightly));
    } catch (e) {
      console.warn(`[sweepHistoricalOptionsCorpus] nightly-heal failed — ${e instanceof Error ? e.message : String(e)}`);
    }

    const report = await runCorpusSweep({
      listOptionsEnabledSymbols,
      reconcile: (symbol) => fanoutPivotSeedsForSymbol(symbol),
      logger: console,
    });
    console.log('[sweepHistoricalOptionsCorpus]', JSON.stringify(report));
  },
);
