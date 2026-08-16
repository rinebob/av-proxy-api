import {
  TECHNICAL_INDICATORS_CONFIG,
} from '@shared/alpha-vantage/av-technical-indicators-config';
import { AlphaVantageEndpoint, AV_IMPLEMENTED_ENDPOINTS } from '@shared/alpha-vantage/av-endpoints';
import { AV_ENDPOINT_CONFIGS } from '@shared/alpha-vantage/av-endpoint-configs';

describe('TECHNICAL_INDICATORS_CONFIG', () => {
  const HILBERT_INDICATORS = [
    { key: 'ht_trendline', fn: 'HT_TRENDLINE', enum: AlphaVantageEndpoint.HT_TRENDLINE },
    { key: 'ht_sine',      fn: 'HT_SINE',      enum: AlphaVantageEndpoint.HT_SINE },
    { key: 'ht_trendmode', fn: 'HT_TRENDMODE', enum: AlphaVantageEndpoint.HT_TRENDMODE },
    { key: 'ht_dcperiod',  fn: 'HT_DCPERIOD',  enum: AlphaVantageEndpoint.HT_DCPERIOD },
    { key: 'ht_dcphase',   fn: 'HT_DCPHASE',   enum: AlphaVantageEndpoint.HT_DCPHASE },
    { key: 'ht_phasor',    fn: 'HT_PHASOR',    enum: AlphaVantageEndpoint.HT_PHASOR },
  ];

  it('contains all 6 Hilbert Transform indicators', () => {
    for (const { key } of HILBERT_INDICATORS) {
      expect(TECHNICAL_INDICATORS_CONFIG[key]).toBeDefined();
    }
  });

  it('maps each indicator to the correct AV function name', () => {
    for (const { key, fn } of HILBERT_INDICATORS) {
      expect(TECHNICAL_INDICATORS_CONFIG[key].function).toBe(fn);
    }
  });

  it('each config entry has requiredParams including interval and series_type', () => {
    for (const { key } of HILBERT_INDICATORS) {
      const config = TECHNICAL_INDICATORS_CONFIG[key];
      expect(config.requiredParams).toContain('interval');
      expect(config.requiredParams).toContain('series_type');
    }
  });

  it('each config entry has defaultParams with series_type=close and interval=daily', () => {
    for (const { key } of HILBERT_INDICATORS) {
      const config = TECHNICAL_INDICATORS_CONFIG[key];
      expect(config.defaultParams?.series_type).toBe('close');
      expect(config.defaultParams?.interval).toBe('daily');
    }
  });
});

describe('AlphaVantageEndpoint enum — Hilbert entries', () => {
  it('has all 6 Hilbert Transform endpoints', () => {
    expect(AlphaVantageEndpoint.HT_TRENDLINE).toBe('HT_TRENDLINE');
    expect(AlphaVantageEndpoint.HT_SINE).toBe('HT_SINE');
    expect(AlphaVantageEndpoint.HT_TRENDMODE).toBe('HT_TRENDMODE');
    expect(AlphaVantageEndpoint.HT_DCPERIOD).toBe('HT_DCPERIOD');
    expect(AlphaVantageEndpoint.HT_DCPHASE).toBe('HT_DCPHASE');
    expect(AlphaVantageEndpoint.HT_PHASOR).toBe('HT_PHASOR');
  });
});

describe('AV_IMPLEMENTED_ENDPOINTS — Hilbert entries', () => {
  it('includes all 6 Hilbert Transform endpoints', () => {
    expect(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.HT_TRENDLINE)).toBe(true);
    expect(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.HT_SINE)).toBe(true);
    expect(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.HT_TRENDMODE)).toBe(true);
    expect(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.HT_DCPERIOD)).toBe(true);
    expect(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.HT_DCPHASE)).toBe(true);
    expect(AV_IMPLEMENTED_ENDPOINTS.has(AlphaVantageEndpoint.HT_PHASOR)).toBe(true);
  });
});

describe('Config consistency — TECHNICAL_INDICATORS_CONFIG vs AV_ENDPOINT_CONFIGS', () => {
  const HILBERT_KEYS = ['ht_trendline', 'ht_sine', 'ht_trendmode', 'ht_dcperiod', 'ht_dcphase', 'ht_phasor'];

  it('every indicator function name maps to an AlphaVantageEndpoint enum value', () => {
    for (const key of HILBERT_KEYS) {
      const fnName = TECHNICAL_INDICATORS_CONFIG[key].function;
      expect(Object.values(AlphaVantageEndpoint)).toContain(fnName);
    }
  });

  it('every indicator has a matching entry in AV_ENDPOINT_CONFIGS with ttl=0 and empty firestorePath', () => {
    for (const key of HILBERT_KEYS) {
      const fnName = TECHNICAL_INDICATORS_CONFIG[key].function;
      const endpointEnum = fnName as AlphaVantageEndpoint;
      const config = AV_ENDPOINT_CONFIGS[endpointEnum];
      expect(config).toBeDefined();
      expect(config?.ttl).toBe(0);
      expect(config?.firestorePath).toBe('');
    }
  });

  it('all indicator function names are unique', () => {
    const fnNames = HILBERT_KEYS.map(k => TECHNICAL_INDICATORS_CONFIG[k].function);
    expect(new Set(fnNames).size).toBe(fnNames.length);
  });
});
