/**
 * Picker core (Thread #214 / Task #221): pickCellsForDate.
 *
 * Pure function — no Firestore/GCS/AV/HTTP I/O. One stored chain yields one
 * DayPickEntry per grid cell, keyed by full cellId (`{SYM}-{type}-{deltaPct}-{dte}`)
 * so the writer can merge results straight into year-shard docs.
 *
 * Selection (SPEC 213-215):
 *  1. Filter contracts to the cell's option type.
 *  2. Choose the listed expiration nearest to the target DTE (calendar days).
 *  3. Within it, argmin |observedDelta − signedTargetDelta|.
 *
 * Deterministic tie-breaks (documented rule):
 *  - Equidistant expirations -> prefer the LONGER actual DTE (don't let the
 *    pick expire before the strategy's horizon).
 *  - Equidistant deltas -> prefer the larger |delta| (closer to the money);
 *    residual ties -> lowest contractId lexicographically.
 *
 * Eligibility: a row is selectable only when its IDENTITY fields are intact —
 * `contractID`, parseable `expiration` with actual dte >= 0, parseable
 * `strike`, and parseable `delta`. Rows missing identity fields are skipped;
 * a cell with no eligible row gets `no_match` (with `reason`).
 *
 * Emitted fields are never fabricated: quote fields (iv, mark, bid, ask,
 * volume, openInterest) are OMITTED when the chain row lacks a parseable
 * value, and `underlyingClose` is omitted when the caller has no adjusted
 * close — per the TEST edge case "entry still written; close omitted".
 *
 * `no_chain` is the CALLER's entry (AC): the picker requires a present chain.
 * Callers use `noChainPickEntries` for absent chains so the no_chain shape
 * stays canonical in one place.
 *
 * Days are independent: no lookahead, no stickiness, no liquidity filter.
 */
import type { AvOptionContract } from '@shared/alpha-vantage/av-historical-options';
import {
  PICK_GRID,
  buildCellId,
  type DayMiss,
  type DayPick,
  type DayPickEntry,
  type PickOptionType,
} from '@shared/options';
import { isValidIsoDate } from '../../common/utils/date-time.utils';

const MS_PER_DAY = 86_400_000;

/** Symbol-agnostic cell input — PickGridCell-assignable but permissive, so
 *  callers may probe off-grid cells (deferred per SPEC) without casts. */
export interface PickCellInput {
  type: PickOptionType;
  deltaPct: number;
  dte: number;
}

/** Calendar days from `date` to `expiration` (both YYYY-MM-DD); NaN on
 *  unparseable input. */
