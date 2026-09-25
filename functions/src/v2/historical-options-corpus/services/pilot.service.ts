import { getFunctions } from 'firebase-admin/functions';

import { CorpusMetadataService, type CorpusRunPlan } from './corpus-metadata.service';
import { planCorpusRun, type PlanCorpusRunOptions } from './corpus-planner.service';
import { GcsCorpusAdapter } from './gcs-corpus-adapter.service';
import { OPTIONS_CORPUS_SEED_TASK_QUEUE } from '../handlers/corpus-seed.task';
import type { HistoricalOptionsRetrievalService } from './historical-options-retrieval.service';
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

export interface PilotReport {
  runId: string;
  runPlan: CorpusRunPlan;
  symbols: string[];
  /** Requested symbols dropped because optionsEnabled !== true (Task #150). */
  skippedSymbols: string[];
  startDate: string;
  endDate: string;
  maxTradingDatesPerSymbol: number;
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
  enqueueTask: (payload: { runId: string; symbol: string; date: string; attempt: number }) => Promise<void>;
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

    const runPlan = await planCorpusRun(planOptions);

    const manifest: PilotManifestItem[] = [];
    let presentItems = 0;
    let missingItems = 0;

    for (const item of runPlan.items) {
      const storedMetadata = await this.deps.gcs.getMetadata(item.symbol, item.date);
      const present = !!storedMetadata;
      if (present) {
        presentItems += 1;
        manifest.push({
          symbol: item.symbol,
          date: item.date,
          present: true,
          bytes: storedMetadata.bytes,
          sha256: storedMetadata.sha256,
        });
      } else {
        missingItems += 1;
        manifest.push({ symbol: item.symbol, date: item.date, present: false });
      }
    }

    let executed = false;
    if (execute) {
      for (const item of runPlan.items) {
        const manifestItem = manifest.find(
          (m) => m.symbol === item.symbol && m.date === item.date,
        );
        if (manifestItem && !manifestItem.present) {
          await this.deps.enqueueTask({
            runId: runPlan.runId,
            symbol: item.symbol,
            date: item.date,
            attempt: 1,
          });
        }
      }
      executed = true;
      await this.deps.metadata.markRunStatus(runPlan.runId, 'in_progress');
    }

    return {
      runId: runPlan.runId,
      runPlan,
      symbols: runPlan.symbols,
      skippedSymbols,
      startDate: runPlan.startDate,
      endDate: runPlan.endDate,
      maxTradingDatesPerSymbol,
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

  return new HistoricalOptionsPilotService({
    listOptionsEnabledSymbols,
    metadata: new CorpusMetadataService(),
    gcs: new GcsCorpusAdapter(bucket),
    calendar: new TradingCalendarService(),
    enqueueTask: async (payload) => {
      const queue = getFunctions().taskQueue(OPTIONS_CORPUS_SEED_TASK_QUEUE);
      await queue.enqueue(payload);
    },
  });
}
