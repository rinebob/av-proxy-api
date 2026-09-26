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
    const report = await runCorpusSweep({
      listOptionsEnabledSymbols,
      reconcile: (symbol) => fanoutPivotSeedsForSymbol(symbol),
      logger: console,
    });
    console.log('[sweepHistoricalOptionsCorpus]', JSON.stringify(report));
  },
);
