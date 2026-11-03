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
 * plus unconfirmed flagged suspects (Task #227, re-seeded via forceRefetch)
 * is passed to the planner as explicit `items` (one source of truth — no
 * excluded-keys recompute, no second calendar evaluation inside the
 * planner). One `options_corpus_runs` doc per sweep: item docs = dispatched
 * entries only (no dead pending docs for suppressed entries), `perSymbol`
 * records the planned/present/missing/enqueued counts after dispatch.
 *
 * Side-effect-free seam: all reads/writes/enqueues are injected deps.
 */
import {
  OPTIONS_CORPUS_RUNS_COLLECTION,
  corpusItemKey,
  type CorpusItemKey,
  type CorpusItemKind,
  type CorpusObjectRef,
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
  /** Task #227: suspect chains re-seeded via forceRefetch. */
  flagged: number;
  /** Task #227: upstream-confirmed thin chains logged, not re-seeded. */
  thinChains: number;
  failed: string[];
}

export interface CorpusReconcileDeps {
  /** Live curation set — read fresh every sweep. */
  listEnabledSymbols: () => Promise<string[]>;
  /** TradingCalendarService.getTradingDates bound — expected dates in the window. */
  listExpectedDates: (startDate: string, endDate: string) => Promise<string[]>;
  /** Stored corpus object refs for a symbol (GcsCorpusAdapter.listItems —
   *  carries kind + Task #227 chainFlag/chainFlagConfirmed metadata). */
  listObjects: (symbol: string) => Promise<CorpusObjectRef[]>;
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
    flagged: 0,
    thinChains: 0,
    failed: [],
  };

  // The dispatch manifest: gaps that survive live-queue suppression. This
  // list — not a recomputed product — is what the planner persists and what
  // dispatch enqueues, so counts can never disagree with what landed.
  const manifest: CorpusItemKey[] = [];
  // Task #227: manifest entries dispatched for suspect chains get
  // forceRefetch so the worker refetches past the GCS-hit shortcut. The
  // value carries the flagged object's kind so the healed rewrite keeps
  // its pivot provenance (interim objects stay supersede-eligible).
  // null = forced with no kind; absent key = not forced.
  const forced = new Map<string, CorpusItemKind | null>();

  const expectedSet = new Set(expected);
  const CHUNK = 10;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    await Promise.all(
      symbols.slice(i, i + CHUNK).map(async (symbol) => {
        try {
          const refs = await deps.listObjects(symbol);
          const covered = new Set(refs.map((r) => r.date));
          const gaps = expected.filter((date) => !covered.has(date));
          // Task #227: flagged objects inside the window are suspect coverage —
          // unconfirmed ones are gap-eligible for re-seed, confirmed ones are
          // logged as known thin chains (not retried forever).
          const suspect = refs.filter(
            (r) => r.chainFlag && expectedSet.has(r.date),
          );
          const unconfirmed = suspect.filter((r) => !r.chainFlagConfirmed);
          const confirmed = suspect.filter((r) => r.chainFlagConfirmed);

          // Run-item state is only needed to suppress live-queued gaps and
          // suspect re-seeds — a fully-covered healthy symbol costs one GCS
          // list and no Firestore scan.
          const latestByDate = gaps.length > 0 || unconfirmed.length > 0
            ? latestItemsByDate(await deps.listRunItems(symbol))
            : new Map<string, CoverageRunItem>();

          let enqueued = 0;
          // A pending/in_progress item in a live run already owns this date.
          // (An item in 'failure' awaiting the worker's own retry enqueue is
          // NOT live — a same-window re-dispatch loses to a gcs-hit anyway,
          // and the 22:30 slot makes collision rare.)
          const tryDispatch = (date: string, suspectRef?: CorpusObjectRef): boolean => {
            const latest = latestByDate.get(date);
            if (latest && isLiveQueueEntry(latest, nowMs)) {
              result.suppressed += 1;
              return false;
            }
            manifest.push({ symbol, date });
            if (suspectRef) {
              forced.set(corpusItemKey({ symbol, date }), suspectRef.kind ?? null);
            }
            enqueued += 1;
            return true;
          };
          for (const date of gaps) {
            tryDispatch(date);
          }
          let flagged = 0;
          for (const ref of unconfirmed) {
            if (tryDispatch(ref.date, ref)) flagged += 1;
          }
          for (const ref of confirmed) {
            logger.info(
              `corpus-reconcile ${symbol}: thin-chain ${ref.date} ${ref.chainFlag}` +
                ' — upstream-confirmed, not re-seeding',
            );
          }
          result.totalGaps += gaps.length;
          result.flagged += flagged;
          const thinChains = confirmed.length;
          result.thinChains += thinChains;
          const missing = gaps.length;
          const present = expected.length - gaps.length;
          result.perSymbol[symbol] = {
            planned: expected.length,
            present,
            missing,
            enqueued,
            ...(flagged > 0 ? { flagged } : {}),
            ...(thinChains > 0 ? { thinChains } : {}),
          };
          // PRD story 8: per-symbol reconcile line — planned/covered/missing/
          // enqueued is auditable from logs, not only the run doc.
          logger.info(
            `corpus-reconcile ${symbol}: planned=${expected.length} ` +
              `present=${present} missing=${missing} enqueued=${enqueued}` +
              (flagged > 0 ? ` flagged=${flagged}` : '') +
              (thinChains > 0 ? ` thinChains=${thinChains}` : ''),
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
      plan.items.slice(i, i + DISPATCH_CHUNK).map((item) => {
        const forcedKind = forced.get(corpusItemKey(item));
        return deps.enqueueSeed({
          runId, symbol: item.symbol, date: item.date, attempt: 1,
          ...(forcedKind !== undefined ? { forceRefetch: true } : {}),
          ...(forcedKind ? { kind: forcedKind } : {}),
        });
      }),
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
