import { CANONICAL_ZIGZAG_CONFIGS, deriveParamsId } from '@shared/zigzag';
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

const CANONICAL_PARAMS_IDS = new Set(CANONICAL_ZIGZAG_CONFIGS.map(deriveParamsId));

const toDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Task #151 — swing-doc pivot planner.
 *
 * Reads the symbol's four canonical swing-set docs and emits the deduped work
 * list for the options corpus: every confirmed pivot date (kind 'confirmed')
 * plus each config's current projected extreme (kind 'interim'). Confirmed
 * wins when a projection date coincides with a confirmed pivot in another
 * config. Missing/partial docs are tolerated — the planner emits whatever
 * coverage exists. Non-canonical paramsIds are ignored so ad-hoc sets never
 * drive corpus spend.
 */
export async function planPivotSeeds(
  symbol: string,
  deps: PivotPlannerDeps,
): Promise<PivotWorkItem[]> {
  const upper = symbol.toUpperCase();
  const docs = (await deps.listSwingSetDocs(upper)).filter(
    (d) => CANONICAL_PARAMS_IDS.has(d.paramsId) && d.source !== 'st',
  );

  const confirmed = new Set<string>();
  const interim = new Set<string>();
  for (const doc of docs) {
    for (const p of doc.pivots ?? []) {
      if (p.confirmed) confirmed.add(toDay(p.time));
    }
    const projection = doc.projection;
    // Engine always writes projections with confirmed:false; the extra guard
    // keeps a malformed doc from emitting a bogus interim.
    if (projection && !projection.confirmed) interim.add(toDay(projection.time));
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
