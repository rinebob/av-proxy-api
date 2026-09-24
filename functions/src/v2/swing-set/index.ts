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
