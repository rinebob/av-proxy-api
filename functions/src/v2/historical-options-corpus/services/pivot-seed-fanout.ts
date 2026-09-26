import { getFunctions } from 'firebase-admin/functions';

import {
  OPTIONS_CORPUS_RUNS_COLLECTION,
  type CorpusRunDoc,
  type CorpusSeedPayload,
} from '../types';
import { OPTIONS_CORPUS_SEED_TASK_QUEUE } from '../types';
import { CorpusMetadataService, type CorpusRunPlan } from './corpus-metadata.service';
import {
  createPivotPlannerDeps,
  planPivotSeeds,
  type PivotPlannerDeps,
} from './pivot-work-planner';

export interface PivotSeedFanoutResult {
  /** Run id created for this fanout, or null when the symbol has no corpus doc. */
  runId: string | null;
  /** Work items from the pivot planner. */
  planned: number;
  /** Seed tasks dispatched. */
  enqueued: number;
}

export interface PivotSeedFanoutDeps {
  planner: PivotPlannerDeps;
  createRunPlan: (plan: CorpusRunPlan) => Promise<void>;
  markRunStatus: (runId: string, status: CorpusRunDoc['status']) => Promise<void>;
  enqueueTask: (payload: CorpusSeedPayload) => Promise<unknown>;
  logger: { info(m: string): void; warn(m: string): void };
  /** Clock override for deterministic runIds in tests. */
  nowMs?: number;
}

/**
 * Task #153 — pivot-seed fanout.
 *
 * Reads the symbol's corpus swing-set doc via the pivot planner, creates a
 * corpus run covering every planned (symbol, date), and dispatches one
 * Stage-1 seed task per item. No runId doc reuse — each fanout is its own
 * run so repeated invocations (re-enable, regeneration) leave a per-event
 * trail and never clobber counters; the seed worker's GCS/already-recorded
 * skips make re-enqueues cheap (zero AV calls).
 */
export async function fanoutPivotSeeds(
  symbol: string,
  deps: PivotSeedFanoutDeps,
): Promise<PivotSeedFanoutResult> {
  const upper = symbol.trim().toUpperCase();
  const items = await planPivotSeeds(upper, deps.planner);
  if (items.length === 0) {
    deps.logger.info(`pivot-seed-fanout: ${upper} — no corpus swing doc (or no pivot dates); nothing to seed`);
    return { runId: null, planned: 0, enqueued: 0 };
  }

  const dates = items.map((i) => i.date).sort();
  const runId = `${OPTIONS_CORPUS_RUNS_COLLECTION}-${upper}-seed-${deps.nowMs ?? Date.now()}`;
  const plan: CorpusRunPlan = {
    runId,
    symbols: [upper],
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    totalItems: items.length,
    items: items.map((i) => ({ symbol: i.symbol, date: i.date })),
    dryRun: false,
    pilot: false,
  };
  await deps.createRunPlan(plan);
  await deps.markRunStatus(runId, 'in_progress');

  // Chunked parallel dispatch — a volatile symbol can have several hundred
  // pivot dates; serial enqueues would blow the enable callable's timeout.
  const CHUNK = 20;
  for (let i = 0; i < items.length; i += CHUNK) {
    await Promise.all(
      items.slice(i, i + CHUNK).map((item) =>
        deps.enqueueTask({ runId, symbol: item.symbol, date: item.date, attempt: 1 }),
      ),
    );
  }

  deps.logger.info(`pivot-seed-fanout: ${upper} — run ${runId}, enqueued ${items.length} seed task(s)`);
  return { runId, planned: items.length, enqueued: items.length };
}

/**
 * Production deps: pivot planner over `options-swing-sets`, corpus-run
 * metadata, and the real Stage-1 seed task queue.
 */
export function createPivotSeedFanoutDeps(): PivotSeedFanoutDeps {
  const metadata = new CorpusMetadataService();
  return {
    planner: createPivotPlannerDeps(),
    createRunPlan: (plan) => metadata.createRunPlan(plan),
    markRunStatus: (runId, status) => metadata.markRunStatus(runId, status),
    enqueueTask: (payload) =>
      getFunctions().taskQueue<CorpusSeedPayload>(OPTIONS_CORPUS_SEED_TASK_QUEUE).enqueue(payload),
    logger: console,
  };
}

/** Convenience wrapper used by prod call sites (enable toggle, generation). */
export async function fanoutPivotSeedsForSymbol(symbol: string): Promise<PivotSeedFanoutResult> {
  return fanoutPivotSeeds(symbol, createPivotSeedFanoutDeps());
}
