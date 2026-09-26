import { getFunctions } from 'firebase-admin/functions';

import { CorpusMetadataService, type CorpusRunPlan } from './corpus-metadata.service';
import { planCorpusRun, type PlanCorpusRunOptions } from './corpus-planner.service';
import { GcsCorpusAdapter } from './gcs-corpus-adapter.service';
import {
  OPTIONS_CORPUS_RUNS_COLLECTION,
  type CorpusItemKey,
  type CorpusSeedPayload,
} from '../types';
import { OPTIONS_CORPUS_SEED_TASK_QUEUE } from '../handlers/corpus-seed.task';
import type { HistoricalOptionsRetrievalService } from './historical-options-retrieval.service';
import { createPivotPlannerDeps, planPivotSeeds, type PivotWorkItem } from './pivot-work-planner';
import { TradingCalendarService } from './trading-calendar.service';
import { listOptionsEnabledSymbols } from './options-enabled-gate';

// Task #150: no hardcoded pilot symbols — an omitted `symbols` request
// defaults to the live options-enabled set (see options-enabled-gate).
export const DEFAULT_PILOT_START_DATE = '2019-01-01';
export const DEFAULT_PILOT_MAX_TRADING_DATES = 20;

export interface PilotOptions {
  symbols?: string[];
  startDate?: string;
  endDate?: string;
  maxTradingDatesPerSymbol?: number;
  referenceDate?: string;
  runId?: string;
  /**
   * 'calendar' (default): bounded trading-date window per symbol.
   * 'pivots' (Task #155): each symbol's corpus pivot dates via the swing-doc
   * planner — the operator backfill path; startDate/maxTradingDates ignored.
   */
  dateSource?: 'calendar' | 'pivots';
  /** When true, only plan and report; no AV calls or GCS writes. */
  dryRun?: boolean;
  /** When true and dryRun is false, dispatches Cloud Tasks to seed missing items. */
  execute?: boolean;
}

export interface PilotManifestItem {
  symbol: string;
  date: string;
  present: boolean;
  bytes?: number;
  sha256?: string;
}

/** Per-symbol backfill result row (Task #155 AC). */
export interface PilotSymbolReport {
  symbol: string;
  planned: number;
  /** Already covered in GCS. */
  present: number;
  /** Not covered — enqueued (or would-enqueue in dryRun). */
  missing: number;
  /** Seed tasks dispatched for this symbol (execute mode). */
  enqueued: number;
  /** Planner failure, if the symbol errored mid-run. */
  error?: string;
}

export interface PilotReport {
  runId: string;
  runPlan: CorpusRunPlan;
  symbols: string[];
  /** Requested symbols dropped because optionsEnabled !== true (Task #150). */
  skippedSymbols: string[];
  startDate: string;
  endDate: string;
  maxTradingDatesPerSymbol: number;
  dateSource: 'calendar' | 'pivots';
  perSymbol: PilotSymbolReport[];
  totalItems: number;
  presentItems: number;
  missingItems: number;
  estimatedApiCalls: number;
  dryRun: boolean;
  executed: boolean;
  manifest: PilotManifestItem[];
}

export interface PilotDependencies {
  /** Curation gate (Task #150): returns the live options-enabled universe —
   *  the default symbol set and the filter for explicit requests. */
  listOptionsEnabledSymbols: () => Promise<string[]>;
  metadata: CorpusMetadataService;
  gcs: GcsCorpusAdapter;
  calendar: TradingCalendarService;
  enqueueTask: (payload: CorpusSeedPayload) => Promise<void>;
  /**
   * Pivot planner seam (Task #155): returns the symbol's corpus work items
   * (confirmed + interim). Required for dateSource='pivots'.
   */
  planPivots?: (symbol: string) => Promise<PivotWorkItem[]>;
  retrieval?: HistoricalOptionsRetrievalService;
  /** Clock override for testing date math. */
  now?: () => Date;
}

/**
 * Bounded pilot runner for the options-enabled historical options corpus.
 *
 * By default it operates in dry-run mode: it plans a manifest of the earliest
 * N trading dates per symbol, checks GCS for existing coverage, and
 * produces a cost report without calling Alpha Vantage. When `execute` is true
 * it dispatches one Cloud Task per missing item.
 */
export class HistoricalOptionsPilotService {
  constructor(private readonly deps: PilotDependencies) {}

