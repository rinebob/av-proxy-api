/**
 * Tests for shared/options symbol-metrics contract types (Task #168).
 *
 * Verifies:
 * - SYMBOL_METRIC_FIELDS is the endpoint whitelist + computer field source
 * - Path constants match the year-shard layout
 * - Doc/entry shapes serialize to plain objects (Firestore-writeable)
 */
import {
  SYMBOL_METRIC_FIELDS,
  SYMBOL_METRICS_COLLECTION,
  SYMBOL_METRICS_YEARS_SUBCOLLECTION,
} from '@shared/options/symbol-metrics.types';
import type {
  SymbolMetricDayEntry,
  SymbolMetricsYearDoc,
  IvMetricsRow,
} from '@shared/options/symbol-metrics.types';

describe('SYMBOL_METRIC_FIELDS', () => {
  it('lists every iv30-emitted field', () => {
    expect(SYMBOL_METRIC_FIELDS).toEqual(['iv30', 'iv30Method', 'iv30Contracts']);
  });

  it('whitelist covers every key a day entry can carry', () => {
    // Whitelist↔type correspondence: a fully-populated entry's keys must all
    // be whitelisted — drift fails here, not at the endpoint.
    const full: Required<SymbolMetricDayEntry> = {
      iv30: 0.2841,
      iv30Method: 'interpolated',
      iv30Contracts: 2972,
    };
    expect(
      Object.keys(full).every((k) => (SYMBOL_METRIC_FIELDS as readonly string[]).includes(k)),
    ).toBe(true);
  });
});

describe('path constants', () => {
  it('encode the year-shard layout', () => {
    expect(SYMBOL_METRICS_COLLECTION).toBe('symbol-metrics');
    expect(SYMBOL_METRICS_YEARS_SUBCOLLECTION).toBe('years');
  });
});

describe('SymbolMetricsYearDoc', () => {
  it('survives JSON round-trip (Firestore-writeable primitives)', () => {
    const doc: SymbolMetricsYearDoc = {
      symbol: 'QQQ',
      year: 2026,
      days: {
        '2026-01-07': { iv30: 0.2841, iv30Method: 'interpolated', iv30Contracts: 2972 },
      },
      updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 }, // TimestampLike
    };
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('day entries are sparse — absent fields stay absent, not null', () => {
    const entry: SymbolMetricDayEntry = {};
    expect('iv30' in entry).toBe(false);
  });
});

describe('IvMetricsRow', () => {
  it('is a day entry plus its date', () => {
    const row: IvMetricsRow = { date: '2026-01-07', iv30: 0.2841 };
    expect(row.date).toBe('2026-01-07');
    expect(row.iv30).toBeCloseTo(0.2841);
  });
});
