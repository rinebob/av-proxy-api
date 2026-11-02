/**
 * Golden-diff classifier core (Thread #214 / Task #226).
 *
 * Pure functions — no I/O, no firebase-admin. `reconcileDay` compares one
 * golden day entry against the regenerated entry and the STORED chain the
 * regeneration was built from, then assigns a root-cause category.
 *
 * The gate is strict day-for-day equality: on a correct baseline every
 * day must be `identical`. The non-identical categories exist so a
 * failing diff is self-diagnosing — `regression`/`unexplained` mean a
 * real pipeline defect (the regenerated pick fails the selection rule or
 * can't be traced to the stored chain); the remaining categories mean
 * the baseline went stale against legitimately-changed corpus inputs and
 * the fix is re-blessing, not a code change.
 */
import type { AvOptionContract } from '@shared/alpha-vantage/av-historical-options';
import {
  isMissEntry,
  isPickEntry,
  type DayMiss,
  type DayPick,
  type DayPickEntry,
  type PickOptionType,
} from '@shared/options';

import { isValidIsoDate } from '../../src/v2/common/utils/date-time.utils';
import type { PickCellInput } from '../../src/v2/historical-options-corpus/services/options-delta-picker.service';

const MS_PER_DAY = 86_400_000;

/** The grid cell under reconciliation — `{symbol}-{type}-{deltaPct}-{dte}`
 *  without the symbol (dates are reconciled per cell). Alias of the
 *  production input type; the oracle logic below stays independent. */
export type PickCellSpec = PickCellInput;

export type GoldenDiffCategory =
  /** Entries identical. */
  | 'identical'
  /** Golden miss → pick with the new pick verified as the SPEC winner,
   *  or no_chain → no_match: the chain/contracts the baseline lacked are
   *  now stored. */
  | 'repaired-gap'
  /** Golden's contract is absent from the stored chain — the snapshot was
   *  superseded and the regenerated pick is the current SPEC winner. */
  | 'contract-superseded'
  /** Golden's contract still exists but loses the SPEC selection rule to
   *  the regenerated pick (new closer-DTE expiration or closer delta). */
  | 'outranked'
  /** Same contract; regenerated fields match the stored row exactly —
   *  the snapshot's greeks/quotes were refreshed after the golden run. */
  | 'fields-refreshed'
  /** Only underlyingClose differs — the pick itself (all fields verified
   *  against the stored row) is unchanged; the close moved. */
  | 'close-only'
  /** Same miss status; only reason/underlyingClose detail differs. Shape
   *  check only — the classifier has no bar data to prove the close. */
  | 'miss-detail'
  /** A diff that must not happen: golden pick → miss, miss-kind worsened,
   *  or the regenerated pick is not the SPEC winner. */
  | 'regression'
  /** Anything the classifier cannot prove from the stored chain. */
  | 'unexplained';

export interface FieldDiff {
  field: string;
  golden: unknown;
  actual: unknown;
}

export interface DayReconciliation {
  date: string;
  category: GoldenDiffCategory;
  /** explained = the category is attributable to changed inputs (stale
   *  baseline), not a defect. Note: the gate still fails on ANY
   *  non-identical day — explained only steers the remediation. */
  explained: boolean;
  detail: string;
  fieldDiffs: FieldDiff[];
}

const EXPLAINED: ReadonlySet<GoldenDiffCategory> = new Set([
  'identical',
  'repaired-gap',
  'contract-superseded',
  'outranked',
  'fields-refreshed',
  'close-only',
  'miss-detail',
]);

/** Field-level diff over the union of both entries' keys. Absent and
 *  `undefined` are equivalent (entries omit unparseable fields). */
export function diffEntries(golden: DayPickEntry, actual: DayPickEntry): FieldDiff[] {
  const g = golden as unknown as Record<string, unknown>;
  const a = actual as unknown as Record<string, unknown>;
  const diffs: FieldDiff[] = [];
  for (const key of new Set([...Object.keys(g), ...Object.keys(a)])) {
    if (JSON.stringify(g[key]) !== JSON.stringify(a[key])) {
      diffs.push({ field: key, golden: g[key], actual: a[key] });
    }
  }
  return diffs;
}

// --- SPEC selection rule (mirrors options-delta-picker.service) ---------

function parseStrict(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return NaN;
  return Number(value);
}

