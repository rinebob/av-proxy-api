import { AV_ENDPOINT_CONFIGS } from '@shared/alpha-vantage/av-endpoint-configs';
import { AlphaVantageEndpoint, AV_IMPLEMENTED_ENDPOINTS } from '@shared/alpha-vantage/av-endpoints';
import { EndpointSymbolUsage } from '@shared/core/types';
import { FirestoreCollection } from '@shared/firestore/firestore';

describe('EARNINGS config', () => {
  const config = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.EARNINGS];

  it('is defined', () => {
    expect(config).toBeDefined();
  });

  it('has TTL of 7 days (604800 seconds), not 30 days', () => {
    expect(config?.ttl).toBe(7 * 24 * 60 * 60);
    expect(config?.ttl).not.toBe(30 * 24 * 60 * 60);
  });

  it('has symbolUsage REQUIRED', () => {
    expect(config?.symbolUsage).toBe(EndpointSymbolUsage.REQUIRED);
  });

  it('has correct firestorePath grouped under earnings/', () => {
    expect(config?.firestorePath).toBe(`${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.EARNINGS}/av-${FirestoreCollection.EARNINGS}`);
  });
});

describe('EARNINGS_ESTIMATES config', () => {
  const config = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.EARNINGS_ESTIMATES];

  it('is defined', () => {
    expect(config).toBeDefined();
  });

  it('has TTL of 7 days', () => {
    expect(config?.ttl).toBe(7 * 24 * 60 * 60);
  });

  it('has symbolUsage REQUIRED', () => {
    expect(config?.symbolUsage).toBe(EndpointSymbolUsage.REQUIRED);
  });

  it('has firestorePath grouped under earnings/ subcollection (not earnings-estimates/)', () => {
    const path = config?.firestorePath ?? '';
    expect(path).toBe(`${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.EARNINGS}/av-${FirestoreCollection.EARNINGS_ESTIMATES}`);
    // Must NOT use the old standalone earnings-estimates/ path
    expect(path).not.toContain(`${FirestoreCollection.EARNINGS_ESTIMATES}/av-`);
  });
});

describe('EARNINGS_CALENDAR config', () => {
  const config = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.EARNINGS_CALENDAR];

  it('is defined', () => {
    expect(config).toBeDefined();
  });

  it('has symbolUsage OPTIONAL (AV supports optional symbol filtering)', () => {
    expect(config?.symbolUsage).toBe(EndpointSymbolUsage.OPTIONAL);
  });

  it('has global firestorePath under market-data/ (no {symbol})', () => {
    const path = config?.firestorePath ?? '';
    expect(path).toBe(`${FirestoreCollection.MARKET_DATA}/av-${FirestoreCollection.EARNINGS_CALENDAR}`);
    expect(path).not.toContain('{symbol}');
  });

  it('has symbol parameter (optional, not required)', () => {
    expect(config?.parameters?.symbol).toBeDefined();
    const symbol = config?.parameters?.symbol as { type: string; required: boolean };
    expect(symbol.required).toBe(false);
  });

  it('has horizon parameter set to 12month with enum constraint', () => {
    expect(config?.parameters?.horizon).toBeDefined();
    const horizon = config?.parameters?.horizon as { type: string; required: boolean; default?: string; enum?: string[] };
    expect(horizon.default).toBe('12month');
    expect(horizon.enum).toEqual(['3month', '6month', '12month']);
  });

  it('has TTL of 1 day', () => {
    expect(config?.ttl).toBe(24 * 60 * 60);
  });
});

describe('AV_IMPLEMENTED_ENDPOINTS — earnings entries', () => {
  it('includes EARNINGS', () => {
    expect(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.EARNINGS)).toBe(true);
  });

  it('includes EARNINGS_ESTIMATES', () => {
    expect(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.EARNINGS_ESTIMATES)).toBe(true);
  });

  it('includes EARNINGS_CALENDAR', () => {
    expect(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.EARNINGS_CALENDAR)).toBe(true);
  });
});
