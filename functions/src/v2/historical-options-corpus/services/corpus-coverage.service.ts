/**
 * Task #156: corpus coverage report — read-only, computed-live surface.
 *
 * For each requested symbol, diffs the swing-doc pivot plan (planPivotSeeds)
 * against stored corpus objects (GcsCorpusAdapter.listItems) and folds in the
 * latest `options_corpus_runs` item status per date. The result answers, per
 * date: seeded (stored), missing (uncovered — never attempted, a stale
 * success whose object was since deleted, a skipped curation drop, or a
 * queue entry left behind by a dead run), failed (latest run item
 * terminal), in_flight (pending/in_progress inside a live run),
 * superseded_interim (stored interim no longer in the plan — pending sweep
 * delete), pre_floor (stored object below the 2019 corpus floor — the sweep
 * deletes these regardless of provenance), or unplanned (stored object
 * outside the pivot plan — nightly/pilot provenance).
 *
 * Zero writes: every dep is a read. A write-side mirror doc could drift; the
 * on-demand diff is provably true at read time.
 */
import { getStorage } from 'firebase-admin/storage';

import {
  OPTIONS_CORPUS_FLOOR_DATE,
  optionsCorpusBucket,
  type CorpusItemKind,
  type CorpusItemStatus,
  type CorpusRunDoc,
} from '../types';
import { normalizeSymbolList } from '../../common/http-admin';
import { CorpusMetadataService } from './corpus-metadata.service';
import { GcsCorpusAdapter, type GcsCorpusObjectRef } from './gcs-corpus-adapter.service';
import { listOptionsEnabledSymbols } from './options-enabled-gate';
import {
  createPivotPlannerDeps,
  planPivotSeeds,
  type PivotWorkItem,
} from './pivot-work-planner';

/** Per-date coverage classification emitted by the report. */
export type CoverageDateStatus =
  /** Planned date with a stored object. */
  | 'seeded'
  /** Planned date not covered and nothing live is queued — never attempted,
   *  stale success whose object was deleted since (swept interim,
   *  out-of-band delete), skipped curation drop, or a pending/in_progress
   *  item left behind by a terminal run. */
  | 'missing'
  /** Planned date whose latest run item is a terminal failure. */
  | 'failed'
  /** Planned date with a pending/in_progress run item. */
  | 'in_flight'
  /** Stored interim no longer in the plan — the sweep deletes these. */
  | 'superseded_interim'
  /** Stored object below the corpus floor — the sweep deletes these. */
  | 'pre_floor'
  /** Stored object outside the plan (nightly/pilot/unknown provenance). */
  | 'unplanned';

export interface CoverageDateRow {
  date: string;
  status: CoverageDateStatus;
  /** Kind from the pivot plan when the date is planned. */
  plannedKind?: CorpusItemKind;
  /** Provenance stamp on the stored object when present. */
  objectKind?: CorpusItemKind;
  /** Latest `options_corpus_runs` item status for uncovered planned dates. */
  runStatus?: CorpusItemStatus;
  /** Owning run doc's status — distinguishes a live queue entry from a dead
   *  run's leftover item. */
  runState?: CorpusRunDoc['status'];
  /** Latest run-item error (failed rows). */
  error?: string;
}

export interface CorpusCoverageSymbolReport {
  symbol: string;
  /** Live curation flag — reported, not gated (read-only surface). */
  optionsEnabled: boolean;
  planned: number;
  seeded: number;
  missing: number;
  failed: number;
  inFlight: number;
  /** Stored objects outside the plan (superseded_interim + pre_floor +
   *  unplanned). */
  unplanned: number;
  /** Latest interim-kind planned date, or null when the plan has none. */
  currentInterimDate: string | null;
  dates: CoverageDateRow[];
  /** Per-symbol failure — the report continues past it. */
  error?: string;
}

export interface CorpusCoverageReport {
  generatedAt: string;
  symbols: CorpusCoverageSymbolReport[];
}

