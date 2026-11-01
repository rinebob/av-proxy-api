import { parseDeltaPicksQuery } from '../../../src/v2/partner/options-delta-picks-request.utils';

describe('parseDeltaPicksQuery — happy path', () => {
  it('parses a fully valid in-grid request', () => {
    const res = parseDeltaPicksQuery({
      symbol: 'QQQ', type: 'put', delta: '20', dte: '45', year: '2026',
    });
    expect(res).toEqual({
      ok: true,
      params: { symbol: 'QQQ', type: 'put', deltaPct: 20, dte: 45, year: 2026 },
    });
  });

  it('uppercases the symbol and normalizes type aliases', () => {
    const res = parseDeltaPicksQuery({
      symbol: 'spy', type: 'C', delta: '50', dte: '30', year: '2026',
    });
    expect(res).toMatchObject({ ok: true, params: { symbol: 'SPY', type: 'call' } });
  });

  it('accepts every grid delta boundary (5 and 95) and dte boundary (7 and 365)', () => {
    for (const [delta, dte] of [['5', '7'], ['95', '365']]) {
      const res = parseDeltaPicksQuery({ symbol: 'QQQ', type: 'put', delta, dte, year: '2026' });
      expect(res.ok).toBe(true);
    }
  });
});

describe('parseDeltaPicksQuery — symbol', () => {
  it.each([
    ['missing', undefined],
    ['empty', '   '],
    ['malformed', 'bad symbol!'],
    ['dotted (unencodable)', 'BRK.B'],
  ])('rejects a %s symbol naming symbol', (_label, symbol) => {
    const res = parseDeltaPicksQuery({ type: 'put', delta: '20', dte: '45', year: '2026', ...(symbol !== undefined ? { symbol } : {}) });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('symbol');
  });

  it('accepts a hyphenated symbol the cellId codec round-trips', () => {
    const res = parseDeltaPicksQuery({ symbol: 'BRK-B', type: 'put', delta: '20', dte: '45', year: '2026' });
    expect(res).toMatchObject({ ok: true, params: { symbol: 'BRK-B' } });
  });
});

describe('parseDeltaPicksQuery — type', () => {
  it.each([
    ['missing', undefined],
    ['invalid', 'strangle'],
  ])('rejects a %s type naming type', (_label, type) => {
    const res = parseDeltaPicksQuery({ symbol: 'QQQ', delta: '20', dte: '45', year: '2026', ...(type !== undefined ? { type } : {}) });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('type');
  });
});

describe('parseDeltaPicksQuery — delta', () => {
  it.each([
    ['missing', undefined],
    ['non-numeric', 'abc'],
    ['off-grid', '17'],
    ['below grid', '4'],
    ['above grid', '100'],
    ['zero', '0'],
    ['negative', '-20'],
    ['decimal', '0.2'],
  ])('rejects a %s delta naming delta', (_label, delta) => {
    const res = parseDeltaPicksQuery({ symbol: 'QQQ', type: 'put', dte: '45', year: '2026', ...(delta !== undefined ? { delta } : {}) });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('delta');
  });
});

describe('parseDeltaPicksQuery — dte', () => {
  it.each([
    ['missing', undefined],
    ['non-numeric', 'xyz'],
    ['off-grid', '63'],
    ['not a grid level', '8'],
    ['negative', '-45'],
    ['decimal', '45.5'],
  ])('rejects a %s dte naming dte', (_label, dte) => {
    const res = parseDeltaPicksQuery({ symbol: 'QQQ', type: 'put', delta: '20', year: '2026', ...(dte !== undefined ? { dte } : {}) });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('dte');
  });
});

describe('parseDeltaPicksQuery — year', () => {
  it.each([
    ['missing', undefined],
    ['malformed', '20X6'],
    ['three digits', '202'],
    ['five digits', '20266'],
  ])('rejects a %s year naming year', (_label, year) => {
    const res = parseDeltaPicksQuery({ symbol: 'QQQ', type: 'put', delta: '20', dte: '45', ...(year !== undefined ? { year } : {}) });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('year');
  });
});

describe('parseDeltaPicksQuery — precedence', () => {
  it('reports the first failing param in symbol → type → delta → dte → year order', () => {
    const res = parseDeltaPicksQuery({ delta: '17', dte: '63' });
    expect((res as { error: string }).error).toContain('symbol');
    const res2 = parseDeltaPicksQuery({ symbol: 'QQQ', delta: '17', dte: '63' });
    expect((res2 as { error: string }).error).toContain('type');
    const res3 = parseDeltaPicksQuery({ symbol: 'QQQ', type: 'put', delta: '17', dte: '63' });
    expect((res3 as { error: string }).error).toContain('delta');
    const res4 = parseDeltaPicksQuery({ symbol: 'QQQ', type: 'put', delta: '20', dte: '63' });
    expect((res4 as { error: string }).error).toContain('dte');
  });
});
