/**
 * Metric registry — the ordered list of computers the build service runs for
 * each (symbol, date). Adding a metric = adding a MetricComputer here; the
 * emitted field names must already be in SYMBOL_METRIC_FIELDS.
 */
import type { SymbolMetricDayEntry } from '@shared/options';
import type { MetricComputer, MetricInput } from '../types';
import { computeIv30 } from './iv30.computer';

const iv30Computer: MetricComputer = {
  fields: ['iv30', 'iv30Method', 'iv30Contracts'],
  compute: computeIv30,
};

export const METRIC_REGISTRY: readonly MetricComputer[] = [iv30Computer];

// registry.test.ts asserts every registered field ⊆ SYMBOL_METRIC_FIELDS —
// no runtime assert here so module import is side-effect-free.
export function computeDayMetrics(input: MetricInput): SymbolMetricDayEntry | null {
  const entry = METRIC_REGISTRY
    .map((c) => c.compute(input))
    .filter((e): e is NonNullable<typeof e> => e != null)
    .reduce<SymbolMetricDayEntry>((acc, e) => ({ ...acc, ...e }), {});
  return Object.keys(entry).length > 0 ? entry : null;
}