/** Latest run-item projection for one (symbol, date) — ordering via touchedAtMs. */
export interface CoverageRunItem {
  date: string;
  status: CorpusItemStatus;
  /** Owning run doc's status — terminal runs leave dead queue entries. */
  runState?: CorpusRunDoc['status'];
  /** Millis of the item's last touch (completedAt ?? attemptedAt ??
   *  run createdAt). */
  touchedAtMs: number;
  error?: string;
}

export interface CorpusCoverageDeps {
  /** Live options-enabled universe — the default report set + enabled flag. */
  listEnabledSymbols: () => Promise<string[]>;
  /** planPivotSeeds bound to its planner deps. */
  planPivots: (symbol: string) => Promise<PivotWorkItem[]>;
  /** GcsCorpusAdapter.listItems bound to the corpus bucket. */
  listObjects: (symbol: string) => Promise<GcsCorpusObjectRef[]>;
  /** All `options_corpus_runs` items for a symbol, newest-decidable. */
  listRunItems: (symbol: string) => Promise<CoverageRunItem[]>;
  /** Clock override for staleness checks — tests inject a fixed now. */
  nowMs?: () => number;
  logger?: { info(m: string): void; warn(m: string): void };
}

/** Run-item statuses that mean a real fetch failure needing a re-seed.
 *  `success`/`skipped` are deliberately absent — they mean "not stored" and
 *  classify as `missing`, not `failed`. */
const TERMINAL_FAILURE: ReadonlySet<CorpusItemStatus> = new Set([
  'failure',
  'permanent_failure',
  'not_found',
]);

/** Run statuses where a leftover pending/in_progress item is dead weight —
 *  nothing is queued, the queue doc just wasn't cleaned up. */
const DEAD_RUN: ReadonlySet<CorpusRunDoc['status']> = new Set([
  'completed',
  'failed',
]);

/** Queue entries untouched longer than this are dead, not in-flight. Runs
 *  are never reconciled to a terminal state after their items finish, so
 *  without an age bound a crashed/abandoned run's pending items would
 *  report in_flight forever. 24h is far past any legit queue residency —
 *  seed tasks retry for minutes, not days. */
const STALE_QUEUE_MS = 24 * 60 * 60 * 1000;

const upper = (s: string) => s.trim().toUpperCase();

function emptySymbolReport(
  symbol: string,
  optionsEnabled: boolean,
  error?: string,
): CorpusCoverageSymbolReport {
  return {
    symbol,
    optionsEnabled,
    planned: 0,
    seeded: 0,
    missing: 0,
    failed: 0,
    inFlight: 0,
    unplanned: 0,
    currentInterimDate: null,
    dates: [],
    ...(error ? { error } : {}),
  };
}

