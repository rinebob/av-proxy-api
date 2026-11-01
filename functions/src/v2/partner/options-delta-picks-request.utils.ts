/**
 * Request-param parsing for `partnerOptionsDeltaPicksV1` (Task #225).
 *
 * Pure functions — no I/O. Validates (symbol, type, delta, dte, year) against
 * PICK_GRID; off-grid delta/dte values are rejected here so the handler only
 * ever looks up materialized cell docs. Every error names the failed param.
 */

import {
  PICK_CELL_SYMBOL_PATTERN,
  PICK_GRID_DELTA_PCTS,
  PICK_GRID_DTES,
  type PickGridDeltaPct,
  type PickGridDte,
  type PickOptionType,
} from '@shared/options';

import { toFirstString, parseOptionType } from './partner-request.utils';

export interface DeltaPicksParams {
  symbol: string;
  type: PickOptionType;
  /** Target delta magnitude × 100 — a PICK_GRID_DELTA_PCTS level. */
  deltaPct: PickGridDeltaPct;
  /** Target DTE — a PICK_GRID_DTES level. */
  dte: PickGridDte;
  /** Calendar-year shard (YYYY). */
  year: number;
}

export type DeltaPicksQueryResult =
  | { ok: true; params: DeltaPicksParams }
  | { ok: false; error: string };

const YEAR_PATTERN = /^\d{4}$/;
const INTEGER_PATTERN = /^\d+$/;

const GRID_DELTA_SET: ReadonlySet<number> = new Set<number>(PICK_GRID_DELTA_PCTS);
const GRID_DTE_SET: ReadonlySet<number> = new Set<number>(PICK_GRID_DTES);

function parseGridInt(raw: unknown): number | null {
  const s = toFirstString(raw);
  if (!s || !INTEGER_PATTERN.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Parses the delta-picks endpoint's query params. `delta` is the target
 * delta magnitude × 100 (e.g. `20` = the 20-delta cell; sign is implied by
 * `type`), `dte` a grid tenor, `year` the YYYY shard.
 */
export function parseDeltaPicksQuery(query: Record<string, unknown>): DeltaPicksQueryResult {
  // The cellId codec's alphabet — a symbol the codec can't encode (e.g. a
  // dotted ticker) must 400 here, not throw inside the handler.
  const symbol = toFirstString(query.symbol).toUpperCase();
  if (!symbol || !PICK_CELL_SYMBOL_PATTERN.test(symbol)) {
    return { ok: false, error: 'Invalid or missing symbol' };
  }

  const type = parseOptionType(query.type);
  if (type === null) {
    return { ok: false, error: 'Invalid or missing type — expected C, P, call, or put' };
  }

  const deltaPct = parseGridInt(query.delta);
  if (deltaPct === null || !GRID_DELTA_SET.has(deltaPct)) {
    return {
      ok: false,
      error: `Invalid delta — expected a grid level: ${PICK_GRID_DELTA_PCTS.join(', ')}`,
    };
  }

  const dte = parseGridInt(query.dte);
  if (dte === null || !GRID_DTE_SET.has(dte)) {
    return {
      ok: false,
      error: `Invalid dte — expected a grid level: ${PICK_GRID_DTES.join(', ')}`,
    };
  }

  const yearRaw = toFirstString(query.year);
  if (!YEAR_PATTERN.test(yearRaw)) {
    return { ok: false, error: 'Invalid or missing year — expected YYYY' };
  }

  return {
    ok: true,
    params: { symbol, type, deltaPct: deltaPct as PickGridDeltaPct, dte: dte as PickGridDte, year: Number(yearRaw) },
  };
}
