import { resolveMark } from '../../../src/v2/spread-pricing/services';
import type { TimeSeriesStorageRecord } from '../../../src/v2/historical-options-corpus/services/time-series-contract.utils';

function makeRecord(overrides: Partial<TimeSeriesStorageRecord> = {}): TimeSeriesStorageRecord {
  return { d: '2024-05-01', ...overrides };
}

describe('resolveMark', () => {
  it('uses mark when present', () => {
    const record = makeRecord({ m: '8.50' });
    const result = resolveMark(record, null);
    expect(result.mark).toBe(8.50);
    expect(result.updated).toBe(true);
  });

  it('falls back to bid/ask midpoint when mark is missing', () => {
    const record = makeRecord({ b: '8.40', a: '8.60' });
    const result = resolveMark(record, null);
    expect(result.mark).toBe(8.50);
    expect(result.updated).toBe(true);
  });

  it('falls back to bid/ask midpoint when mark is empty string', () => {
    const record = makeRecord({ m: '', b: '8.40', a: '8.60' });
    const result = resolveMark(record, null);
    expect(result.mark).toBe(8.50);
    expect(result.updated).toBe(true);
  });

  it('carries forward last known mark when mark and bid/ask are missing', () => {
    const record = makeRecord({});
    const result = resolveMark(record, 7.25);
    expect(result.mark).toBe(7.25);
    expect(result.updated).toBe(false);
  });

  it('returns null when all sources are missing and no prior mark', () => {
    const record = makeRecord({});
    const result = resolveMark(record, null);
    expect(result.mark).toBeNull();
    expect(result.updated).toBe(false);
  });

  it('returns null for invalid mark string (NaN)', () => {
    const record = makeRecord({ m: 'invalid' });
    const result = resolveMark(record, null);
    expect(result.mark).toBeNull();
  });

  it('falls back to bid/ask when mark is invalid but bid/ask are valid', () => {
    const record = makeRecord({ m: 'invalid', b: '8.40', a: '8.60' });
    const result = resolveMark(record, null);
    expect(result.mark).toBe(8.50);
    expect(result.updated).toBe(true);
  });

  it('returns null for negative mark', () => {
    const record = makeRecord({ m: '-1.0' });
    const result = resolveMark(record, null);
    expect(result.mark).toBeNull();
  });
});
