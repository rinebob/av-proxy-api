import { AxiosInstance } from 'axios';

import {
  AlphaVantageEndpoint,
  AvOptionType,
} from '@shared/alpha-vantage';

import { NoOpAvThrottle } from '../../../src/v2/historical-options-corpus/services/av-throttle.service';
import {
  HistoricalOptionsRetrievalService,
  HistoricalOptionsRetrievalResult,
} from '../../../src/v2/historical-options-corpus/services/historical-options-retrieval.service';

const BASE_URL = 'https://www.alphavantage.co/query';

function createMockAxios(overrides: Partial<AxiosInstance> = {}): AxiosInstance {
  const client = {
    get: jest.fn(),
    defaults: { baseURL: BASE_URL },
    ...overrides,
  } as unknown as AxiosInstance;
  return client;
}

const validContract = {
  contractID: 'QQQ260116C00490000',
  symbol: 'QQQ',
  expiration: '2026-01-16',
  strike: '490',
  type: AvOptionType.CALL,
  last: '10.5',
  mark: '10.75',
  bid: '10.5',
  bid_size: '100',
  ask: '11',
  ask_size: '100',
  volume: '500',
  open_interest: '1000',
  date: '2026-01-02',
  implied_volatility: '0.25',
  delta: '0.6',
  gamma: '0.01',
  theta: '-0.05',
  vega: '0.2',
  rho: '0.02',
};

const validResponse = {
  endpoint: AlphaVantageEndpoint.HISTORICAL_OPTIONS,
  message: 'success',
  data: [validContract],
};

describe('HistoricalOptionsRetrievalService', () => {
  it('returns a normalized response and analysis for a valid AV payload', async () => {
    const axios = createMockAxios();
    (axios.get as jest.Mock).mockResolvedValue({ data: validResponse });

    const service = new HistoricalOptionsRetrievalService({
      axiosInstance: axios,
      throttle: new NoOpAvThrottle(),
      apiKey: 'test-key',
      baseUrl: BASE_URL,
    });

    const result: HistoricalOptionsRetrievalResult = await service.fetch({
      symbol: 'QQQ',
      date: '2026-01-02',
    });

    expect(result.response.data).toHaveLength(1);
    expect(result.response.data[0].symbol).toBe('QQQ');
    expect(result.response.data[0].strike).toBe('490');
    expect(result.analysis.summary.totalContracts).toBe(1);
    expect(result.analysis.summary.callContracts).toBe(1);
  });

  it('rejects a missing symbol', async () => {
    const axios = createMockAxios();
    const service = new HistoricalOptionsRetrievalService({
      axiosInstance: axios,
      throttle: new NoOpAvThrottle(),
      apiKey: 'test-key',
      baseUrl: BASE_URL,
    });

    await expect(service.fetch({ symbol: '   ' })).rejects.toThrow('Symbol is required');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('converts a provider rate-limit note into a typed upstream error', async () => {
    const axios = createMockAxios();
    (axios.get as jest.Mock).mockResolvedValue({
      data: { Note: 'Thank you for using Alpha Vantage! Please visit ...' },
    });

    const service = new HistoricalOptionsRetrievalService({
      axiosInstance: axios,
      throttle: new NoOpAvThrottle(),
      apiKey: 'test-key',
      baseUrl: BASE_URL,
    });

    await expect(service.fetch({ symbol: 'QQQ' })).rejects.toMatchObject({
      category: 'RATE_LIMITED',
    });
  });

  it('includes the apikey and date in the outgoing request', async () => {
    const axios = createMockAxios();
    (axios.get as jest.Mock).mockResolvedValue({ data: validResponse });

    const service = new HistoricalOptionsRetrievalService({
      axiosInstance: axios,
      throttle: new NoOpAvThrottle(),
      apiKey: 'secret',
      baseUrl: BASE_URL,
    });

    await service.fetch({ symbol: 'TQQQ', date: '2026-01-02' });

    const params = (axios.get as jest.Mock).mock.calls[0][1].params;
    expect(params.function).toBe('HISTORICAL_OPTIONS');
    expect(params.symbol).toBe('TQQQ');
    expect(params.date).toBe('2026-01-02');
    expect(params.apikey).toBe('secret');
  });

  it('defaults endpoint and message when AV omits them', async () => {
    const axios = createMockAxios();
    (axios.get as jest.Mock).mockResolvedValue({
      data: { data: [validContract] },
    });

    const service = new HistoricalOptionsRetrievalService({
      axiosInstance: axios,
      throttle: new NoOpAvThrottle(),
      apiKey: 'test-key',
      baseUrl: BASE_URL,
    });

    const result = await service.fetch({ symbol: 'QQQ', date: '2026-01-02' });

    expect(result.response.endpoint).toBe(AlphaVantageEndpoint.HISTORICAL_OPTIONS);
    expect(result.response.message).toBe('success');
  });
});
