/**
 * Pick materialization core (Thread #214 / Task #223).
 *
 * Walks a symbol's stored historical-options corpus dates; for each date
 * loads the chain once, runs `pickCellsForDate` (or `noChainPickEntries`
 * when the chain is absent), accumulates the per-cell entries, then merges
 * every cell's day map into its cell-year doc via `mergeDayEntries`.
 *
 * Pure/seam design: GCS listing + chain loading, underlying closes, and
 * Firestore are injected so the picker→writer fanout is unit-testable and
 * zero AV calls are possible by construction.
 *
 * Idempotent by composition: the writer skips picked dates and repairs
 * miss-status dates, so a re-run of a fully materialized symbol is a
 * read-only no-op — which is also the self-repair path for `no_chain`.
 */
import type { Firestore } from 'firebase-admin/firestore';

import type { AvOptionContract } from '@shared/alpha-vantage';
import type { DayPickEntry } from '@shared/options';

import { noChainPickEntries, pickCellsForDate } from './options-delta-picker.service';
import { mergeDayEntries } from './options-delta-pick-cell.writer';

/** Corpus floor — materialization never visits dates before the 2026 ingest. */
export const PICK_MATERIALIZE_FLOOR_DATE = '2026-01-01';

export interface PickMaterializeRequest {
  symbol: string;
  /**
   * Explicit dates to materialize (nightly append / single-date repair).
   * When omitted, every stored corpus date for the symbol is walked.
   */
  dates?: readonly string[];
}

export interface PickMaterializeLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface PickMaterializeDeps {
  /** Firestore handle passed through to `mergeDayEntries`. */
  db: Firestore;
  /** Dates of the symbol's stored corpus objects (any order; core sorts). */
  listCorpusDates: (symbol: string) => Promise<readonly string[]>;
  /**
   * The stored chain for (symbol, date); `undefined` when the object is
   * absent (→ `no_chain` entries). Throwing marks the date a load failure
   * and the walk continues — a corrupt object never aborts the symbol.
   */
  loadChain: (
    symbol: string,
    date: string,
  ) => Promise<readonly AvOptionContract[] | undefined>;
  /**
   * Underlying adjusted closes indexed by date. A throw is degraded to an
   * empty map (closes are optional on picks) with a warn log.
   */
  loadCloses: (symbol: string) => Promise<ReadonlyMap<string, number>>;
  logger?: PickMaterializeLogger;
}

export interface PickMaterializeReport {
  symbol: string;
  /** Dates visited after floor-filter/sort/dedupe. */
  datesSeen: number;
  /** Chains loaded and run through the picker. */
  datesPicked: number;
  /** Dates whose chain was absent — `no_chain` entries emitted. */
  datesNoChain: number;
  /** Dates whose chain load threw — skipped, re-runnable next pass. */
  loadFailures: string[];
  /** Cell-year docs that wrote at least one day. */
  cellDocsTouched: number;
  /** Day entries written across all cells. */
  daysWritten: number;
  /** Day entries skipped (already equal-or-better) across all cells. */
  daysSkipped: number;
}

function resolveDates(
  req: PickMaterializeRequest,
  listed: readonly string[] | undefined,
): string[] {
  const raw = req.dates ?? listed ?? [];
  const deduped = new Set<string>();
  for (const d of raw) {
    if (d >= PICK_MATERIALIZE_FLOOR_DATE) deduped.add(d);
  }
  return [...deduped].sort();
}

export async function materializeSymbolPicks(
  req: PickMaterializeRequest,
  deps: PickMaterializeDeps,
): Promise<PickMaterializeReport> {
  const symbol = req.symbol.trim().toUpperCase();
  const dates = resolveDates(
    req,
    req.dates === undefined ? await deps.listCorpusDates(symbol) : undefined,
  );

  const report: PickMaterializeReport = {
    symbol,
    datesSeen: dates.length,
    datesPicked: 0,
    datesNoChain: 0,
    loadFailures: [],
    cellDocsTouched: 0,
    daysWritten: 0,
    daysSkipped: 0,
  };
  if (dates.length === 0) return report;

  let closes: ReadonlyMap<string, number>;
  try {
    closes = await deps.loadCloses(symbol);
  } catch (error) {
    deps.logger?.warn('pick-materialize: closes load failed — picks omit underlyingClose', {
      symbol,
      error: String((error as Error)?.message ?? error),
    });
    closes = new Map();
  }

  // Accumulate per-cell day entries across all dates, then merge once per
  // cell — 380 transactions total instead of 380 per date.
  const cells = new Map<string, Map<string, DayPickEntry>>();
  for (const date of dates) {
    let chain: readonly AvOptionContract[] | undefined;
    try {
      chain = await deps.loadChain(symbol, date);
    } catch (error) {
      report.loadFailures.push(date);
      deps.logger?.warn('pick-materialize: chain load failed — date skipped', {
        symbol,
        date,
        error: String((error as Error)?.message ?? error),
      });
      continue;
    }

    const close = closes.get(date);
    const entries =
      chain === undefined
        ? (report.datesNoChain++, noChainPickEntries(symbol, close))
        : (report.datesPicked++, pickCellsForDate(chain.slice(), close, date, symbol));

    for (const [cellId, entry] of entries) {
      let days = cells.get(cellId);
      if (!days) cells.set(cellId, (days = new Map()));
      days.set(date, entry);
    }
  }

  for (const [cellId, days] of cells) {
    const merged = await mergeDayEntries(deps.db, cellId, days);
    report.daysWritten += merged.written.length;
    report.daysSkipped += merged.skipped.length;
    if (merged.written.length > 0) report.cellDocsTouched += 1;
  }

  deps.logger?.info('pick-materialize: symbol materialized', { ...report });
  return report;
}
