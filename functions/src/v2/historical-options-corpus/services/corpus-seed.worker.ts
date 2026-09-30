import { AlphaVantageUpstreamError, AlphaVantageUpstreamErrorCategory } from '../../alpha-vantage/utils';
import { OPTIONS_CORPUS_FLOOR_DATE, type CorpusItemKey, type CorpusSeedPayload } from '../types';
import type { MetricBuildResult } from '../../symbol-metrics/build.service';
import type { RankBuildResult } from '../../symbol-metrics/rank-build.service';
import type { CorpusMetadataService } from './corpus-metadata.service';
import type { GcsCorpusAdapter } from './gcs-corpus-adapter.service';
import type { HistoricalOptionsRetrievalService } from './historical-options-retrieval.service';

export const MAX_CORPUS_SEED_ATTEMPTS = 3;

export type SeedWorkerResult =
  | { status: 'skipped'; reason: string }
  | { status: 'stored'; gcsPath: string; bytes: number; sha256: string; apiCalls: number }
  | { status: 'retry_enqueued'; nextAttempt: number }
  | { status: 'permanent_failure'; error: string };

export interface SeedWorkerDependencies {
  /**
   * Curation gate (Task #150): resolves true only when the symbol's
   * tracked-symbol doc has `optionsEnabled === true`. Checked first so a
   * disabled or unknown symbol consumes zero AV calls and writes no metadata.
   */
  isOptionsEnabled: (symbol: string) => Promise<boolean>;
  retrieval: HistoricalOptionsRetrievalService;
  gcs: GcsCorpusAdapter;
  metadata: CorpusMetadataService;
  enqueueTask: (payload: CorpusSeedPayload) => Promise<void>;
  maxAttempts: number;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  /**
   * Optional callback invoked after a corpus item is confirmed stored (or was
   * already present in GCS). Used to piggyback a time-series build task enqueue
   * without blocking the seed result. Errors are logged and swallowed.
   */
  onSeedSuccess?: (symbol: string, date: string) => Promise<void>;
  /**
   * Optional symbol-metrics build seam (Task #171): invoked wherever the
   * corpus object is confirmed present — fresh write AND alreadyExists hits —
   * so re-seeding a date recomputes its metrics. The service reads the chain
   * back via gcs.readItem itself (the gcs-hit path skips the AV fetch, so the
   * chain isn't in memory here). Errors are warn-logged and swallowed — a
   * metric failure never retries or fails the seed.
   */
  metrics?: { computeForDate(symbol: string, date: string): Promise<MetricBuildResult> };
  /**
   * Optional second-order rank pass (Task #188, Thread #163): runs AFTER the
   * metrics pass wherever the corpus object is confirmed present — it reads
   * the symbol's trailing IV30 rows and merge-writes rank fields onto the
   * same day entry plus iv-rank-latest when the date is newest. Warn-swallowed
   * like the metrics seam; a rank failure never retries or fails the seed.
   */
  rankMetrics?: { computeRankForDate(symbol: string, date: string): Promise<RankBuildResult> };
}

/**
 * Idempotent seed worker for a single symbol+date corpus item.
 *
 * 1. Checks GCS for an existing, valid item; if found, skips without an AV call.
 * 2. Otherwise fetches from Alpha Vantage using the shared throttle.
 * 3. Writes a versioned, gzipped, immutable object to GCS.
 * 4. Records durable metadata in Firestore.
 * 5. On failure, either re-enqueues a retry or marks the item as permanently failed.
 */
