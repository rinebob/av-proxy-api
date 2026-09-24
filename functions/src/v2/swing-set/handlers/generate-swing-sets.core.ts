/**
 * Testable core of generateSwingSetsTask — no firebase-admin-init import, so
 * this module is side-effect-free (jest can require it without initializing
 * admin). The Cloud Tasks wrapper lives in generate-swing-sets.task.ts.
 *
 * Freshness: if all four canonical swing-set docs exist and their oldest
 * `generatedAt` is within SWING_SET_FRESHNESS_TTL_MS, the task skips. The TTL
 * is shorter than the daily-adjusted refresh cadence (~24h) so a duplicate
 * delivery or repeated enable-trigger is a no-op while a new trading day
 * always regenerates. #127's sweep can refine this to a data-timestamp check.
 *
 * Retry: transient failures (service throws) propagate → Cloud Tasks retries.
 * Permanent failures (invalid payload, non-string symbol) log warn and return
 * — the task is acked, not retried.
 */
import { getFunctions } from 'firebase-admin/functions';

import { FirestoreCollection } from '@shared/firestore';
import { CANONICAL_ZIGZAG_CONFIGS, deriveParamsId } from '@shared/zigzag';
import type { SwingSetDoc } from '@shared/zigzag';

import type { FirestoreLike } from '../../common/firestore/firestore-like';
import type { SwingSetRepository } from '../services/swing-set.repository';
import type { SwingSetGenerationService } from '../services/swing-set-generation.service';
import type { LoggerLike } from '../services/swing-set-generation.service';
import type { SwingSetGenerationResult } from '../types';

/** Queue name must match the exported function id (repo convention). */
export const GENERATE_SWING_SETS_TASK_QUEUE = 'generateSwingSetsTask';

/** Swing-set docs younger than this are treated as fresh — skip regeneration. */
export const SWING_SET_FRESHNESS_TTL_MS = 20 * 60 * 60 * 1000;

/** generatedAt more than this far in the future is treated as corrupt → stale. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface GenerateSwingSetsPayload {
  symbol: string;
}

interface HandleDeps {
  repository: SwingSetRepository;
  generation: Pick<SwingSetGenerationService, 'generateForSymbol'>;
  logger: LoggerLike;
  nowMs?: number;
}

/** True when every canonical config has a doc and none is older than the TTL. */
export function swingSetsAreFresh(docs: SwingSetDoc[], nowMs: number): boolean {
  const canonicalIds = new Set(CANONICAL_ZIGZAG_CONFIGS.map(deriveParamsId));
  const byParamsId = new Map(docs.map((d) => [d.paramsId, d]));
  for (const paramsId of canonicalIds) {
    const doc = byParamsId.get(paramsId);
    if (!doc || !doc.generatedAt || typeof doc.generatedAt.seconds !== 'number') return false;
    const ageMs = nowMs - doc.generatedAt.seconds * 1000;
    if (ageMs > SWING_SET_FRESHNESS_TTL_MS || ageMs < -FUTURE_SKEW_MS) return false;
  }
  return true;
}

/**
 * Testable core of the task. Validates the payload, applies the freshness
 * gate, and delegates to the generation service. Throws on service failure so
 * Cloud Tasks retries; returns quietly on invalid payloads.
 */
export async function handleGenerateSwingSets(
  payload: GenerateSwingSetsPayload,
  deps: HandleDeps,
): Promise<SwingSetGenerationResult | 'skipped-fresh' | 'invalid-payload'> {
  const symbol = typeof payload?.symbol === 'string' ? payload.symbol.trim().toUpperCase() : '';
  if (!symbol) {
    deps.logger.warn(`generateSwingSetsTask: invalid payload ${JSON.stringify(payload)} — acking without retry`);
    return 'invalid-payload';
  }

  const docs = await deps.repository.listBySymbol(symbol);
  if (swingSetsAreFresh(docs, deps.nowMs ?? Date.now())) {
    deps.logger.info(`generateSwingSetsTask: ${symbol} swing sets are fresh — skipped`);
    return 'skipped-fresh';
  }

  const result = await deps.generation.generateForSymbol(symbol);
  deps.logger.info(`generateSwingSetsTask: ${symbol} done — generated=${result.generated.length} skipped=${result.skipped}`);
  return result;
}

interface EnqueueDeps {
  /** Test seam over `getFunctions().taskQueue(QUEUE).enqueue`. */
  enqueue?(payload: GenerateSwingSetsPayload): Promise<unknown>;
  logger?: LoggerLike;
}

/**
 * Enqueue a generation task for a symbol — only when its tracked-symbols doc
 * exists and has `optionsEnabled === true` (Task #126 AC). Returns true when
 * the task was enqueued. Thread #105's enable call site invokes this.
 */
export async function enqueueSwingSetGeneration(
  db: FirestoreLike,
  symbol: string,
  deps: EnqueueDeps = {},
): Promise<boolean> {
  const logger = deps.logger ?? console;
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    logger.warn('generateSwingSetsTask: not enqueued — empty symbol');
    return false;
  }
  const enqueue = deps.enqueue ?? ((p: GenerateSwingSetsPayload) =>
    getFunctions().taskQueue(GENERATE_SWING_SETS_TASK_QUEUE).enqueue(p));
  const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(normalized).get();
  const optionsEnabled = snap.exists === true
    ? (snap.data() as { optionsEnabled?: boolean } | undefined)?.optionsEnabled
    : undefined;
  if (optionsEnabled !== true) {
    logger.info(`generateSwingSetsTask: not enqueued — ${normalized} optionsEnabled=${optionsEnabled ?? 'absent'}`);
    return false;
  }
  await enqueue({ symbol: normalized });
  logger.info(`generateSwingSetsTask: enqueued ${normalized}`);
  return true;
}
