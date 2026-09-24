import { formatMarketCap, formatBeta, orDash } from './company-info.format';

describe('formatMarketCap', () => {
  it('formats trillions with 2 decimals', () => {
    expect(formatMarketCap(5145751454000)).toBe('$5.15T');
    expect(formatMarketCap(1e12)).toBe('$1.00T');
  });

  it('formats billions with 1 decimal', () => {
    expect(formatMarketCap(980_600_000_000)).toBe('$980.6B');
    expect(formatMarketCap(1e9)).toBe('$1.0B');
  });

  it('formats millions with 0 decimals', () => {
    expect(formatMarketCap(43_000_000)).toBe('$43M');
    expect(formatMarketCap(1_500_000)).toBe('$2M');
  });

  it('formats sub-million values as whole dollars', () => {
    expect(formatMarketCap(750_000)).toBe('$750000');
  });

  it('renders — for absent/invalid values', () => {
    expect(formatMarketCap(null)).toBe('—');
    expect(formatMarketCap(undefined)).toBe('—');
    expect(formatMarketCap(NaN)).toBe('—');
    expect(formatMarketCap(0)).toBe('—');
    expect(formatMarketCap(-5)).toBe('—');
  });
});

describe('formatBeta', () => {
  it('formats to two decimals', () => {
    expect(formatBeta(2.202)).toBe('2.20');
    expect(formatBeta(1)).toBe('1.00');
    expect(formatBeta(0)).toBe('0.00');
    expect(formatBeta(-3.182)).toBe('-3.18');
  });

  it('renders — for absent/invalid values', () => {
    expect(formatBeta(null)).toBe('—');
    expect(formatBeta(undefined)).toBe('—');
    expect(formatBeta(NaN)).toBe('—');
  });
});

describe('orDash', () => {
  it('passes through non-empty strings', () => {
    expect(orDash('TECHNOLOGY')).toBe('TECHNOLOGY');
  });

  it('renders — for null/undefined/empty', () => {
    expect(orDash(null)).toBe('—');
    expect(orDash(undefined)).toBe('—');
    expect(orDash('')).toBe('—');
  });
});
