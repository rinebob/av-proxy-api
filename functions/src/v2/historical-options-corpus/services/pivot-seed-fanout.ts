import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';

import {
  OPTIONS_CORPUS_RUNS_COLLECTION,
  OPTIONS_CORPUS_SEED_TASK_QUEUE,
  type CorpusRunDoc,
  type CorpusSeedPayload,
} from '../types';
import { CorpusMetadataService, type CorpusRunPlan } from './corpus-metadata.service';
import { GcsCorpusAdapter, type GcsCorpusObjectRef } from './gcs-corpus-adapter.service';
import {
  createPivotPlannerDeps,
  planPivotSeeds,
  type PivotPlannerDeps,
} from './pivot-work-planner';

export interface PivotSeedFanoutResult {
  /** Run id created for this fanout, or null when nothing needed dispatch. */
  runId: string | null;
  /** Work items from the pivot planner. */
  planned: number;
  /** Seed tasks dispatched (only dates not already covered in GCS). */
  enqueued: number;
  /** Superseded interim snapshots deleted (Task #154). */
  deleted: number;
}

export interface PivotSeedFanoutDeps {
  planner: PivotPlannerDeps;
  /**
   * Lists the symbol's stored corpus objects (`{date, kind}`) — the coverage
   * diff input and the superseded-interim scan (Task #154).
   */
  listObjects: (symbol: string) => Promise<GcsCorpusObjectRef[]>;
  /** Deletes one stored corpus object (interim supersede cleanup). */
  deleteObject: (symbol: string, date: string) => Promise<unknown>;
  createRunPlan: (plan: CorpusRunPlan) => Promise<void>;
  markRunStatus: (runId: string, status: CorpusRunDoc['status']) => Promise<void>;
  enqueueTask: (payload: CorpusSeedPayload) => Promise<unknown>;
  logger: { info(m: string): void; warn(m: string): void };
  /** Clock override for deterministic runIds in tests. */
  nowMs?: number;
}

/**
 * Tasks #153/#154 — coverage-aware pivot-seed fanout.
 *
 * Reads the symbol's corpus swing-set doc via the pivot planner, diffs the
 * planned dates against the GCS corpus, and:
 *  - enqueues one Stage-1 seed task per MISSING date (payload carries the
 *    planner's kind so interim snapshots are identifiable downstream);
 *  - deletes superseded interim snapshots — objects stamped `kind=interim`
 *    whose date is no longer in the planned set. Confirmed pivots never leave
 *    `pivotDates` (the array is unbounded), so a planned-set exit can only be
 *    a superseded interim; objects without a kind stamp (nightly/pilot
 *    provenance) are never touched.
 *
 * Coverage-skipped items produce no task at all (previously the worker's
 * gcs-hit skip absorbed the dupe — now nothing is dispatched). Each
 * invocation still mints its own runId so runs stay per-event trails.
 */
export async function fanoutPivotSeeds(
  symbol: string,
  deps: PivotSeedFanoutDeps,
): Promise<PivotSeedFanoutResult> {
  const upper = symbol.trim().toUpperCase();
  const items = await planPivotSeeds(upper, deps.planner);
  if (items.length === 0) {
    // No corpus doc (or empty plan): early-return BEFORE the object scan.
    // Planned-set-empty would classify every interim object as superseded —
    // deleting on an absent doc is unsafe (the doc may be transiently missing
    // while the corpus objects are still wanted).
    deps.logger.info(`pivot-seed-fanout: ${upper} — no corpus swing doc (or no pivot dates); nothing to seed`);
    return { runId: null, planned: 0, enqueued: 0, deleted: 0 };
  }

  const objects = await deps.listObjects(upper);
  const covered = new Set(objects.map((o) => o.date));
  const plannedDates = new Set(items.map((i) => i.date));

  const missing = items.filter((i) => !covered.has(i.date));
  const superseded = objects.filter((o) => o.kind === 'interim' && !plannedDates.has(o.date));

  let deleted = 0;
  for (const stale of superseded) {
    try {
      await deps.deleteObject(upper, stale.date);
      deleted++;
      deps.logger.info(`pivot-seed-fanout: ${upper} deleted superseded interim ${stale.date}`);
    } catch (e) {
      deps.logger.warn(`pivot-seed-fanout: ${upper} interim delete failed for ${stale.date} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (missing.length === 0) {
    deps.logger.info(`pivot-seed-fanout: ${upper} — ${items.length} planned date(s) already covered; deleted=${deleted}`);
    return { runId: null, planned: items.length, enqueued: 0, deleted };
  }

  const dates = missing.map((i) => i.date).sort();
  const runId = `${OPTIONS_CORPUS_RUNS_COLLECTION}-${upper}-seed-${deps.nowMs ?? Date.now()}`;
  const plan: CorpusRunPlan = {
    runId,
    symbols: [upper],
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    totalItems: missing.length,
    items: missing.map((i) => ({ symbol: i.symbol, date: i.date })),
    dryRun: false,
    pilot: false,
  };
  await deps.createRunPlan(plan);
  await deps.markRunStatus(runId, 'in_progress');

  // Chunked parallel dispatch — a volatile symbol can have several hundred
  // pivot dates; serial enqueues would blow the enable callable's timeout.
  const CHUNK = 20;
  for (let i = 0; i < missing.length; i += CHUNK) {
    await Promise.all(
      missing.slice(i, i + CHUNK).map((item) =>
        deps.enqueueTask({ runId, symbol: item.symbol, date: item.date, attempt: 1, kind: item.kind }),
      ),
    );
  }

  deps.logger.info(`pivot-seed-fanout: ${upper} — run ${runId}, enqueued ${missing.length} seed task(s), deleted=${deleted}`);
  return { runId, planned: items.length, enqueued: missing.length, deleted };
}

/**
 * Production deps: pivot planner over `options-swing-sets`, corpus-run
 * metadata, GCS listing/delete, and the real Stage-1 seed task queue.
 */
export function createPivotSeedFanoutDeps(): PivotSeedFanoutDeps {
  const metadata = new CorpusMetadataService();
  const gcs = new GcsCorpusAdapter(
    getStorage().bucket(process.env.OPTIONS_CORPUS_BUCKET),
  );
  return {
    planner: createPivotPlannerDeps(),
    listObjects: (symbol) => gcs.listItems(symbol),
    deleteObject: (symbol, date) => gcs.deleteItem(symbol, date),
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
