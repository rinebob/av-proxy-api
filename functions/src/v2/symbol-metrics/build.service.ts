/**
 * MetricBuildService — one (symbol, date) through the pipeline:
 * corpus chain (GCS) → underlying close (sa-time-series) → METRIC_REGISTRY →
 * SymbolMetricsRepository year-shard write (Topic #158, Task #170).
 *
 * Deterministic skips — `written: false` when the corpus object is absent or
 * corrupt, the close bar isn't available (missing/interim), or every computer
 * declines. Nothing is invented: absent input → absent entry.
 */
import type { CorpusReadResult } from '../historical-options-corpus/types';
import type { DailyAdjustedBar } from '@shared/zigzag';
import type { SymbolMetricField } from '@shared/options';
import { computeDayMetrics } from './metrics/registry';
import type { SymbolMetricsRepository } from './services/symbol-metrics.repository';

export interface MetricBuildDeps {
  /** Corpus read seam — GcsCorpusAdapter in prod, fakes in tests. */
  gcs: { readItem(symbol: string, date: string): Promise<CorpusReadResult> };
  /** Close-bar seam — DailyAdjustedReader in prod. Split-adjusted `c` only;
   *  interim/missing bars surface as null. */
  bars: { readDate(symbol: string, date: string): Promise<DailyAdjustedBar | null> };
  repo: SymbolMetricsRepository;
}

export interface MetricBuildResult {
  symbol: string;
  date: string;
  written: boolean;
  /** Metric fields emitted (empty when nothing was written). */
  fields: SymbolMetricField[];
}

export class MetricBuildService {
  constructor(private readonly deps: MetricBuildDeps) {}

  async computeForDate(symbol: string, date: string): Promise<MetricBuildResult> {
    const sym = symbol.toUpperCase();
    const skip = (): MetricBuildResult => ({ symbol: sym, date, written: false, fields: [] });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return skip(); // malformed date → deterministic skip

    const corpus = await this.deps.gcs.readItem(sym, date);
    if (corpus.status === 'CORRUPT') {
      console.warn(`[symbol-metrics] ${sym} ${date}: corpus object corrupt (${corpus.reason}) — skipping`);
      return skip();
    }
    if (corpus.status !== 'FOUND') return skip();
    const chain = corpus.response.data;

    const bar = await this.deps.bars.readDate(sym, date);
    if (bar == null || !Number.isFinite(bar.close)) return skip();

    const entry = computeDayMetrics({ chain, underlyingClose: bar.close, date });
    if (entry == null) return skip();

    await this.deps.repo.upsertDay(sym, date, entry);
    return { symbol: sym, date, written: true, fields: Object.keys(entry) as SymbolMetricField[] };
  }
}
