import type { PickMaterializePayload } from './pick-materialize.task';
import type { TsBuildPayload } from './ts-build.task';

/**
 * Testable seam for the corpus-seed `onSeedSuccess` callback (Task #224).
 * The `onTaskDispatched` wrapper stays thin in corpus-seed.task.ts; this
 * core is side-effect-free and takes injected deps so no firebase-admin
 * init happens in jest.
 */
export interface CorpusSeedSuccessDeps {
  /**
   * Enqueue a delta-pick materialization task on the dedicated pick queue
   * (Task #224): the same handler as bulk materialization, bounded to this
   * single stored date. Picks read only the corpus chain — never the
   * contract time series — so the pick task runs in parallel with the
   * ts-build below and is independent of the ts-build lease check.
   */
  enqueuePick: (payload: PickMaterializePayload) => Promise<void>;
  /** Enqueue a contract time-series build task (Task #152). */
  enqueueTsBuild: (payload: TsBuildPayload) => Promise<void>;
  /**
   * Returns true only when a held ts-build lease's build actually covers
   * this date — lease-held alone must not drop work outside the holder's
   * range (post-range dates starved for weeks behind a bounded range
   * build). Ts-build-specific; never gates the pick enqueue.
   */
  isTsBuildDateCovered: (symbol: string, date: string) => Promise<boolean>;
  logger: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Fanout fired by the seed worker wherever the corpus object is confirmed
 * present (fresh write, gcs-hit, already-recorded). Failures heal on the
 * next seed dispatch for the date, which re-fires this callback.
 */
export async function handleCorpusSeedSuccess(
  symbol: string,
  date: string,
  deps: CorpusSeedSuccessDeps,
): Promise<void> {
  try {
    await deps.enqueuePick({ symbol, date });
    deps.logger('enqueued pick-materialize', { symbol, date });
  } catch (error) {
    // The pick task heals on the next seed dispatch; it must not starve the
    // established ts-build enqueue below.
    const message = error instanceof Error ? error.message : String(error);
    deps.logger('pick-materialize enqueue failed', { symbol, date, error: message });
  }

  if (await deps.isTsBuildDateCovered(symbol, date)) {
    deps.logger('skip ts-build enqueue — covered by in-flight range build', { symbol, date });
    return;
  }
  await deps.enqueueTsBuild({ symbol, date });
  deps.logger('enqueued ts-build', { symbol, date });
}
