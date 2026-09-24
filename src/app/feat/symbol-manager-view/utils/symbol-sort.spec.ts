import { sortTrackedSymbols } from './symbol-sort';
import type { TrackedSymbolV2 } from '@shared/alpha-vantage';

function sym(symbol: string, extra: Partial<TrackedSymbolV2> = {}): TrackedSymbolV2 {
  return { symbol, name: symbol + ' Corp' } as TrackedSymbolV2 & object as TrackedSymbolV2;
}

describe('sortTrackedSymbols', () => {
  const rows: TrackedSymbolV2[] = [
    { ...sym('B'), name: 'bravo' } as TrackedSymbolV2,
    { ...sym('a'), name: 'Alpha' } as TrackedSymbolV2,
    { ...sym('c'), name: 'alpha' } as TrackedSymbolV2,
  ];

  it('sorts strings case-insensitively asc', () => {
    const out = sortTrackedSymbols(rows, 'name', 'asc');
    expect(out.map(s => s.symbol)).toEqual(['a', 'c', 'B']); // 'alpha' < 'bravo'
  });

  it('sorts strings case-insensitively desc', () => {
    const out = sortTrackedSymbols(rows, 'name', 'desc');
    expect(out.map(s => s.symbol)).toEqual(['B', 'a', 'c']);
  });

  it('breaks equal-value ties on symbol ascending regardless of direction', () => {
    const out = sortTrackedSymbols(rows, 'name', 'desc');
    // 'a' and 'c' both have name 'alpha' — tie falls back to symbol asc even in desc
    expect(out.indexOf(out.find(s => s.symbol === 'a')!)).toBeLessThan(
      out.indexOf(out.find(s => s.symbol === 'c')!)
    );
  });

  it('sorts nested companyInfo numbers numerically', () => {
    const list = [
      { ...sym('HI'), companyInfo: { marketCap: 3e12 } },
      { ...sym('LO'), companyInfo: { marketCap: 1e9 } },
      { ...sym('MID'), companyInfo: { marketCap: 5e11 } },
    ] as TrackedSymbolV2[];
    const out = sortTrackedSymbols(list, 'marketCap', 'desc');
    expect(out.map(s => s.symbol)).toEqual(['HI', 'MID', 'LO']);
  });

  it('sorts missing values last in BOTH directions', () => {
    const list = [
      { ...sym('MISS'), companyInfo: undefined },
      { ...sym('HI'), companyInfo: { beta: 2.0 } },
      { ...sym('LO'), companyInfo: { beta: 0.5 } },
    ] as TrackedSymbolV2[];
    expect(sortTrackedSymbols(list, 'beta', 'asc').at(-1)!.symbol).toBe('MISS');
    expect(sortTrackedSymbols(list, 'beta', 'desc').at(-1)!.symbol).toBe('MISS');
  });

  it('sorts sector (nested string) with missing last', () => {
    const list = [
      { ...sym('TECH'), companyInfo: { Sector: 'TECHNOLOGY' } },
      { ...sym('ETF'), companyInfo: undefined },
      { ...sym('FIN'), companyInfo: { Sector: 'FINANCIALS' } },
    ] as TrackedSymbolV2[];
    const out = sortTrackedSymbols(list, 'sector', 'asc');
    expect(out.map(s => s.symbol)).toEqual(['FIN', 'TECH', 'ETF']);
  });

  it('sorts timestamp fields numerically', () => {
    const list = [
      { ...sym('NEW'), _createdAt: { seconds: 2000 } },
      { ...sym('OLD'), _createdAt: { seconds: 1000 } },
      { ...sym('MID'), _createdAt: { seconds: 1500 } },
    ] as TrackedSymbolV2[];
    const out = sortTrackedSymbols(list, '_createdAt', 'asc');
    expect(out.map(s => s.symbol)).toEqual(['OLD', 'MID', 'NEW']);
  });

  it('sorts boolean _isActive (inactive first asc)', () => {
    const list = [
      { ...sym('ACT'), _isActive: true },
      { ...sym('INA'), _isActive: false },
    ] as TrackedSymbolV2[];
    expect(sortTrackedSymbols(list, '_isActive', 'asc').map(s => s.symbol)).toEqual(['INA', 'ACT']);
  });

  it('does not mutate the input array', () => {
    const list = [sym('B'), sym('A')];
    sortTrackedSymbols(list, 'symbol', 'asc');
    expect(list.map(s => s.symbol)).toEqual(['B', 'A']);
  });

  it('falls back to symbol field for unknown fields and asc for empty direction', () => {
    const list = [sym('B'), sym('A')];
    expect(sortTrackedSymbols(list, 'bogus', 'asc').map(s => s.symbol)).toEqual(['A', 'B']);
    expect(sortTrackedSymbols(list, 'symbol', '').map(s => s.symbol)).toEqual(['A', 'B']);
  });
});