function daysTo(date: string, expiration: string): number {
  // isValidIsoDate, not bare Date.parse — V8 leniently parses non-canonical
  // forms like '2026-5-15', which would emit a non-ISO expiration downstream.
  if (!isValidIsoDate(expiration)) return NaN;
  return Math.round(
    (Date.parse(`${expiration}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}

/** Strict numeric parse: missing/blank/non-numeric -> NaN (`Number('')`
 *  would otherwise coerce to 0). */
function parseStrict(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return NaN;
  return Number(value);
}

/** Quote fields that are omitted (never zero-fabricated) when a chain row
 *  lacks a parseable value. */
const QUOTE_FIELDS = {
  iv: 'implied_volatility',
  mark: 'mark',
  bid: 'bid',
  ask: 'ask',
  volume: 'volume',
  openInterest: 'open_interest',
} as const;

interface EligibleRow {
  row: AvOptionContract;
  delta: number;
  strike: number;
  dte: number;
}

/** The `no_chain` entry set for an absent corpus chain — emitted by the
 *  CALLER (materialization/nightly paths) when chain retrieval found
 *  nothing for (symbol, date). Kept here so the miss shape is canonical. */
export function noChainPickEntries(
  symbol: string,
  underlyingClose: number | undefined,
  grid: readonly PickCellInput[] = PICK_GRID,
): Map<string, DayPickEntry> {
  const out = new Map<string, DayPickEntry>();
  for (const cell of grid) {
    // Fresh object per cell — callers must be free to mutate one entry
    // without affecting the other 379.
    const miss: DayMiss = {
      status: 'no_chain',
      ...(underlyingClose !== undefined ? { underlyingClose } : {}),
    };
    out.set(buildCellId(symbol, cell.type, cell.deltaPct, cell.dte), miss);
  }
  return out;
}

export function pickCellsForDate(
  chain: AvOptionContract[],
  underlyingClose: number | undefined,
  date: string,
  symbol: string,
  grid: readonly PickCellInput[] = PICK_GRID,
): Map<string, DayPickEntry> {
  if (!isValidIsoDate(date)) {
    throw new Error(`pickCellsForDate: malformed date: ${date}`);
  }

  const miss = (status: DayMiss['status'], reason?: string): DayMiss => ({
    status,
    ...(underlyingClose !== undefined ? { underlyingClose } : {}),
    ...(reason !== undefined ? { reason } : {}),
  });

  const out = new Map<string, DayPickEntry>();
  const cellId = (cell: PickCellInput) =>
    buildCellId(symbol, cell.type, cell.deltaPct, cell.dte);

  // Group eligible rows: type -> expiration -> rows. Identity fields
  // (contractID, expiration dte >= 0, strike, delta) must all be present.
  const byType = new Map<PickOptionType, Map<string, EligibleRow[]>>();
  for (const row of chain) {
    if (row.contractID === undefined || row.contractID.trim() === '') continue;
    const delta = parseStrict(row.delta);
    const strike = parseStrict(row.strike);
    const dte =
      row.expiration !== undefined ? daysTo(date, row.expiration) : NaN;
    if (
      !Number.isFinite(delta) ||
      !Number.isFinite(strike) ||
      !Number.isFinite(dte) ||
      dte < 0
    ) {
      continue;
    }
    if (row.type !== 'put' && row.type !== 'call') continue;
    const byExp = byType.get(row.type) ?? new Map<string, EligibleRow[]>();
    if (!byType.has(row.type)) byType.set(row.type, byExp);
    const rows = byExp.get(row.expiration!) ?? [];
    if (!byExp.has(row.expiration!)) byExp.set(row.expiration!, rows);
    rows.push({ row, delta, strike, dte });
  }

  for (const cell of grid) {
    const key = cellId(cell);
    const target =
      cell.type === 'put' ? -cell.deltaPct / 100 : cell.deltaPct / 100;
    const byExp = byType.get(cell.type);
    if (!byExp || byExp.size === 0) {
      out.set(key, miss('no_match', `no ${cell.type} contracts`));
      continue;
    }

    // Nearest-DTE expiration; tie -> longer actual DTE.
    let bestExp: { expiration: string; dte: number } | null = null;
    for (const [expiration, rows] of byExp) {
      const dte = rows[0].dte;
      const dist = Math.abs(dte - cell.dte);
      if (
        bestExp === null ||
        dist < Math.abs(bestExp.dte - cell.dte) ||
        (dist === Math.abs(bestExp.dte - cell.dte) && dte > bestExp.dte)
      ) {
        bestExp = { expiration, dte };
      }
    }
    const candidates = byExp.get(bestExp!.expiration)!;

    // argmin |observedDelta − target|; tie -> larger |delta| -> lowest contractId.
    let best: EligibleRow | null = null;
    for (const cand of candidates) {
      if (best === null) {
        best = cand;
        continue;
      }
      const d = Math.abs(cand.delta - target);
      const dBest = Math.abs(best.delta - target);
      if (
        d < dBest ||
        (d === dBest &&
          (Math.abs(cand.delta) > Math.abs(best.delta) ||
            (Math.abs(cand.delta) === Math.abs(best.delta) &&
              (cand.row.contractID ?? '') < (best.row.contractID ?? ''))))
      ) {
        best = cand;
      }
    }
    if (!best) {
      out.set(key, miss('no_match', 'no eligible contract'));
      continue;
    }

    const pick: DayPick = {
      // Omitted (not zeroed) when no adjusted close exists for the date —
      // zero would fabricate a market value (TEST edge case).
      ...(underlyingClose !== undefined ? { underlyingClose } : {}),
      contractId: best.row.contractID!,
      expiration: best.row.expiration!,
      dte: best.dte,
      strike: best.strike,
      delta: best.delta,
    };
    for (const [key, field] of Object.entries(QUOTE_FIELDS) as [
      keyof typeof QUOTE_FIELDS,
      keyof AvOptionContract,
    ][]) {
      const n = parseStrict(best.row[field] as string | undefined);
      if (Number.isFinite(n)) pick[key] = n;
    }
    out.set(key, pick);
  }

  return out;
}
