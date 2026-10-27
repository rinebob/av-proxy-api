/**
 * Delta-pick grid + cellId codec (Thread #214 / Task #219).
 *
 * PICK_GRID is the canonical materialized grid: 19 delta magnitudes
 * (0.05–0.95 step .05) x 10 DTE targets x put/call = 380 cells per
 * symbol per year. The codec encodes a cell's Firestore doc id
 * `{SYM}-{type}-{deltaPct}-{dte}` and decodes it back — decoder is
 * generic (does not require grid membership) so deferred off-grid
 * cells parse too.
 */

import {
  OPTIONS_DELTA_PICKS_COLLECTION,
  OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION,
  type DayMiss,
  type DayMissStatus,
  type DayPick,
  type DayPickEntry,
  type PickOptionType,
} from './options-delta-picks.types';

// ---- Grid ----

/** Target delta magnitudes, percent (sign implied by type: puts negative). */
export const PICK_GRID_DELTA_PCTS = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95,
] as const;
export type PickGridDeltaPct = (typeof PICK_GRID_DELTA_PCTS)[number];

/** Target DTEs (calendar days) — non-uniform on purpose: weeklies dense at
 *  the short end; 30/60/90/180/365 track monthly/quarterly/annual expiries. */
export const PICK_GRID_DTES = [7, 14, 21, 30, 45, 60, 90, 120, 180, 365] as const;
export type PickGridDte = (typeof PICK_GRID_DTES)[number];

export const PICK_GRID_TYPES = ['put', 'call'] as const;

/** One grid cell — symbol-agnostic; the symbol joins at materialization. */
export interface PickGridCell {
  type: PickOptionType;
  deltaPct: PickGridDeltaPct;
  dte: PickGridDte;
}

export const PICK_GRID: readonly PickGridCell[] = PICK_GRID_TYPES.flatMap(
  (type) =>
    PICK_GRID_DELTA_PCTS.flatMap((deltaPct) =>
      PICK_GRID_DTES.map((dte) => ({ type, deltaPct, dte })),
    ),
);

// ---- cellId codec ----

export interface ParsedCellId {
  symbol: string;
  type: PickOptionType;
  deltaPct: number;
  dte: number;
}

const SYMBOL_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/i;

export function buildCellId(
  symbol: string,
  type: PickOptionType,
  deltaPct: number,
  dte: number,
): string {
  if (
    !SYMBOL_PATTERN.test(symbol) ||
    !Number.isSafeInteger(deltaPct) || deltaPct <= 0 ||
    !Number.isSafeInteger(dte) || dte <= 0
  ) {
    throw new Error(`buildCellId: invalid components: ${symbol}-${type}-${deltaPct}-${dte}`);
  }
  return `${symbol.toUpperCase()}-${type}-${deltaPct}-${dte}`;
}

const INTEGER_SEGMENT = /^\d+$/;

/** Parses `{SYM}-{type}-{deltaPct}-{dte}`; null on any malformed segment.
 *  Parsed from the right — the last three segments are always
 *  `{type}-{deltaPct}-{dte}` — so symbols containing hyphens (e.g.
 *  `BRK-B`) round-trip. Decimal-only numeric segments reject
 *  scientific/hex/whitespace forms (`1e2`, `0x14`, ` 20`). */
export function parseCellId(cellId: string): ParsedCellId | null {
  const parts = cellId.split('-');
  if (parts.length < 4) return null;
  const dteRaw = parts[parts.length - 1];
  const deltaPctRaw = parts[parts.length - 2];
  const typeRaw = parts[parts.length - 3];
  const symbol = parts.slice(0, parts.length - 3).join('-');
  if (!symbol) return null;
  if (typeRaw !== 'put' && typeRaw !== 'call') return null;
  if (!INTEGER_SEGMENT.test(deltaPctRaw) || !INTEGER_SEGMENT.test(dteRaw)) return null;
  const deltaPct = Number(deltaPctRaw);
  const dte = Number(dteRaw);
  if (!Number.isSafeInteger(deltaPct) || deltaPct <= 0) return null;
  if (!Number.isSafeInteger(dte) || dte <= 0) return null;
  return { symbol: symbol.toUpperCase(), type: typeRaw, deltaPct, dte };
}

// ---- Paths ----

/** `options-delta-picks/{cellId}/years/{YYYY}` — a document path (even
 *  segment count for Firestore doc references). */
export function cellYearDocPath(cellId: string, year: number): string {
  return `${OPTIONS_DELTA_PICKS_COLLECTION}/${cellId}/${OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION}/${year}`;
}

// ---- Day-entry guards ----

/** A pick entry has a contractId and no status field. */
export function isPickEntry(entry: DayPickEntry): entry is DayPick {
  return 'contractId' in entry && entry.contractId != null;
}

export function isMissEntry(entry: DayPickEntry): entry is DayMiss {
  return 'status' in entry && entry.status != null;
}

/** Miss statuses a later materialization pass may overwrite — the
 *  self-repair hook: `no_chain`/`no_match` heal when the corpus gap
 *  behind them is filled. Any future miss status is immutable unless
 *  added here. */
const REPAIRABLE_MISS_STATUSES: ReadonlySet<DayMissStatus> = new Set(['no_chain', 'no_match']);

/** True when an existing day entry may be upgraded by a recompute:
 *  repairable misses are re-writable; pick entries are immutable. */
export function isRepairableEntry(entry: DayPickEntry): entry is DayMiss {
  return isMissEntry(entry) && !isPickEntry(entry) && REPAIRABLE_MISS_STATUSES.has(entry.status);
}