export async function seedCorpusItem(
  payload: CorpusSeedPayload,
  deps: SeedWorkerDependencies,
): Promise<SeedWorkerResult> {
  const { runId, symbol, date, attempt } = payload;
  const key = itemKey({ symbol, date });

  deps.logger('seed.start', { runId, symbol, date, attempt });

  if (date < OPTIONS_CORPUS_FLOOR_DATE) {
    deps.logger('seed.skip.pre-floor', { runId, symbol, date });
    // Terminal 'skipped' status + completion increment — same pattern as the
    // options-disabled gate — so planned runs don't wedge on pending items.
    await deps.metadata.setItemFailure(runId, key, 'pre-floor', 'skipped');
    await deps.metadata.incrementCompleted(runId, 0);
    return { status: 'skipped', reason: 'pre-floor' };
  }

  if (!(await deps.isOptionsEnabled(symbol))) {
    deps.logger('seed.skip.options-disabled', { runId, symbol, date });
    // Terminal status + completion increment so planned runs can't wedge
    // with permanently 'pending' items when a symbol is disabled mid-run
    // (or a stale/manual task arrives for a disabled symbol).
    await deps.metadata.setItemFailure(runId, key, 'options-disabled', 'skipped');
    await deps.metadata.incrementCompleted(runId, 0);
    return { status: 'skipped', reason: 'options-disabled' };
  }

  const existing = await deps.metadata.getItemDoc(runId, key);
  if (existing?.status === 'success') {
    deps.logger('seed.skip.already-recorded', { runId, symbol, date });
    // The object is confirmed present — a failed ts-build enqueue or metrics
    // compute on the earlier dispatch would otherwise never heal within this
    // run. Both callbacks are idempotent.
    await notifySeedSuccess(deps, symbol, date);
    await computeSymbolMetrics(deps, symbol, date);
    return { status: 'skipped', reason: 'already-recorded' };
  }

  // Idempotency: if a valid object already exists in GCS, do not call AV again.
  const storedMetadata = await deps.gcs.getMetadata(symbol, date);
  if (storedMetadata) {
    await deps.metadata.setItemSuccess(runId, key, {
      gcsPath: storedMetadata.gcsPath,
      sha256: storedMetadata.sha256,
      bytes: storedMetadata.bytes,
      generation: storedMetadata.generation,
      apiCalls: 0,
    });
    await deps.metadata.incrementCompleted(runId, 0);
    deps.logger('seed.skip.gcs-hit', { runId, symbol, date });
    // # Reason: notifySeedSuccess is intentionally called here even though the
    // corpus item already existed. The ts-build builder is idempotent (reads
    // existing JSONL, merges, deduplicates by date), so a redundant enqueue
    // produces the same output as a single run. This avoids a separate GCS
    // check for the time-series file.
    await notifySeedSuccess(deps, symbol, date);
    await computeSymbolMetrics(deps, symbol, date);
    return { status: 'skipped', reason: 'gcs-hit' };
  }

  await deps.metadata.touchItem(runId, key, 'in_progress');

  try {
    // Throttling is owned by the retrieval service; the worker does not add a
    // second wait so a shared throttle instance paces the AV request rate.
    const { response, analysis } = await deps.retrieval.fetch({ symbol, date });
    const writeResult = await deps.gcs.writeItem(symbol, date, response, analysis, payload.kind);

    await deps.metadata.setItemSuccess(runId, key, {
      gcsPath: writeResult.gcsPath,
      sha256: writeResult.sha256,
      bytes: writeResult.bytes,
      generation: writeResult.generation,
      apiCalls: 1,
    });
    await deps.metadata.incrementCompleted(runId, 1);

    deps.logger('seed.stored', {
      runId,
      symbol,
      date,
      gcsPath: writeResult.gcsPath,
      bytes: writeResult.bytes,
      alreadyExists: writeResult.alreadyExists,
    });

    await notifySeedSuccess(deps, symbol, date);
    await computeSymbolMetrics(deps, symbol, date);

    return {
      status: 'stored',
      gcsPath: writeResult.gcsPath,
      bytes: writeResult.bytes,
      sha256: writeResult.sha256,
      apiCalls: 1,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger('seed.error', { runId, symbol, date, attempt, error: message });

    const retryable = isCorpusSeedRetryable(error);

    if (!retryable || attempt >= deps.maxAttempts) {
      await deps.metadata.setItemFailure(runId, key, message, 'permanent_failure');
      await deps.metadata.incrementFailed(runId);
      return { status: 'permanent_failure', error: message };
    }

    const nextAttempt = attempt + 1;
    await deps.metadata.setItemFailure(runId, key, message, 'failure');
    await deps.enqueueTask({ runId, symbol, date, attempt: nextAttempt, kind: payload.kind });
    return { status: 'retry_enqueued', nextAttempt };
  }
}

/**
 * Fires the onSeedSuccess callback if provided. Errors are logged and swallowed
 * so that a failed time-series enqueue never causes the seed task to report failure.
 */
async function notifySeedSuccess(deps: SeedWorkerDependencies, symbol: string, date: string): Promise<void> {
  if (!deps.onSeedSuccess) return;
  try {
    await deps.onSeedSuccess(symbol, date);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger('seed.onSeedSuccess.error', { symbol, date, error: message });
  }
}

/**
 * Runs the symbol-metrics compute for the confirmed-present date. Errors are
 * logged and swallowed so a metric failure never causes the seed to retry or
 * report failure (metrics are healable on the next seed of the same date).
 */
async function computeSymbolMetrics(deps: SeedWorkerDependencies, symbol: string, date: string): Promise<void> {
  if (!deps.metrics && !deps.rankMetrics) return;
  // Re-check enabled — a mid-flight disable (iv-rank-latest delete) must not
  // be followed by a metric/rank write that re-creates the screener doc;
  // a re-disable is a no-op so nothing else would clean it up.
  if (!(await deps.isOptionsEnabled(symbol))) {
    deps.logger('seed.metrics.skip.disabled', { symbol, date });
    return;
  }
  if (deps.metrics) {
    try {
      // Surface the outcome — a systematically missing close would otherwise
      // leave deterministic skips completely invisible.
      const result = await deps.metrics.computeForDate(symbol, date);
      deps.logger(result.written ? 'seed.metrics.written' : 'seed.metrics.skipped', {
        symbol,
        date,
        fields: result.fields,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logger('seed.metrics.error', { symbol, date, error: message });
    }
  }
  if (deps.rankMetrics) {
    try {
      const result = await deps.rankMetrics.computeRankForDate(symbol, date);
      deps.logger(result.written ? 'seed.rank.written' : 'seed.rank.skipped', {
        symbol,
        date,
        fields: result.fields,
        latestUpdated: result.latestUpdated,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logger('seed.rank.error', { symbol, date, error: message });
    }
  }
}

function itemKey(item: CorpusItemKey): string {
  return `${item.symbol.toUpperCase()}_${item.date}`;
}

/**
 * Determines whether a seed failure should be retried.
 *
 * Rate limits and timeouts are always retried. Broad upstream errors are also
 * retried because AV occasionally returns transient 5xx-style payloads.
 */
export function isCorpusSeedRetryable(error: unknown): boolean {
  if (error instanceof AlphaVantageUpstreamError) {
    return (
      error.category === AlphaVantageUpstreamErrorCategory.RATE_LIMITED ||
      error.category === AlphaVantageUpstreamErrorCategory.TIMEOUT ||
      error.category === AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR
    );
  }
  // Non-AV failures (GCS write errors, response validation errors, etc.) are
  // treated as terminal; they will not be fixed by repeating the same request.
  return false;
}
