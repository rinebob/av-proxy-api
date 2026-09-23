import { buildTrackedSymbolCompanyInfo } from '../../../../src/v2/alpha-vantage/logic/company-info.builder';
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