  async run(options: PilotOptions = {}): Promise<PilotReport> {
    const enabledSet = new Set((await this.deps.listOptionsEnabledSymbols()).map((s) => s.toUpperCase()));
    const requested = (options.symbols ?? [...enabledSet]).map((s) => s.toUpperCase());
    const symbols = requested.filter((s) => enabledSet.has(s));
    const skippedSymbols = requested.filter((s) => !enabledSet.has(s));
    if (skippedSymbols.length > 0) {
      console.warn('[pilot] dropped non-options-enabled symbols', { skippedSymbols });
    }
    const startDate = options.startDate ?? DEFAULT_PILOT_START_DATE;
    const referenceDate = options.referenceDate ?? options.endDate ?? this.yesterday();
    const maxTradingDatesPerSymbol = options.maxTradingDatesPerSymbol ?? DEFAULT_PILOT_MAX_TRADING_DATES;
    const dateSource = options.dateSource ?? 'calendar';
    const dryRun = options.dryRun ?? true;
    const execute = options.execute ?? false;

    if (symbols.length === 0) {
      const emptyPlan: CorpusRunPlan = {
        runId: options.runId ?? 'no-enabled-symbols',
        symbols: [],
        startDate,
        endDate: referenceDate,
        totalItems: 0,
        items: [],
        dryRun,
        pilot: true,
      };
      return {
        runId: emptyPlan.runId,
        runPlan: emptyPlan,
        symbols: [],
        skippedSymbols,
        startDate,
        endDate: referenceDate,
        maxTradingDatesPerSymbol,
        dateSource,
        perSymbol: [],
        totalItems: 0,
        presentItems: 0,
        missingItems: 0,
        estimatedApiCalls: 0,
        dryRun,
        executed: false,
        manifest: [],
      };
    }

    if (execute && dryRun) {
      throw new Error('Cannot execute a dry-run pilot; set dryRun=false to dispatch tasks.');
    }

    // Pivot-source date list: per-symbol planner output, kind kept for the
    // seed payload so interim snapshots carry their provenance stamp.
    const kindByKey = new Map<string, CorpusSeedPayload['kind']>();
    const perSymbol: PilotSymbolReport[] = [];

    let runPlan: CorpusRunPlan;
    if (dateSource === 'pivots') {
      if (!this.deps.planPivots) {
        throw new Error('dateSource=pivots requires a planPivots dependency');
      }
      const items: CorpusItemKey[] = [];
      const seen = new Set<string>();
      for (const symbol of symbols) {
        try {
          const planned = await this.deps.planPivots(symbol);
          let plannedCount = 0;
          for (const item of planned) {
            const key = `${item.symbol}_${item.date}`;
            if (seen.has(key)) continue; // defensive: planner already dedupes
            seen.add(key);
            items.push({ symbol: item.symbol, date: item.date });
            kindByKey.set(key, item.kind);
            plannedCount++;
          }
          perSymbol.push({ symbol, planned: plannedCount, present: 0, missing: 0, enqueued: 0 });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          console.warn(`[pilot] pivot plan failed for ${symbol} — ${error}`);
          perSymbol.push({ symbol, planned: 0, present: 0, missing: 0, enqueued: 0, error });
        }
      }
      const dates = items.map((i) => i.date).sort();
      runPlan = {
        runId: options.runId ?? `${OPTIONS_CORPUS_RUNS_COLLECTION}-pivots-${Date.now()}`,
        symbols,
        startDate: dates[0] ?? startDate,
        endDate: dates[dates.length - 1] ?? referenceDate,
        totalItems: items.length,
        items,
        dryRun,
        pilot: false,
      };
      // Run plan is persisted only when actually executing — dryRun is
      // zero-writes (Task #155 AC) and dryRun+execute=false would leave a
      // 'planned' run with pending items and no dispatch.
      if (execute) {
        await this.deps.metadata.createRunPlan(runPlan);
      }
    } else {
      const planOptions: PlanCorpusRunOptions = {
        symbols,
        startDate,
        endDate: referenceDate,
        maxTradingDatesPerSymbol,
        dryRun,
        pilot: true,
        calendar: this.deps.calendar,
        metadata: this.deps.metadata,
        runId: options.runId,
      };
      runPlan = await planCorpusRun(planOptions);
      for (const symbol of symbols) {
        perSymbol.push({ symbol, planned: 0, present: 0, missing: 0, enqueued: 0 });
      }
    }

    const manifest: PilotManifestItem[] = [];
    let presentItems = 0;
    let missingItems = 0;
    const symbolRow = (s: string) => perSymbol.find((p) => p.symbol === s);
    const itemKey = (s: string, d: string) => `${s}_${d}`;
    // Pivots mode removes the 20-dates/symbol bound — chunked parallel scans
    // keep the coverage diff inside the callable timeout (same as fanout).
    const CHUNK = 20;

    for (let i = 0; i < runPlan.items.length; i += CHUNK) {
      const results = await Promise.all(
        runPlan.items.slice(i, i + CHUNK).map(async (item) => ({
          item,
          storedMetadata: await this.deps.gcs.getMetadata(item.symbol, item.date),
        })),
      );
      for (const { item, storedMetadata } of results) {
        const row = symbolRow(item.symbol);
        if (row && dateSource === 'calendar') row.planned += 1;
        if (storedMetadata) {
          presentItems += 1;
          if (row) row.present += 1;
          manifest.push({
            symbol: item.symbol,
            date: item.date,
            present: true,
            bytes: storedMetadata.bytes,
            sha256: storedMetadata.sha256,
          });
        } else {
          missingItems += 1;
          if (row) row.missing += 1;
          manifest.push({ symbol: item.symbol, date: item.date, present: false });
        }
      }
    }

    let executed = false;
    if (execute) {
      const manifestByKey = new Map(manifest.map((m) => [itemKey(m.symbol, m.date), m]));
      const missing = runPlan.items.filter(
        (item) => manifestByKey.get(itemKey(item.symbol, item.date))?.present === false,
      );
      // Status BEFORE dispatch (fanout convention): a mid-dispatch failure
      // leaves a 'in_progress' run, not an orphaned 'planned' one. All-covered
      // → 'completed', nothing will drive it further.
      await this.deps.metadata.markRunStatus(
        runPlan.runId,
        missing.length === 0 ? 'completed' : 'in_progress',
      );
      for (let i = 0; i < missing.length; i += CHUNK) {
        await Promise.all(
          missing.slice(i, i + CHUNK).map((item) =>
            this.deps.enqueueTask({
              runId: runPlan.runId,
              symbol: item.symbol,
              date: item.date,
              attempt: 1,
              kind: kindByKey.get(itemKey(item.symbol, item.date)),
            }),
          ),
        );
      }
      for (const item of missing) {
        const row = symbolRow(item.symbol);
        if (row) row.enqueued += 1;
      }
      executed = true;
    }

    return {
      runId: runPlan.runId,
      runPlan,
      symbols: runPlan.symbols,
      skippedSymbols,
      startDate: runPlan.startDate,
      endDate: runPlan.endDate,
      maxTradingDatesPerSymbol,
      dateSource,
      perSymbol,
      totalItems: runPlan.totalItems,
      presentItems,
      missingItems,
      estimatedApiCalls: missingItems,
      dryRun,
      executed,
      manifest,
    };
  }

