/**
 * Tests for the metric registry (Task #169): computeDayMetrics merges every
 * computer's fields into one day entry, and returns null when all decline.
 */
import type { AvOptionContract } from '@shared/alpha-vantage';
import { AvOptionType } from '@shared/alpha-vantage';
import { SYMBOL_METRIC_FIELDS } from '@shared/options';
import { METRIC_REGISTRY, computeDayMetrics } from '../../../src/v2/symbol-metrics/metrics/registry';

const c: AvOptionContract = {
  expiration: '2026-02-15',
  strike: '100',
  type: AvOptionType.CALL,
  implied_volatility: '0.30',
};

describe('METRIC_REGISTRY', () => {
  it('every registered field is whitelisted', () => {
    for (const computer of METRIC_REGISTRY) {
      for (const f of computer.fields) {
        expect(SYMBOL_METRIC_FIELDS as readonly string[]).toContain(f);
      }
    }
  });
});

describe('computeDayMetrics', () => {
  it('merges computer output into one entry', () => {
    const entry = computeDayMetrics({ chain: [c], underlyingClose: 100, date: '2026-01-01' });
    expect(entry).not.toBeNull();
    expect(entry!.iv30).toBeCloseTo(0.3, 5);
    expect(entry!.iv30Method).toBe('nearest');
  });

  it('returns null when every computer declines', () => {
    expect(computeDayMetrics({ chain: [], underlyingClose: 100, date: '2026-01-01' })).toBeNull();
  });
});
