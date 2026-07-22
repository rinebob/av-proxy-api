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
  /** Optional set of already-stored item keys to exclude from the plan. */
  existingItemKeys?: Set<string>;
  calendar?: TradingCalendarService;
  metadata?: CorpusMetadataService;
}

/**
 * Idempotent planner for QQQ/TQQQ historical-options corpus runs.
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
    existingItemKeys,
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

  const tradingDates = calendar.getTradingDates(startDate, endDate, { descending: true });
  const datesPerSymbol = maxTradingDatesPerSymbol
    ? tradingDates.slice(0, maxTradingDatesPerSymbol)
    : tradingDates;

  const items: CorpusItemKey[] = [];
  for (const symbol of normalizedSymbols) {
    for (const date of datesPerSymbol) {
      const key = `${symbol}_${date}`;
      if (existingItemKeys?.has(key)) continue;
      items.push({ symbol, date });
    }
  }

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
