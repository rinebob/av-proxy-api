import {
  buildTrackedSymbolCompanyInfo,
  diffCompanyInfoForWrite,
} from '../../../../src/v2/alpha-vantage/logic/company-info.builder';
import type { AvCompanyOverview } from '@shared/alpha-vantage';

function overview(overrides: Partial<AvCompanyOverview> = {}): Partial<AvCompanyOverview> {
  return {
    Symbol: 'NVDA',
    AssetType: 'Common Stock',
    Name: 'NVIDIA Corporation',
    Description: 'GPU maker',
    CIK: '0001045810',
    Exchange: 'NASDAQ',
    Currency: 'USD',
    Country: 'USA',
    Sector: 'TECHNOLOGY',
    Industry: 'SEMICONDUCTORS',
    Address: '2788 SAN TOMAS EXPRESSWAY, SANTA CLARA, CA, US',
    OfficialSite: 'https://www.nvidia.com',
    FiscalYearEnd: 'January',
    MarketCapitalization: '5150000000000',
    Beta: '2.202',
    ...overrides,
  };
}

describe('buildTrackedSymbolCompanyInfo', () => {
  it('copies stable identity fields verbatim', () => {
    const info = buildTrackedSymbolCompanyInfo(overview());
    expect(info.Symbol).toBe('NVDA');
    expect(info.Sector).toBe('TECHNOLOGY');
    expect(info.Industry).toBe('SEMICONDUCTORS');
    expect(info.Exchange).toBe('NASDAQ');
  });

  it('covers every TrackedSymbolCompanyInfo field (completeness guard)', () => {
    const info = buildTrackedSymbolCompanyInfo(overview());
    expect(Object.keys(info).sort()).toEqual(
      [
        'Symbol', 'AssetType', 'Name', 'Description', 'CIK',
        'Exchange', 'Currency', 'Country', 'Sector', 'Industry',
        'Address', 'OfficialSite', 'FiscalYearEnd',
        'marketCap', 'beta',
      ].sort()
    );
  });

  it('parses MarketCapitalization string into numeric marketCap', () => {
    const info = buildTrackedSymbolCompanyInfo(overview());
    expect(info.marketCap).toBe(5150000000000);
  });

  it('parses Beta string into numeric beta', () => {
    const info = buildTrackedSymbolCompanyInfo(overview());
    expect(info.beta).toBe(2.202);
  });

  it.each(['None', '', 'abc', undefined])(
    'omits marketCap and beta when source value is %p',
    (bad) => {
      const info = buildTrackedSymbolCompanyInfo(
        overview({ MarketCapitalization: bad, Beta: bad })
      );
      expect(info.marketCap).toBeUndefined();
      expect(info.beta).toBeUndefined();
      expect(Object.keys(info)).not.toContain('marketCap');
      expect(Object.keys(info)).not.toContain('beta');
    }
  );

  it('writes 0 for a legitimately zero value', () => {
    const info = buildTrackedSymbolCompanyInfo(overview({ Beta: '0' }));
    expect(info.beta).toBe(0);
  });

  it('never writes NaN or non-number values', () => {
    const info = buildTrackedSymbolCompanyInfo(
      overview({ MarketCapitalization: 'NaN', Beta: 'NaN' })
    );
    expect(info.marketCap).toBeUndefined();
    expect(info.beta).toBeUndefined();
  });
});

describe('diffCompanyInfoForWrite', () => {
  const built = buildTrackedSymbolCompanyInfo(
    overview({ MarketCapitalization: '1000000', Beta: '1.5', Sector: 'TECHNOLOGY' })
  );

  it('returns all built fields when existing companyInfo is absent', () => {
    const delta = diffCompanyInfoForWrite(undefined, built);
    expect(delta).not.toBeNull();
    expect(delta!['companyInfo.marketCap']).toBe(1000000);
    expect(delta!['companyInfo.beta']).toBe(1.5);
    expect(delta!['companyInfo.Sector']).toBe('TECHNOLOGY');
  });

  it('returns null when existing matches built (idempotent re-run)', () => {
    const existing = { ...built };
    expect(diffCompanyInfoForWrite(existing, built)).toBeNull();
  });

  it('returns only the fields that differ', () => {
    const existing = { ...built, marketCap: 999 };
    const delta = diffCompanyInfoForWrite(existing, built);
    expect(delta).toEqual({ 'companyInfo.marketCap': 1000000 });
  });

  it('includes fields missing from existing', () => {
    const { beta: _drop, ...noBeta } = built;
    const delta = diffCompanyInfoForWrite(noBeta, built);
    expect(delta).toEqual({ 'companyInfo.beta': 1.5 });
  });

  it('never emits a delta containing NaN or undefined', () => {
    const sparse = buildTrackedSymbolCompanyInfo(overview({ MarketCapitalization: 'None', Beta: 'abc' }));
    const delta = diffCompanyInfoForWrite({}, sparse);
    if (delta) {
      for (const v of Object.values(delta)) {
        expect(v).not.toBeUndefined();
        expect(Number.isNaN(v)).toBe(false);
      }
    }
  });
});
