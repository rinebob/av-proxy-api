import {
  resolveTrackedSymbolSortField,
  TRACKED_SYMBOL_SORTABLE_FIELDS,
  TRACKED_SYMBOL_V2_FIELDS,
} from '@shared/alpha-vantage';

describe('resolveTrackedSymbolSortField', () => {
  it('accepts every whitelisted field', () => {
    for (const field of TRACKED_SYMBOL_SORTABLE_FIELDS) {
      expect(resolveTrackedSymbolSortField(field)).toBe(field);
    }
  });

  it('accepts the companyInfo nested sort fields', () => {
    expect(resolveTrackedSymbolSortField('companyInfo.Sector')).toBe('companyInfo.Sector');
    expect(resolveTrackedSymbolSortField('companyInfo.Industry')).toBe('companyInfo.Industry');
    expect(resolveTrackedSymbolSortField('companyInfo.Country')).toBe('companyInfo.Country');
    expect(resolveTrackedSymbolSortField('companyInfo.marketCap')).toBe('companyInfo.marketCap');
    expect(resolveTrackedSymbolSortField('companyInfo.beta')).toBe('companyInfo.beta');
  });

  it.each([undefined, '', 'bogus', 'companyInfo.Description', 'companyInfo', 'password', '__name__'])(
    'falls back to symbol for invalid sortBy %p',
    (bad) => {
      expect(resolveTrackedSymbolSortField(bad)).toBe(TRACKED_SYMBOL_V2_FIELDS.SYMBOL);
    }
  );

  it('does not accept non-sortable tracked-symbol fields', () => {
    // Fields that exist on the doc but are not in the sort whitelist
    for (const field of ['matchScore', 'marketOpen', 'timezone', '_isActive', '_onboardingStatus']) {
      expect(resolveTrackedSymbolSortField(field)).toBe(TRACKED_SYMBOL_V2_FIELDS.SYMBOL);
    }
  });
});
