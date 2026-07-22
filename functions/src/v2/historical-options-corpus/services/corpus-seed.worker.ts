import { AlphaVantageUpstreamError, AlphaVantageUpstreamErrorCategory } from '../../alpha-vantage/utils';
import type { CorpusItemKey, CorpusSeedPayload } from '../types';
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
  retrieval: HistoricalOptionsRetrievalService;
  gcs: GcsCorpusAdapter;
  metadata: CorpusMetadataService;
  enqueueTask: (payload: CorpusSeedPayload) => Promise<void>;
  maxAttempts: number;
  logger: (message: string, meta?: Record<string, unknown>) => void;
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

  const existing = await deps.metadata.getItemDoc(runId, key);
  if (existing?.status === 'success') {
    deps.logger('seed.skip.already-recorded', { runId, symbol, date });
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
    return { status: 'skipped', reason: 'gcs-hit' };
  }

  await deps.metadata.touchItem(runId, key, 'in_progress');

  try {
    // Throttling is owned by the retrieval service; the worker does not add a
    // second wait so a shared throttle instance paces the AV request rate.
    const { response, analysis } = await deps.retrieval.fetch({ symbol, date });
    const writeResult = await deps.gcs.writeItem(symbol, date, response, analysis);

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
    await deps.enqueueTask({ runId, symbol, date, attempt: nextAttempt });
    return { status: 'retry_enqueued', nextAttempt };
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
