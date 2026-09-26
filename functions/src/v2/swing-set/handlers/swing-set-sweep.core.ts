/**
 * runSwingSetSweep — shared sweep/backfill core (Task #127).
 *
 * Enumerates tracked-symbols where `optionsEnabled == true`, freshness-checks
 * each against the canonical swing-set docs, and regenerates stale/missing
 * symbols via SwingSetGenerationService. Per-symbol failures are caught and
 * reported — one bad symbol never aborts the sweep.
 *
 * Consumers:
 * - sweep-swing-sets.scheduler.ts — daily onSchedule (force=false)
 * - backfill-swing-sets.http.ts — operator-run (force optional, symbols subset)
 *
 * Side-effect-free: no firebase-admin-init import — jest-safe.
 */
import { FirestoreCollection } from '@shared/firestore';

import type { FirestoreLike } from '../../common/firestore/firestore-like';
import type { SwingSetRepository } from '../services/swing-set.repository';
import type { SwingSetGenerationService } from '../services/swing-set-generation.service';
import type { LoggerLike } from '../services/swing-set-generation.service';
import { swingSetsAreFresh } from './generate-swing-sets.core';

export interface SwingSetSweepResult {
  /** optionsEnabled symbols examined (after optional subset filter). */
  checked: number;
  /** Symbols skipped because all canonical docs were within the TTL. */
  fresh: string[];
  /** Symbols regenerated (>=1 doc written). */
  generated: string[];
  /** Symbols where generation ran but found no daily-adjusted data. */
  skippedNoData: string[];
  /** dryRun only: stale/missing symbols that a real run would regenerate. */
  wouldGenerate: string[];
  /** Named via opts.symbols but not optionsEnabled (or untracked). */
  excludedNotEnabled: string[];
  /** Per-symbol failures — sweep continues past these. */
  failed: { symbol: string; error: string }[];
}

export interface SweepDeps {
  repository: SwingSetRepository;
  generation: Pick<SwingSetGenerationService, 'generateForSymbol'>;
  logger: LoggerLike;
  /** Inject for deterministic freshness windows in tests. */
  nowMs?: number;
  /** Regenerate even when docs are fresh (backfill). */
  force?: boolean;
  /**
   * Optional subset — intersected with the optionsEnabled set. `undefined`
   * means "all enabled"; an explicit empty list means "none".
   */
  symbols?: string[];
  /**
   * Report-only: run the enumeration + freshness checks, then record each
   * stale/missing target in `wouldGenerate` instead of generating.
   */
  dryRun?: boolean;
  /**
   * Downstream hook (Task #153): pivot-seed fanout after each successful
   * regeneration — newly confirmed pivot dates get corpus seed tasks.
   * Failures warn, never fail the symbol.
   */
  onGenerated?(symbol: string): Promise<unknown>;
}

export async function runSwingSetSweep(
  db: FirestoreLike,
  deps: SweepDeps,
): Promise<SwingSetSweepResult> {
  const result: SwingSetSweepResult = {
    checked: 0, fresh: [], generated: [], skippedNoData: [], wouldGenerate: [], excludedNotEnabled: [], failed: [],
  };

  const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS)
    .where('optionsEnabled', '==', true)
    .get();
  const enabled = new Set(snap.docs.map((d) => d.id.trim().toUpperCase()));

  let targets: string[];
  if (deps.symbols !== undefined) {
    const wanted = deps.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    result.excludedNotEnabled = wanted.filter((s) => !enabled.has(s));
    targets = wanted.filter((s) => enabled.has(s));
  } else {
    targets = [...enabled];
  }
  result.checked = targets.length;
  deps.logger.info(`swing-set sweep: ${targets.length} options-enabled symbol(s) to check${deps.force ? ' (force)' : ''}`);

  const nowMs = deps.nowMs ?? Date.now();
  for (const symbol of targets) {
    try {
      if (!deps.force && swingSetsAreFresh(await deps.repository.listBySymbol(symbol), nowMs)) {
        result.fresh.push(symbol);
        continue;
      }
      if (deps.dryRun) {
        result.wouldGenerate.push(symbol);
        continue;
      }
      const gen = await deps.generation.generateForSymbol(symbol);
      if (gen.skipped) {
        result.skippedNoData.push(symbol);
      } else {
        result.generated.push(symbol);
        if (deps.onGenerated) {
          try {
            await deps.onGenerated(symbol);
          } catch (fanoutErr) {
            deps.logger.warn(`swing-set sweep: ${symbol} corpus seed fanout failed — ${fanoutErr instanceof Error ? fanoutErr.message : String(fanoutErr)}`);
          }
        }
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      deps.logger.warn(`swing-set sweep: ${symbol} failed — ${error}`);
      result.failed.push({ symbol, error });
    }
  }

  deps.logger.info(
    `swing-set sweep done — checked=${result.checked} fresh=${result.fresh.length} ` +
      `generated=${result.generated.length} noData=${result.skippedNoData.length} failed=${result.failed.length}`,
  );
  return result;
}
