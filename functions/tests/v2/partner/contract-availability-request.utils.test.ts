import { parseOptionalDateList } from '../../../src/v2/partner/partner-request.utils';
import { parseContractAvailabilityQuery } from '../../../src/v2/partner/contract-availability-request.utils';

describe('parseOptionalDateList', () => {
  it('returns null when absent', () => {
    expect(parseOptionalDateList(undefined)).toBeNull();
    expect(parseOptionalDateList('')).toBeNull();
  });

  it('parses a comma-separated list, trimming whitespace', () => {
    expect(parseOptionalDateList('2026-05-15, 2026-06-19 ,2026-07-17')).toEqual([
      '2026-05-15',
      '2026-06-19',
      '2026-07-17',
    ]);
  });

  it('dedupes repeated dates and returns canonical ascending order', () => {
    expect(parseOptionalDateList('2026-06-19,2026-05-15,2026-06-19')).toEqual([
      '2026-05-15',
      '2026-06-19',
    ]);
  });

  it('rejects when any element is malformed or a non-calendar date', () => {
    expect(parseOptionalDateList('2026-05-15,not-a-date')).toBeNull();
    expect(parseOptionalDateList('2026-02-30')).toBeNull();
  });
});

describe('parseContractAvailabilityQuery', () => {
  it('parses a minimal valid request', () => {
    const result = parseContractAvailabilityQuery({ symbol: ' qqq ' });
    expect(result).toEqual({ ok: true, params: { symbol: 'QQQ' } });
  });

  it('requires a valid symbol', () => {
    expect(parseContractAvailabilityQuery({})).toEqual({ ok: false, error: expect.stringContaining('symbol') });
    expect(parseContractAvailabilityQuery({ symbol: 'BAD SYMBOL?' })).toEqual({ ok: false, error: expect.stringContaining('symbol') });
  });

  it('parses all filter params', () => {
    const result = parseContractAvailabilityQuery({
      symbol: 'QQQ',
      expirationGte: '2026-05-01',
      expirationLte: '2026-08-31',
      strikeGte: '500',
      strikeLte: '600',
      strikeStep: '10',
      type: 'C',
      firstObservedGte: '2026-01-01',
      firstObservedLte: '2026-02-01',
    });
    expect(result).toEqual({
      ok: true,
      params: {
        symbol: 'QQQ',
        expirationGte: '2026-05-01',
        expirationLte: '2026-08-31',
        strikeGte: 500,
        strikeLte: 600,
        strikeStep: 10,
        type: 'call',
        firstObservedGte: '2026-01-01',
        firstObservedLte: '2026-02-01',
      },
    });
  });

  it('normalizes type across C/P/call/put case-insensitively', () => {
    for (const [input, expected] of [['C', 'call'], ['p', 'put'], ['CALL', 'call'], ['Put', 'put']] as const) {
      const result = parseContractAvailabilityQuery({ symbol: 'QQQ', type: input });
      expect(result).toEqual({ ok: true, params: { symbol: 'QQQ', type: expected } });
    }
  });

  it('rejects an unrecognized type', () => {
    const result = parseContractAvailabilityQuery({ symbol: 'QQQ', type: 'X' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('type') });
  });

  it('rejects malformed filter values rather than dropping them', () => {
    for (const param of ['expirationGte', 'firstObservedLte']) {
      const result = parseContractAvailabilityQuery({ symbol: 'QQQ', [param]: 'not-a-date' });
      expect(result).toEqual({ ok: false, error: expect.stringContaining(param) });
    }
    const badNum = parseContractAvailabilityQuery({ symbol: 'QQQ', strikeGte: 'abc' });
    expect(badNum).toEqual({ ok: false, error: expect.stringContaining('strikeGte') });
    for (const param of ['expirationGte', 'strikeGte', 'type', 'expirations']) {
      const result = parseContractAvailabilityQuery({ symbol: 'QQQ', [param]: { nested: true } });
      expect(result).toEqual({ ok: false, error: expect.stringContaining(param) });
    }
  });

  it('rejects inverted range pairs', () => {
    expect(
      parseContractAvailabilityQuery({ symbol: 'QQQ', expirationGte: '2026-08-01', expirationLte: '2026-05-01' }),
    ).toEqual({ ok: false, error: expect.stringContaining('expiration') });
    expect(
      parseContractAvailabilityQuery({ symbol: 'QQQ', strikeGte: 600, strikeLte: 500 }),
    ).toEqual({ ok: false, error: expect.stringContaining('strike') });
    expect(
      parseContractAvailabilityQuery({ symbol: 'QQQ', firstObservedGte: '2026-02-01', firstObservedLte: '2026-01-01' }),
    ).toEqual({ ok: false, error: expect.stringContaining('firstObserved') });
  });

  it('rejects non-positive strikeStep', () => {
    for (const step of ['0', '-5']) {
      const result = parseContractAvailabilityQuery({ symbol: 'QQQ', strikeStep: step });
      expect(result).toEqual({ ok: false, error: expect.stringContaining('strikeStep') });
    }
  });

  it('expirations list overrides the expiration range', () => {
    const result = parseContractAvailabilityQuery({
      symbol: 'QQQ',
      expirationGte: '2026-05-01',
      expirationLte: '2026-08-31',
      expirations: '2026-05-15,2026-06-19',
    });
    expect(result).toEqual({
      ok: true,
      params: { symbol: 'QQQ', expirations: ['2026-05-15', '2026-06-19'] },
    });
  });

  it('still rejects an inverted range even when expirations would override it', () => {
    const result = parseContractAvailabilityQuery({
      symbol: 'QQQ',
      expirationGte: '2026-08-01',
      expirationLte: '2026-05-01',
      expirations: '2026-05-15',
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('expiration') });
  });

  it('rejects an invalid expirations list', () => {
    const result = parseContractAvailabilityQuery({ symbol: 'QQQ', expirations: '2026-05-15,bogus' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('expirations') });
    const empty = parseContractAvailabilityQuery({ symbol: 'QQQ', expirations: ',' });
    expect(empty).toEqual({ ok: false, error: expect.stringContaining('expirations') });
  });

  it('rejects non-numeric and negative numeric params', () => {
    expect(parseContractAvailabilityQuery({ symbol: 'QQQ', strikeStep: 'abc' })).toEqual({
      ok: false, error: expect.stringContaining('strikeStep'),
    });
    expect(parseContractAvailabilityQuery({ symbol: 'QQQ', strikeGte: '-5' })).toEqual({
      ok: false, error: expect.stringContaining('strikeGte'),
    });
  });
});
