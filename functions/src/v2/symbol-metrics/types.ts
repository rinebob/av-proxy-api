/**
 * Symbol-metrics module internals (Topic #158, Thread #159).
 *
 * A MetricComputer is a pure function over one day's options chain plus its
 * lookup context, producing fields for that date's SymbolMetricDayEntry.
 * The registry (metrics/registry.ts) is the ordered list the build service
 * runs; storage/wire shapes live in shared/options/symbol-metrics.types.ts.
 */
import type { AvOptionContract } from '@shared/alpha-vantage';
import type { SymbolMetricDayEntry, SymbolMetricField } from '@shared/options';

/** One day's input to every registered computer. */
export interface MetricInput {
  /** Raw chain rows (AvOptionContract — all-numeric fields string-encoded). */
  chain: AvOptionContract[];
  /** Split-adjusted underlying close (CompactBar.c) — null when no bar exists. */
  underlyingClose: number | null;
  /** Corpus date, YYYY-MM-DD. */
  date: string;
}

export interface MetricComputer {
  /** Field names this computer emits — compile-time ⊆ SYMBOL_METRIC_FIELDS. */
  readonly fields: readonly SymbolMetricField[];
  /** null = no entry written for this date. */
  compute(input: MetricInput): SymbolMetricDayEntry | null;
}
