import {
  OPTIONS_CORPUS_RUNS_COLLECTION,
  type CorpusItemKey,
} from '../types';
import { CorpusMetadataService, type CorpusRunPlan } from './corpus-metadata.service';
import { TradingCalendarService } from './trading-calendar.service';

export interface PlanCorpusRunOptions {
  symbols: string[];
  startDate: string;
  endDate: string;
  runId?: string;
  /** Maximum trading dates per symbol. When omitted, all trading dates are included. */
  maxTradingDatesPerSymbol?: number;
  /** When true, the plan writes metadata but never dispatches AV calls. */
  dryRun?: boolean;
  /** When true, this is a bounded pilot run. */
  pilot?: boolean;
  /**
   * Explicit item manifest — when provided, the plan persists exactly these
   * (symbol, date) pairs and the computed-mode options
   * (`maxTradingDatesPerSymbol`, `calendar`) are unused. Items must belong
   * to `symbols` — `listItemsForSymbol` finds run items via the run doc's
   * `symbols` array-contains index. Used by the reconcile sweep, whose
   * coverage diff has already decided the dispatch set (Task #220).
   */
  items?: CorpusItemKey[];
  calendar?: TradingCalendarService;
  metadata?: CorpusMetadataService;
}

/**
 * Idempotent planner for historical-options corpus runs.
 *
 * Builds a manifest of symbol+date pairs using a verified US trading calendar,
 * optionally bounded per symbol. If `metadata` and `runId` are provided and the
 * run already exists, the existing plan is returned unchanged.
 */
export async function planCorpusRun(
  options: PlanCorpusRunOptions,
): Promise<CorpusRunPlan> {
  const {
    symbols,
    startDate,
    endDate,
    runId,
    maxTradingDatesPerSymbol,
    dryRun = false,
    pilot = false,
    items: manifest,
    calendar = new TradingCalendarService(),
    metadata,
  } = options;

  const normalizedSymbols = symbols.map((s) => s.toUpperCase());
  const effectiveRunId =
    runId ?? generateRunId(normalizedSymbols, startDate, endDate, maxTradingDatesPerSymbol, dryRun, pilot);

  if (metadata) {
    const existingRun = await metadata.getRunDoc(effectiveRunId);
    if (existingRun) {
      const items = await metadata.listItems(effectiveRunId);
      return {
        runId: effectiveRunId,
        symbols: existingRun.symbols,
        startDate: existingRun.startDate,
        endDate: existingRun.endDate,
        totalItems: existingRun.totalItems,
        items: items.map((it) => ({ symbol: it.data.symbol, date: it.data.date })),
        dryRun: existingRun.dryRun,
        pilot: existingRun.pilot,
      };
    }
  }

  const items: CorpusItemKey[] = manifest ?? (() => {
    const tradingDates = calendar.getTradingDates(startDate, endDate);
    const datesPerSymbol = maxTradingDatesPerSymbol
      ? tradingDates.slice(0, maxTradingDatesPerSymbol)
      : tradingDates;

    const out: CorpusItemKey[] = [];
    for (const symbol of normalizedSymbols) {
      for (const date of datesPerSymbol) {
        out.push({ symbol, date });
      }
    }
    return out;
  })();

  const plan: CorpusRunPlan = {
    runId: effectiveRunId,
    symbols: normalizedSymbols,
    startDate,
    endDate,
    totalItems: items.length,
    items,
    dryRun,
    pilot,
  };

  if (metadata) {
    await metadata.createRunPlan(plan);
  }

  return plan;
}

function generateRunId(
  symbols: string[],
  startDate: string,
  endDate: string,
  maxTradingDatesPerSymbol: number | undefined,
  dryRun: boolean,
  pilot: boolean,
): string {
  const parts = [OPTIONS_CORPUS_RUNS_COLLECTION, symbols.join('-'), startDate, endDate];
  if (maxTradingDatesPerSymbol !== undefined) {
    parts.push(`md${maxTradingDatesPerSymbol}`);
  }
  if (dryRun) {
    parts.push('dry');
  }
  const suffix = pilot ? '-pilot' : '';
  return `${parts.join('-')}${suffix}`;
}
