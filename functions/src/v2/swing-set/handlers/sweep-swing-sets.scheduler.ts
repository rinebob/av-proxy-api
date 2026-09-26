/**
 * sweepSwingSets — daily scheduled swing-set maintenance (Task #127).
 *
 * Runs after the daily-adjusted post-close refresh + evening retry window
 * (see SWING_SET_SWEEP_SCHEDULE). Enumerates options-enabled symbols and
 * regenerates stale/missing swing sets; per-symbol failures are logged, not
 * fatal. Thin wrapper — all logic in swing-set-sweep.core.ts.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { admin } from '../../../firebase-admin-init';
import { SWING_SET_SWEEP_SCHEDULE } from '../../common/function-schedules';
import { DailyAdjustedReader } from '../services/daily-adjusted-reader.service';
import { SwingSetRepository } from '../services/swing-set.repository';
import { SwingSetGenerationService } from '../services/swing-set-generation.service';
import { fanoutPivotSeedsForSymbol } from '../../historical-options-corpus/services/pivot-seed-fanout';
import { runSwingSetSweep } from './swing-set-sweep.core';

export const sweepSwingSets = onSchedule(
  {
    schedule: SWING_SET_SWEEP_SCHEDULE,
    timeZone: 'America/Los_Angeles',
    timeoutSeconds: 540,
    memory: '512MiB',
    maxInstances: 1,
  },
  async () => {
    const db = admin.firestore();
    const repository = new SwingSetRepository(db);
    const report = await runSwingSetSweep(db, {
      repository,
      generation: new SwingSetGenerationService(new DailyAdjustedReader(db), repository, console),
      logger: console,
      onGenerated: fanoutPivotSeedsForSymbol,
    });
    console.log('[sweepSwingSets]', JSON.stringify(report));
  },
);