  private yesterday(): string {
    const now = this.deps.now?.() ?? new Date();
    const today = this.partsEt(now);
    const yesterday = new Date(
      Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) - 1, 12, 0, 0),
    );
    return this.formatIsoEt(yesterday);
  }

  private partsEt(d: Date): { year: string; month: string; day: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? '';
    return { year: get('year'), month: get('month'), day: get('day') };
  }

  private formatIsoEt(d: Date): string {
    const { year, month, day } = this.partsEt(d);
    return `${year}-${month}-${day}`;
  }
}

/**
 * Factory that wires the pilot to runtime dependencies.
 *
 * The bucket name is read from `OPTIONS_CORPUS_BUCKET`. When running against
 * the emulator this can be omitted if `STORAGE_EMULATOR_HOST` is set.
 */
export function createHistoricalOptionsPilotService(
  bucketName?: string,
): HistoricalOptionsPilotService {
  const { getStorage } = require('firebase-admin/storage');
  const bucket = getStorage().bucket(bucketName ?? process.env.OPTIONS_CORPUS_BUCKET);

  const pivotDeps = createPivotPlannerDeps();
  return new HistoricalOptionsPilotService({
    listOptionsEnabledSymbols,
    metadata: new CorpusMetadataService(),
    gcs: new GcsCorpusAdapter(bucket),
    calendar: new TradingCalendarService(),
    planPivots: (symbol) => planPivotSeeds(symbol, pivotDeps),
    enqueueTask: async (payload) => {
      const queue = getFunctions().taskQueue(OPTIONS_CORPUS_SEED_TASK_QUEUE);
      await queue.enqueue(payload);
    },
  });
}
