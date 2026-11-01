/**
 * runCorpusReconcile — standing coverage reconciler (Task #220).
 *
 * Scheduled sweep over the live options-enabled universe: diffs expected
 * trading days in the daily-coverage window against stored corpus objects
 * and re-enqueues seed tasks for genuine gaps — the self-healing path for
 * terminal seed holes (e.g. SNDK/2026-09-21).
 *
 * A gap already live-queued (pending/in_progress in a non-terminal run,
 * touched within the stale-queue window) is suppressed — the coverage
 * service's own liveQueue predicate, so a re-run never double-dispatches
 * work a prior sweep or nightly already queued. Terminal failures, dead-run
 * leftovers, and stale queue entries DO re-enqueue — that is the heal.
 *
 * The diff produces the dispatch manifest directly: the surviving gap list
 * is passed to the planner as explicit `items` (one source of truth — no
 * excluded-keys recompute, no second calendar evaluation inside the
 * planner). One `options_corpus_runs` doc per sweep: item docs = dispatched
 * gaps only (no dead pending docs for suppressed entries), `perSymbol`
 * records the planned/present/missing/enqueued counts after dispatch.
 *
 * Side-effect-free seam: all reads/writes/enqueues are injected deps.
 */
import {
  OPTIONS_CORPUS_RUNS_COLLECTION,
  type CorpusItemKey,
  type CorpusReconcileSymbolCounts,
  type CorpusRunDoc,
  type CorpusSeedPayload,
} from '../types';
import {
  isLiveQueueEntry,
  latestItemsByDate,
  type CoverageRunItem,
} from './corpus-coverage.service';
import type { CorpusRunPlan } from './corpus-metadata.service';
import type { PlanCorpusRunOptions } from './corpus-planner.service';

export interface CorpusReconcileResult {
  runId: string;
  /** Expected trading days per symbol (shared window). */
  expectedDates: number;
  symbols: string[];
  perSymbol: Record<string, CorpusReconcileSymbolCounts>;
  totalGaps: number;
  enqueued: number;
  /** Gaps skipped because a live run already has them queued. */
  suppressed: number;
  failed: string[];
}

export interface CorpusReconcileDeps {
  /** Live curation set — read fresh every sweep. */
  listEnabledSymbols: () => Promise<string[]>;
  /** TradingCalendarService.getTradingDates bound — expected dates in the window. */
  listExpectedDates: (startDate: string, endDate: string) => Promise<string[]>;
  /** Stored corpus object dates for a symbol (GcsCorpusAdapter.listItems). */
  listObjectDates: (symbol: string) => Promise<string[]>;
  /** Latest-decidable run items for a symbol (live-queue suppression). */
  listRunItems: (symbol: string) => Promise<CoverageRunItem[]>;
  /** planCorpusRun bound — persists the run doc + item docs for the manifest. */
  planRun: (options: PlanCorpusRunOptions) => Promise<CorpusRunPlan>;
  markRunStatus: (runId: string, status: CorpusRunDoc['status']) => Promise<void>;
  updateRunSummary: (runId: string, perSymbol: Record<string, CorpusReconcileSymbolCounts>) => Promise<void>;
  enqueueSeed: (payload: CorpusSeedPayload) => Promise<void>;
  runId?: string;
  nowMs?: () => number;
  logger?: { info(m: string): void; warn(m: string): void };
}

