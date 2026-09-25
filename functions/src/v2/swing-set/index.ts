export { SwingSetRepository } from './services/swing-set.repository';
export { DailyAdjustedReader } from './services/daily-adjusted-reader.service';
export { SwingSetGenerationService } from './services/swing-set-generation.service';
export type { DailyAdjustedReaderLike, LoggerLike } from './services/swing-set-generation.service';
export type { CurrentSwing, SwingSetGenerationResult } from './types';
// The side-effect-free core is exported here; the onTaskDispatched wrapper
// (generate-swing-sets.task.ts) loads firebase-admin-init — consumers must
// NOT import it directly unless they're a function entry point.
export {
  enqueueSwingSetGeneration,
  handleGenerateSwingSets,
  swingSetsAreFresh,
  GENERATE_SWING_SETS_TASK_QUEUE,
  SWING_SET_FRESHNESS_TTL_MS,
} from './handlers/generate-swing-sets.core';
export type { GenerateSwingSetsPayload } from './handlers/generate-swing-sets.core';
export { runSwingSetSweep } from './handlers/swing-set-sweep.core';
export type { SwingSetSweepResult, SweepDeps } from './handlers/swing-set-sweep.core';
// The onSchedule/onRequest wrappers (sweep-swing-sets.scheduler.ts,
// backfill-swing-sets.http.ts) load firebase-admin-init — same caution as
// generate-swing-sets.task.ts.
