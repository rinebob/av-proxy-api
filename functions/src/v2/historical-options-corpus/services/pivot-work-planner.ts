import { CORPUS_ZIGZAG_CONFIG, deriveParamsId } from '@shared/zigzag';
import type { SwingSetDoc } from '@shared/zigzag';
import { db } from '../../../firebase-admin-init';
import { SwingSetRepository } from '../../swing-set/services/swing-set.repository';
import type { FirestoreLike } from '../../common/firestore/firestore-like';

/**
 * One corpus work item: a (symbol, date) snapshot the options corpus should
 * hold. `confirmed` = a confirmed swing pivot; `interim` = the developing
 * swing's current projected extreme (superseded as the swing advances —
 * Task #154 deletes prior interims).
 */
export interface PivotWorkItem {
  symbol: string;
  /** YYYY-MM-DD. */
  date: string;
  kind: 'confirmed' | 'interim';
}

export interface PivotPlannerDeps {
  /** Returns all swing-set docs for a symbol (any paramsIds present). */
  listSwingSetDocs: (symbol: string) => Promise<SwingSetDoc[]>;
}

const CORPUS_PARAMS_ID = deriveParamsId(CORPUS_ZIGZAG_CONFIG);

/**
 * Task #151 — swing-doc pivot planner.
 *
 * Reads the symbol's corpus swing-set doc (dev2/2/2 — its pivot dates cover
 * every ≥2% extreme) and emits the deduped work list for the options corpus:
 * every confirmed pivot date (kind 'confirmed') plus the current projected
 * extreme (kind 'interim'). Confirmed wins when the projection date coincides
 * with a confirmed pivot. A missing doc yields no items — generation is the
 * sweep's job, not the planner's.
 *
 * `currentExtremeDate` is an interim only when it isn't already a confirmed
 * pivot — when no projection exists the field equals the last confirmed pivot
 * date, which dedupes out naturally.
 */
export async function planPivotSeeds(
  symbol: string,
  deps: PivotPlannerDeps,
): Promise<PivotWorkItem[]> {
  const upper = symbol.toUpperCase();
  const docs = (await deps.listSwingSetDocs(upper)).filter(
    (d) => d.paramsId === CORPUS_PARAMS_ID && d.source !== 'st',
  );

  const confirmed = new Set<string>();
  const interim = new Set<string>();
  for (const doc of docs) {
    for (const date of doc.pivotDates ?? []) confirmed.add(date);
    if (doc.currentExtremeDate && !confirmed.has(doc.currentExtremeDate)) {
      interim.add(doc.currentExtremeDate);
    }
  }

  const items: PivotWorkItem[] = [
    ...[...confirmed].map((date) => ({ symbol: upper, date, kind: 'confirmed' as const })),
    ...[...interim]
      .filter((date) => !confirmed.has(date))
      .map((date) => ({ symbol: upper, date, kind: 'interim' as const })),
  ];
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Production deps: list the symbol's swing-set docs from `options-swing-sets`.
 */
export function createPivotPlannerDeps(): PivotPlannerDeps {
  const repository = new SwingSetRepository(db as FirestoreLike);
  return { listSwingSetDocs: (symbol) => repository.listBySymbol(symbol) };
}
