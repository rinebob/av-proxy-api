import {
  AvOptionContract,
  AvOptionType,
} from '@shared/alpha-vantage';

import {
  parseStorageLine,
  toApiObservation,
  toStorageLine,
  toStorageRecord,
} from '../../../src/v2/historical-options-corpus/services/time-series-contract.utils';

describe('time-series-contract.utils', () => {
  const baseContract: AvOptionContract = {
    contractID: 'QQQ260116C00490000',
    symbol: 'QQQ',
    expiration: '2026-01-16',
    type: AvOptionType.CALL,
    strike: '490',
    date: '2026-01-02',
    last: '1.23',
    mark: '1.25',
    bid: '1.20',
    bid_size: '10',
    ask: '1.30',
    ask_size: '15',
    volume: '100',
    open_interest: '1000',
    implied_volatility: '0.25',
    delta: '0.5',
    gamma: '0.01',
    theta: '-0.02',
    vega: '0.03',
    rho: '0.001',
  };

  it('toStorageRecord returns undefined when date is missing', () => {
    expect(toStorageRecord({ ...baseContract, date: undefined })).toBeUndefined();
  });

  it('toStorageRecord maps fields to aliases and omits empty or undefined values', () => {
    const record = toStorageRecord({
      ...baseContract,
      last: '',
      mark: undefined,
    });

    expect(record).toBeDefined();
    expect(record!.d).toBe('2026-01-02');
    expect(record!.l).toBeUndefined();
    expect(record!.m).toBeUndefined();
    expect(record!.b).toBe('1.20');
    expect(record!.v).toBe('100');
  });

  it('toStorageLine omits undefined fields and keeps deterministic order', () => {
    const record = toStorageRecord(baseContract)!;
    const line = toStorageLine(record);
    const parsed = JSON.parse(line);

    expect(parsed.d).toBe('2026-01-02');
    expect(parsed.b).toBe('1.20');
    expect(parsed.l).toBe('1.23');
    expect(parsed.unknown).toBeUndefined();
  });

  it('parseStorageLine returns undefined for invalid JSON or missing d', () => {
    expect(parseStorageLine('not-json')).toBeUndefined();
    expect(parseStorageLine('{}')).toBeUndefined();
    expect(parseStorageLine('{"l":"1.23"}')).toBeUndefined();
  });

  it('parseStorageLine returns a record for a valid JSONL line', () => {
    const record = toStorageRecord(baseContract)!;
    const line = toStorageLine(record);
    const parsed = parseStorageLine(line);

    expect(parsed).toBeDefined();
    expect(parsed!.d).toBe('2026-01-02');
    expect(parsed!.b).toBe('1.20');
  });

  it('toApiObservation expands aliases back to full field names', () => {
    const record = toStorageRecord(baseContract)!;
    const observation = toApiObservation(record);

    expect(observation.date).toBe('2026-01-02');
    expect(observation.bid).toBe('1.20');
    expect(observation.volume).toBe('100');
    expect(observation.gamma).toBe('0.01');
  });
});