async function computeSymbolCoverage(
  symbol: string,
  optionsEnabled: boolean,
  deps: CorpusCoverageDeps,
  nowMs: number,
): Promise<CorpusCoverageSymbolReport> {
  const [items, objects, runItems] = await Promise.all([
    deps.planPivots(symbol),
    deps.listObjects(symbol),
    deps.listRunItems(symbol),
  ]);

  const objectByDate = new Map(objects.map((o) => [o.date, o]));
  const plannedByDate = new Map(items.map((i) => [i.date, i]));
  const latestRunItem = new Map<string, CoverageRunItem>();
  for (const item of runItems) {
    const prev = latestRunItem.get(item.date);
    if (!prev || item.touchedAtMs >= prev.touchedAtMs) latestRunItem.set(item.date, item);
  }

  const allDates = new Set<string>([
    ...items.map((i) => i.date),
    ...objects.map((o) => o.date),
  ]);

  const report: CorpusCoverageSymbolReport = {
    ...emptySymbolReport(symbol, optionsEnabled),
    planned: items.length,
  };

  for (const item of items) {
    if (item.kind === 'interim' && (report.currentInterimDate === null || item.date > report.currentInterimDate)) {
      report.currentInterimDate = item.date;
    }
  }

  for (const date of [...allDates].sort()) {
    const object = objectByDate.get(date);
    const planned = plannedByDate.get(date);
    const row: CoverageDateRow = { date, status: 'missing' };
    if (planned) row.plannedKind = planned.kind;
    if (object?.kind) row.objectKind = object.kind;

    if (object) {
      if (planned) {
        row.status = 'seeded';
        report.seeded += 1;
      } else {
        // Mirrors the fanout's delete predicate (pivot-seed-fanout): pre-floor
        // objects die regardless of provenance; interims die when unplanned.
        row.status = date < OPTIONS_CORPUS_FLOOR_DATE
          ? 'pre_floor'
          : object.kind === 'interim' ? 'superseded_interim' : 'unplanned';
        report.unplanned += 1;
      }
    } else if (planned) {
      const latest = latestRunItem.get(date);
      if (latest) {
        row.runStatus = latest.status;
        if (latest.runState) row.runState = latest.runState;
      }
      const liveQueue =
        latest !== undefined &&
        (latest.status === 'pending' || latest.status === 'in_progress') &&
        !(latest.runState !== undefined && DEAD_RUN.has(latest.runState)) &&
        nowMs - latest.touchedAtMs < STALE_QUEUE_MS;
      if (!latest || (!TERMINAL_FAILURE.has(latest.status) && !liveQueue)) {
        // Never attempted; success/skipped without a stored object; or a
        // stale queue entry in a dead run — either way, a live coverage gap.
        report.missing += 1;
      } else if (liveQueue) {
        row.status = 'in_flight';
        report.inFlight += 1;
      } else {
        row.status = 'failed';
        if (latest.error) row.error = latest.error;
        report.failed += 1;
      }
    }
    // !object && !planned can't happen — the union comes from those two sets.
    report.dates.push(row);
  }

  return report;
}

/**
 * Computes the live coverage report. `symbols === undefined` reports every
 * options-enabled symbol; a supplied subset is reported verbatim (including
 * non-enabled symbols — flagged, not dropped, since reads cost nothing).
 */
export async function runCorpusCoverage(
  symbols: string[] | undefined,
  deps: CorpusCoverageDeps,
): Promise<CorpusCoverageReport> {
  const enabled = new Set((await deps.listEnabledSymbols()).map(upper));
  // normalizeSymbolList shared with the HTTP layer — the service also gets
  // non-HTTP callers (verify script), so the seam normalizes too.
  const requested = normalizeSymbolList(symbols ?? [...enabled]) ?? [];

  const report: CorpusCoverageReport = { generatedAt: new Date().toISOString(), symbols: [] };
  const nowMs = deps.nowMs?.() ?? Date.now();
  const CHUNK = 10;
  for (let i = 0; i < requested.length; i += CHUNK) {
    const rows = await Promise.all(
      requested.slice(i, i + CHUNK).map(async (symbol): Promise<CorpusCoverageSymbolReport> => {
        try {
          return await computeSymbolCoverage(symbol, enabled.has(symbol), deps, nowMs);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          deps.logger?.warn(`corpus-coverage: ${symbol} failed — ${error}`);
          return emptySymbolReport(symbol, enabled.has(symbol), error);
        }
      }),
    );
    report.symbols.push(...rows);
  }

  return report;
}

/**
 * Production deps: pivot planner over `options-swing-sets`, corpus GCS
 * listing, and an `array-contains` + per-run scan of `options_corpus_runs`
 * items (CorpusMetadataService.listItemsForSymbol).
 */
export function createCorpusCoverageDeps(): CorpusCoverageDeps {
  const planner = createPivotPlannerDeps();
  const gcs = new GcsCorpusAdapter(getStorage().bucket(optionsCorpusBucket()));
  const metadata = new CorpusMetadataService();
  return {
    listEnabledSymbols: listOptionsEnabledSymbols,
    planPivots: (symbol) => planPivotSeeds(symbol, planner),
    listObjects: (symbol) => gcs.listItems(symbol),
    listRunItems: async (symbol) =>
      (await metadata.listItemsForSymbol(symbol)).map((item) => ({
        date: item.data.date,
        status: item.data.status,
        runState: item.runState,
        touchedAtMs: item.touchedAtMs,
        ...(item.data.error ? { error: item.data.error } : {}),
      })),
    logger: console,
  };
}
