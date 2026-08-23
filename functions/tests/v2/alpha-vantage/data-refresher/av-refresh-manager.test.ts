import { isGlobalEndpoint } from '../../../../src/v2/alpha-vantage/data-refresher/av-refresh-manager';
import type { EndpointConfig } from '@shared/core';
import { EndpointSymbolUsage } from '@shared/core';

describe('isGlobalEndpoint', () => {
  function makeConfig(firestorePath: string, symbolUsage: EndpointSymbolUsage = EndpointSymbolUsage.REQUIRED): EndpointConfig {
    return {
      id: 'TEST' as any,
      name: 'Test',
      ttl: 3600,
      firestorePath,
      symbolUsage,
      category: 'FUNDAMENTAL' as any,
      parameters: {},
    } as any;
  }

  it('returns true when firestorePath has no {symbol} placeholder (NOT_SUPPORTED)', () => {
    const config = makeConfig('market-data/av-earnings-calendar', EndpointSymbolUsage.NOT_SUPPORTED);
    expect(isGlobalEndpoint(config)).toBe(true);
  });

  it('returns true when firestorePath has no {symbol} placeholder (OPTIONAL)', () => {
    // EARNINGS_CALENDAR is OPTIONAL but has a global path (no {symbol})
    const config = makeConfig('market-data/av-earnings-calendar', EndpointSymbolUsage.OPTIONAL);
    expect(isGlobalEndpoint(config)).toBe(true);
  });

  it('returns false when firestorePath has {symbol} placeholder (REQUIRED)', () => {
    const config = makeConfig('market-data/{symbol}/data-points/EARNINGS', EndpointSymbolUsage.REQUIRED);
    expect(isGlobalEndpoint(config)).toBe(false);
  });

  it('returns false when firestorePath has {symbol} placeholder (OPTIONAL)', () => {
    const config = makeConfig('market-data/{symbol}/data-points/OVERVIEW', EndpointSymbolUsage.OPTIONAL);
    expect(isGlobalEndpoint(config)).toBe(false);
  });

  it('returns true when firestorePath is undefined', () => {
    const config = makeConfig(undefined as any, EndpointSymbolUsage.NOT_SUPPORTED);
    expect(isGlobalEndpoint(config)).toBe(true);
  });

  it('returns true when firestorePath is empty string', () => {
    const config = makeConfig('', EndpointSymbolUsage.NOT_SUPPORTED);
    expect(isGlobalEndpoint(config)).toBe(true);
  });
});