export async function runCorpusReconcile(
  deps: CorpusReconcileDeps,
  coverageWindow: { startDate: string; endDate: string },
): Promise<CorpusReconcileResult> {
  const logger = deps.logger ?? console;
  const nowMs = deps.nowMs?.() ?? Date.now();
  const runId = deps.runId ?? `${OPTIONS_CORPUS_RUNS_COLLECTION}-reconcile-${nowMs}`;

  const symbols = (await deps.listEnabledSymbols())
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const expected = await deps.listExpectedDates(coverageWindow.startDate, coverageWindow.endDate);

  const result: CorpusReconcileResult = {
    runId,
    expectedDates: expected.length,
    symbols,
    perSymbol: {},
    totalGaps: 0,
    enqueued: 0,
    suppressed: 0,
    failed: [],
  };

  // The dispatch manifest: gaps that survive live-queue suppression. This
  // list — not a recomputed product — is what the planner persists and what
  // dispatch enqueues, so counts can never disagree with what landed.
  const manifest: CorpusItemKey[] = [];

  const CHUNK = 10;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    await Promise.all(
      symbols.slice(i, i + CHUNK).map(async (symbol) => {
        try {
          const covered = new Set(await deps.listObjectDates(symbol));
          const gaps = expected.filter((date) => !covered.has(date));
          // Run-item state is only needed to suppress live-queued gaps — a
          // fully-covered symbol costs one GCS list and no Firestore scan.
          const latestByDate = gaps.length > 0
            ? latestItemsByDate(await deps.listRunItems(symbol))
            : new Map<string, CoverageRunItem>();

          let enqueued = 0;
          for (const date of gaps) {
            const latest = latestByDate.get(date);
            // A pending/in_progress item in a live run already owns this
            // gap. (An item in 'failure' awaiting the worker's own retry
            // enqueue is NOT live — a same-window re-dispatch loses to a
            // gcs-hit anyway, and the 22:30 slot makes collision rare.)
            if (latest && isLiveQueueEntry(latest, nowMs)) {
              result.suppressed += 1;
              continue;
            }
            manifest.push({ symbol, date });
            enqueued += 1;
          }
          result.totalGaps += gaps.length;
          const missing = gaps.length;
          const present = expected.length - gaps.length;
          result.perSymbol[symbol] = {
            planned: expected.length,
            present,
            missing,
            enqueued,
          };
          // PRD story 8: per-symbol reconcile line — planned/covered/missing/
          // enqueued is auditable from logs, not only the run doc.
          logger.info(
            `corpus-reconcile ${symbol}: planned=${expected.length} ` +
              `present=${present} missing=${missing} enqueued=${enqueued}`,
          );
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          logger.warn(`corpus-reconcile: ${symbol} diff failed — ${error}`);
          // Coverage unverifiable → the symbol contributes nothing to the
          // manifest; a failed listing must never stampede unverified seeds.
          result.perSymbol[symbol] = {
            planned: expected.length,
            present: 0,
            missing: 0,
            enqueued: 0,
            error,
          };
          result.failed.push(symbol);
        }
      }),
    );
  }

  // Status before dispatch (pilot convention): a mid-dispatch failure
  // leaves an in_progress run, not an orphaned 'planned' one.
  const plan = await deps.planRun({
    symbols,
    startDate: coverageWindow.startDate,
    endDate: coverageWindow.endDate,
    items: manifest,
    dryRun: false,
    pilot: false,
    runId,
  });
  await deps.markRunStatus(runId, plan.items.length === 0 ? 'completed' : 'in_progress');

  // Dispatch gaps; the seed worker re-checks GCS so a chain stored between
  // the diff and dispatch resolves as a cheap gcs-hit.
  const DISPATCH_CHUNK = 20;
  for (let i = 0; i < plan.items.length; i += DISPATCH_CHUNK) {
    await Promise.all(
      plan.items.slice(i, i + DISPATCH_CHUNK).map((item) =>
        deps.enqueueSeed({ runId, symbol: item.symbol, date: item.date, attempt: 1 }),
      ),
    );
  }
  result.enqueued = plan.items.length;

  await deps.updateRunSummary(runId, result.perSymbol);

  logger.info(
    `corpus-reconcile done — runId=${runId} symbols=${symbols.length} ` +
      `expected=${expected.length} gaps=${result.totalGaps} enqueued=${result.enqueued} ` +
      `suppressed=${result.suppressed} failed=${result.failed.length}`,
  );
  return result;
}