function daysTo(date: string, expiration: string): number {
  if (!isValidIsoDate(expiration)) return NaN;
  return Math.round(
    (Date.parse(`${expiration}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}

interface EligibleRow {
  row: AvOptionContract;
  delta: number;
  strike: number;
  dte: number;
}

/** Picker's eligibility filter: intact identity fields only. */
function eligibleRows(
  chain: readonly AvOptionContract[],
  type: PickOptionType,
  date: string,
): EligibleRow[] {
  const out: EligibleRow[] = [];
  for (const row of chain) {
    if (row.contractID === undefined || row.contractID.trim() === '') continue;
    if (row.type !== type) continue;
    const delta = parseStrict(row.delta);
    const strike = parseStrict(row.strike);
    const dte = row.expiration !== undefined ? daysTo(date, row.expiration) : NaN;
    if (!Number.isFinite(delta) || !Number.isFinite(strike) || !Number.isFinite(dte) || dte < 0) {
      continue;
    }
    out.push({ row, delta, strike, dte });
  }
  return out;
}

interface Selection {
  winner: EligibleRow;
  expiration: string;
  expDte: number;
}

/** Signed target delta for a cell: puts negative, calls positive. */
function signedTargetDelta(spec: PickCellSpec): number {
  return spec.type === 'put' ? -spec.deltaPct / 100 : spec.deltaPct / 100;
}

/** SPEC selection: nearest-DTE expiration (tie → longer DTE), then argmin
 *  |delta − target| (tie → larger |delta| → lowest contractId). */
function selectWinner(rows: readonly EligibleRow[], spec: PickCellSpec): Selection | null {
  const target = signedTargetDelta(spec);
  const byExp = new Map<string, EligibleRow[]>();
  for (const r of rows) {
    const exp = r.row.expiration!; // finite dte ⇒ defined (eligibleRows filter)
    let list = byExp.get(exp);
    if (list === undefined) byExp.set(exp, (list = []));
    list.push(r);
  }
  let bestExp: { expiration: string; dte: number } | null = null;
  for (const [expiration, list] of byExp) {
    const dte = list[0].dte;
    if (
      bestExp === null ||
      Math.abs(dte - spec.dte) < Math.abs(bestExp.dte - spec.dte) ||
      (Math.abs(dte - spec.dte) === Math.abs(bestExp.dte - spec.dte) && dte > bestExp.dte)
    ) {
      bestExp = { expiration, dte };
    }
  }
  if (bestExp === null) return null;
  let best: EligibleRow | null = null;
  for (const cand of byExp.get(bestExp.expiration)!) {
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
  return best === null ? null : { winner: best, expiration: bestExp.expiration, expDte: bestExp.dte };
}

const QUOTE_FIELDS = {
  iv: 'implied_volatility',
  mark: 'mark',
  bid: 'bid',
  ask: 'ask',
  volume: 'volume',
  openInterest: 'open_interest',
} as const;

/** The pick fields a stored row produces — the proof that a regenerated
 *  entry's values came from the snapshot rather than being fabricated. */
function pickFieldsFromRow(r: EligibleRow): Record<string, unknown> {
  const pick: Record<string, unknown> = {
    contractId: r.row.contractID,
    expiration: r.row.expiration,
    dte: r.dte,
    strike: r.strike,
    delta: r.delta,
  };
  for (const [key, field] of Object.entries(QUOTE_FIELDS) as [
    keyof typeof QUOTE_FIELDS,
    keyof AvOptionContract,
  ][]) {
    const n = parseStrict(r.row[field] as string | undefined);
    if (Number.isFinite(n)) pick[key] = n;
  }
  return pick;
}

function findEligibleRow(
  chain: readonly AvOptionContract[],
  contractId: string,
  type: PickOptionType,
  date: string,
): EligibleRow | undefined {
  return eligibleRows(chain, type, date).find((r) => r.row.contractID === contractId);
}

/** Contract the SPEC selection rule would pick on this chain — the
 *  independent-oracle seam, used by the classifier and by --write-asset
 *  (which must prove every pick it blesses is the rule's winner). */
export function specWinner(
  chain: readonly AvOptionContract[],
  date: string,
  cell: PickCellSpec,
): { contractId: string; expiration: string } | null {
  const sel = selectWinner(eligibleRows(chain, cell.type, date), cell);
  if (sel === null || sel.winner.row.contractID === undefined) return null;
  return { contractId: sel.winner.row.contractID, expiration: sel.expiration };
}

// --- Classification -----------------------------------------------------

export function reconcileDay(
  date: string,
  golden: DayPickEntry,
  actual: DayPickEntry,
  /** The stored chain the regeneration ran on; null when absent. */
  chain: readonly AvOptionContract[] | null,
  cell: PickCellSpec,
): DayReconciliation {
  const fieldDiffs = diffEntries(golden, actual);
  const mk = (category: GoldenDiffCategory, detail: string): DayReconciliation => ({
    date,
    category,
    explained: EXPLAINED.has(category),
    detail,
    fieldDiffs,
  });

  if (fieldDiffs.length === 0) return mk('identical', 'entries identical');

  const gPick = isPickEntry(golden) ? (golden as DayPick) : null;
  const aPick = isPickEntry(actual) ? (actual as DayPick) : null;
  const gMiss = isMissEntry(golden) ? (golden as DayMiss) : null;
  const aMiss = isMissEntry(actual) ? (actual as DayMiss) : null;

  if (gMiss && aPick) {
    if (chain === null) {
      return mk('unexplained', 'regenerated pick exists but no stored chain was supplied');
    }
    const sel = selectWinner(eligibleRows(chain, cell.type, date), cell);
    if (sel === null || sel.winner.row.contractID !== aPick.contractId) {
      return mk(
        'regression',
        `golden ${gMiss.status} → pick ${aPick.contractId}, but it is not the SPEC winner (${
          sel?.winner.row.contractID ?? 'no eligible rows'
        })`,
      );
    }
    return mk(
      'repaired-gap',
      `golden ${gMiss.status} → pick ${aPick.contractId} (SPEC winner): chain/contracts now stored`,
    );
  }
  if (gPick && aMiss) {
    return mk(
      'regression',
      `golden pick ${gPick.contractId} → ${aMiss.status}${
        chain === null ? ' (stored chain absent)' : ''
      }`,
    );
  }
  if (gMiss && aMiss) {
    if (gMiss.status === aMiss.status) {
      return mk(
        'miss-detail',
        `same status '${aMiss.status}'; detail fields differ (${fieldDiffs
          .map((d) => d.field)
          .join(', ')})`,
      );
    }
    if (gMiss.status === 'no_chain' && aMiss.status === 'no_match') {
      return mk('repaired-gap', 'chain now stored; still no eligible contract');
    }
    return mk('regression', `miss kind worsened: ${gMiss.status} → ${aMiss.status}`);
  }
  if (!gPick || !aPick) {
    return mk('unexplained', 'unrecognized entry shape');
  }
  if (chain === null) {
    return mk('unexplained', 'regenerated pick exists but no stored chain was supplied');
  }

  // pick → pick ------------------------------------------------------------
  if (gPick.contractId === aPick.contractId) {
    const row = findEligibleRow(chain, aPick.contractId, cell.type, date);
    if (!row) {
      return mk(
        'unexplained',
        `picked contract ${aPick.contractId} is not an eligible row of the stored chain`,
      );
    }
    const derived = pickFieldsFromRow(row);
    const mismatches: string[] = [];
    const actualFields = { ...(aPick as unknown as Record<string, unknown>) };
    delete actualFields.underlyingClose;
    for (const key of new Set([...Object.keys(derived), ...Object.keys(actualFields)])) {
      if (JSON.stringify(derived[key]) !== JSON.stringify(actualFields[key])) {
        mismatches.push(`${key}: entry ${JSON.stringify(actualFields[key])} vs chain row ${JSON.stringify(derived[key])}`);
      }
    }
    if (mismatches.length > 0) {
      return mk('unexplained', `entry values diverge from stored row — ${mismatches.join('; ')}`);
    }
    const nonCloseDiffs = fieldDiffs.filter((d) => d.field !== 'underlyingClose');
    if (nonCloseDiffs.length === 0) {
      return mk('close-only', 'only underlyingClose differs (adjusted close re-derived)');
    }
    return mk(
      'fields-refreshed',
      `stored snapshot refreshed: ${nonCloseDiffs.map((d) => d.field).join(', ')}`,
    );
  }

  // Different contracts: the regenerated pick must be the SPEC winner, else
  // the divergence is a real pipeline bug, not a data-version difference.
  const rows = eligibleRows(chain, cell.type, date);
  const sel = selectWinner(rows, cell);
  if (sel === null || sel.winner.row.contractID !== aPick.contractId) {
    return mk(
      'regression',
      `regenerated pick ${aPick.contractId} is not the SPEC winner (${
        sel?.winner.row.contractID ?? 'no eligible rows'
      })`,
    );
  }
  const gRow = findEligibleRow(chain, gPick.contractId, cell.type, date);
  if (!gRow) {
    return mk(
      'contract-superseded',
      `golden contract ${gPick.contractId} absent from stored chain; ${aPick.contractId} is the SPEC winner`,
    );
  }
  const target = signedTargetDelta(cell);
  if (gRow.row.expiration !== sel.expiration) {
    return mk(
      'outranked',
      `golden expiration ${gRow.row.expiration} (dte ${gRow.dte}) lost nearest-DTE(${cell.dte}) to ${sel.expiration} (dte ${sel.expDte}); winner ${aPick.contractId}`,
    );
  }
  return mk(
    'outranked',
    `same expiration ${sel.expiration}: golden delta ${gRow.delta} (|gap| ${Math.abs(gRow.delta - target).toFixed(4)}) lost to ${sel.winner.delta} (|gap| ${Math.abs(sel.winner.delta - target).toFixed(4)}); winner ${aPick.contractId}`,
  );
}
