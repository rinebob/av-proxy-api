import { onSchedule } from 'firebase-functions/v2/scheduler';

import { HISTORICAL_OPTIONS_NIGHTLY_SCHEDULE } from '../../common/function-schedules';
import { createNightlyCorpusService } from '../services/nightly-corpus.service';

export const refreshHistoricalOptionsCorpusNightly = onSchedule(
  {
    schedule: HISTORICAL_OPTIONS_NIGHTLY_SCHEDULE,
    timeZone: 'America/Los_Angeles',
    timeoutSeconds: 120,
    memory: '512MiB',
    maxInstances: 1,
  },
  async () => {
    const report = await createNightlyCorpusService().run();
    console.log('[historical-options-nightly]', report);
  },
);
